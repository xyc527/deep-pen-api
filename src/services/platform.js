// 平台适配层：把 fs / global / $falcon / $dataDir 的差异收在这一个文件里，
// 页面与业务代码不直接碰平台 API。
//
// 真机事实（本设备 X7，框架 4.9.9）：
//  - fs.writeFile 是**同步**的：写 await 反而卡住事件循环，调用后不要再 await。
//  - mkdir 必须先调，路径不存在时 writeFile 不报错也不落盘。
//  - 冷启动第一次 readFile 经常失败（文件系统未就绪），要重试。
//  - execShell（global.Global）无回显、异步返回 boolean，命令产物要重定向到文件再读。

import fs from 'fs'
import globalModule from 'global'

export const APP_TAG = 'DP'

let _g = null
export function getGlobal() {
  if (!_g) {
    try { _g = new globalModule.Global() } catch (e) { _g = null }
  }
  return _g
}

export function execShell(cmd) {
  try {
    const g = getGlobal()
    if (!g || typeof g.execShell !== 'function') return false
    return g.execShell(cmd)
  } catch (e) {
    return false
  }
}

export function dataDirBase() {
  try { return String($dataDir || '/tmp').replace(/\/+$/, '') } catch (e) { return '/tmp' }
}

export function joinPath(base) {
  let out = String(base == null ? '' : base).replace(/\/+$/, '')
  for (let i = 1; i < arguments.length; i++) {
    const seg = String(arguments[i] == null ? '' : arguments[i]).replace(/^\/+/, '').replace(/\/+$/, '')
    if (seg) out += '/' + seg
  }
  return out
}

export function appDir() {
  return joinPath(dataDirBase(), 'deepseek')
}

export function ensureAppDir(sub) {
  const dir = sub ? joinPath(appDir(), sub) : appDir()
  try { fs.mkdir(dir) } catch (e) { /* 已存在 */ }
  return dir
}

export function log() {
  try {
    const args = []
    for (let i = 0; i < arguments.length; i++) args.push(arguments[i])
    console.log(APP_TAG + ' ' + args.join(' '))
  } catch (e) { /* 忽略 */ }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 单引号安全引用（路径/关键字拼进 shell 命令时用）
export function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

export async function readText(path, retries) {
  const n = typeof retries === 'number' ? retries : 1
  for (let i = 0; i < n; i++) {
    try {
      const v = await fs.readFile(path)
      if (v !== null && v !== undefined) return String(v)
    } catch (e) { /* 重试 */ }
    if (i < n - 1) await sleep(400)
  }
  return null
}

// 同步写入，故意不返回 Promise：本机 fs.writeFile 是同步实现
export function writeText(path, text) {
  try {
    fs.writeFile(path, String(text == null ? '' : text))
    return true
  } catch (e) {
    return false
  }
}

export function writeFileSync(path, data) {
  try {
    fs.writeFile(path, data)
    return true
  } catch (e) {
    return false
  }
}

export async function removeFile(path) {
  try {
    const g = getGlobal()
    if (g && typeof g.execShell === 'function') {
      return g.execShell('rm -f ' + shq(path) + ' 2>/dev/null; true')
    }
  } catch (e) { /* 忽略 */ }
  return false
}

export async function exists(path) {
  try { return !!(await fs.exists(path)) } catch (e) { return false }
}

export async function stat(path) {
  try {
    const st = await fs.stat(path)
    if (!st) return null
    // 本机 stat 结构体字段是 mtimeMs/atimeMs（见 fs 文档 3.4），没有 mtime。
    // 直接读 st.mtime 会拿到 undefined → 照片全部 mtime=0 → "最新在前"排序失效、
    // 目录指纹恒定导致相机回来自动收图不触发（两个 bug 同一个根因）。这里统一归一化。
    return {
      size: Number(st.size) || 0,
      mtime: Number(st.mtimeMs || st.mtime || 0),
      atime: Number(st.atimeMs || 0)
    }
  } catch (e) {
    return null
  }
}

export async function readdir(path) {
  try { return await fs.readdir(path) } catch (e) { return null }
}

// 轮询等待文件出现且非空（等 shell 命令产物）
export async function waitForFile(path, timeoutMs, shouldCancel) {
  const start = Date.now()
  const limit = timeoutMs || 5000
  while (Date.now() - start < limit) {
    if (shouldCancel && shouldCancel()) return null
    const c = await readText(path, 1)
    if (c !== null && c !== '') return c
    await sleep(120)
  }
  return null
}

export function navTo(uri, options) {
  try {
    if (typeof $falcon === 'undefined' || typeof $falcon.navTo !== 'function') return false
    $falcon.navTo(uri, options || {})
    return true
  } catch (e) {
    return false
  }
}

export function deviceInfo() {
  const out = { platform: '', version: '', apiVersion: 0, model: '', width: 0, height: 0 }
  try {
    const env = ($falcon && $falcon.env) || {}
    out.platform = env.platform || ''
    out.version = env.version || ''
    out.apiVersion = env.apiVersion || 0
    out.model = env.deviceModel || ''
    out.width = env.deviceWidth || 0
    out.height = env.deviceHeight || 0
  } catch (e) { /* 忽略 */ }
  return out
}
