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
import { logLine, seedLog, setLogSink, flushNow, logText, logTail, logStats } from '../lib/logfile.js'
import { planWrites, describeWriteFail } from '../lib/writeplan.js'
import { mkdirChain } from '../lib/paths.js'

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
  try {
    // 本机 $dataDir 偶尔带重复斜杠（.../8000000000182399//data），拼出来很难看，
    // 也容易在日志里误判成"写到了别的目录"
    return String($dataDir || '/tmp').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  } catch (e) { return '/tmp' }
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

export function appLogPath() {
  return joinPath(dataDirBase(), 'deepseek', 'app.log')
}

// 建过的目录记一笔：tempDir() 每次请求都会调到这里，逐段 mkdir 每次都重刷一遍系统调用
// 没必要。写文件抛异常时（writeTextEx 的 catch）会清空缓存，下一轮重试重新逐段建 ——
// 这也照顾了"目录被外部删掉"的情况。
let _dirOk = {}
export function resetDirCache() { _dirOk = {} }

// 目录已存在时 fs.mkdir 也会抛，不能一律当失败，否则每次 ensureAppDir 都记一条假错误
function isExistErr(msg) {
  const s = String(msg || '').toLowerCase()
  return s.indexOf('exist') >= 0 || s.indexOf('errno=17') >= 0
}

export function ensureAppDir(sub) {
  const dir = sub ? joinPath(appDir(), sub) : appDir()
  if (_dirOk[dir]) return dir
  // 从 dataDir 起逐段建：父链缺任何一级，单次 mkdir 都会 ENOENT，
  // 而 writeFile 又"不报错也不落盘"，结果就是日志静默丢失（真机上复现过）
  const list = mkdirChain(dataDirBase(), dir)
  let lastErr = ''
  for (let i = 0; i < list.length; i++) {
    try {
      fs.mkdir(list[i])
    } catch (e) {
      const msg = errText(e)
      if (!isExistErr(msg)) lastErr = list[i] + ' :: ' + msg
    }
  }
  if (lastErr) {
    // 首次启动最常见：文件系统还没就绪。以前这里静默忽略，然后 writeFile
    // "不报错也不落盘"，用户看到的就是保存失败/保存后消失，而日志里什么都没有。
    if (_mkdirErrOnce !== lastErr) { _mkdirErrOnce = lastErr; logLine('W', 'mkdir 失败 ' + lastErr) }
  } else {
    _dirOk[dir] = 1
  }
  return dir
}
let _mkdirErrOnce = ''

// 日志落盘：本机没有 appendFile，只能读旧 + 整份重写，所以由 logfile 攒批后调这里
let _logReady = false
export async function initLog(version) {
  if (_logReady) return true
  _logReady = true
  // 目录不在时 writeFile 不报错也不落盘（本机特性），所以日志目录要先建好
  ensureAppDir()
  setLogSink((text) => writeTextEx(appLogPath(), text).ok)
  // 先落"启动"这一行再 await 读旧日志：否则它会被排到 onLaunch 后续日志的后面，
  // 日志读起来就成了"先干活，后开机"
  logLine('I', '--- start v' + String(version || '?') + ' dataDir=' + dataDirBase() + ' ---')
  // 环境自检一行：机型 / 框架版本 / 写文件通道 / fs 暴露了哪些方法。
  // 换机型出问题时，这一行就能直接看出"写不进去"是缺 API 还是别的原因。
  logLine('I', 'env ' + envDump())
  try {
    const old = await fs.readFile(appLogPath())
    if (old) seedLog(String(old))   // seedLog 会把旧内容插到最前面
  } catch (e) { /* 首次启动没有旧日志，正常 */ }
  flushNow()
  return true
}

export function logDump() {
  return { text: logText(), stats: logStats() }
}

export { logTail, logLine }

// 应用日志：既要能在 logcat 看见（排查时顺手），也要落盘（用户设备上唯一的线索）
export function log() {
  try {
    const args = []
    for (let i = 0; i < arguments.length; i++) {
      const a = arguments[i]
      if (a && typeof a === 'object') {
        try { args.push(JSON.stringify(a)) } catch (e) { args.push(String(a)) }
      } else args.push(String(a))
    }
    const msg = args.join(' ')
    console.log(APP_TAG + ' ' + msg)
    logLine('I', msg)
  } catch (e) { /* 忽略 */ }
}

// 异常统一格式化：把 message / name / errno 都带上，否则日志里只有 "[object Object]"
export function errText(e) {
  if (!e) return 'unknown'
  if (typeof e === 'string') return e
  const parts = []
  if (e.name) parts.push(String(e.name))
  if (e.message) parts.push(String(e.message))
  if (e.errno !== undefined && e.errno !== null) parts.push('errno=' + e.errno)
  if (e.code) parts.push('code=' + e.code)
  const s = parts.join(' ').trim()
  return s || String(e)
}

export function logErr(tag, e) {
  const msg = tag + ' :: ' + errText(e)
  try { console.log(APP_TAG + ' E ' + msg) } catch (x) { /* 忽略 */ }
  logLine('E', msg)
  return msg
}


export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 单引号安全引用（路径/关键字拼进 shell 命令时用）
export function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

export async function readText(path, retries) {
  const r = await readTextEx(path, retries)
  return r.ok ? r.text : null
}

// 带原因的读：以前失败只有 null，分不清"文件不存在"和"文件系统没就绪"，
// 于是既不敢少重试、也没法在日志里留下证据。
export async function readTextEx(path, retries) {
  const n = typeof retries === 'number' ? retries : 1
  let lastErr = ''
  for (let i = 0; i < n; i++) {
    try {
      const v = await fs.readFile(path)
      if (v !== null && v !== undefined) return { ok: true, text: String(v), error: '' }
      lastErr = 'empty'
    } catch (e) {
      lastErr = errText(e)
    }
    if (i < n - 1) await sleep(400)
  }
  return { ok: false, text: null, error: lastErr }
}

// ---------- 写文件：多后端兜底 ----------
// 文档里的 fs（限本应用 data 目录）只列了 readdir / stat / exists / readFile / mkdir / rm，
// **没有 writeFile**。X7 的固件额外带了这个方法，所以开发机上一直好用；换机型 / 换固件
// 它就是 undefined，调用当场 "TypeError: not a function"，用户看到的是
// "保存失败：写入被拒绝"，而 app.log 一起写不进去 —— 等于现场没有任何线索。
// 所以写操作按顺序挑一个真能用的通道，并把结果记进日志（env 那一行）。
let _writeBackend = ''
let _writeLogged = ''

// 这台设备上到底有哪几条通道（探测一次，结果不缓存：通道状态可能随环境变化）
function availableWrites() {
  const av = {}
  try {
    if (fs && typeof fs.writeFile === 'function') av['fs.writeFile'] = true
    if (fs && typeof fs.writeFileSync === 'function') av['fs.writeFileSync'] = true
  } catch (e) { /* fs 本身异常，只剩 shell */ }
  const g = getGlobal()
  if (g && typeof g.execShell === 'function') av.shell = true
  return av
}

export function writeBackend() {
  if (_writeBackend) return _writeBackend
  const list = planWrites(availableWrites(), '')
  return list.length ? list[0] : ''
}

function detectWriteBackend() {
  return writeBackend()
}

function fsApiKeys() {
  const out = []
  try {
    for (const k in fs) out.push(k)
  } catch (e) { /* 宿主对象可能不可枚举 */ }
  try {
    const names = Object.getOwnPropertyNames(fs)
    for (let i = 0; i < names.length; i++) if (out.indexOf(names[i]) < 0) out.push(names[i])
  } catch (e) { /* 忽略 */ }
  return out
}

// 一行环境摘要，进日志用。字段都用短名：屏幕窄，日志也短。
export function envDump() {
  const o = { write: detectWriteBackend() || '-' }
  try { o.model = String($falcon.env.deviceModel || '') } catch (e) { /* 无 $falcon */ }
  try { o.ui = String($falcon.env.version || '') } catch (e) { /* 忽略 */ }
  try { o.api = String($falcon.env.apiVersion || '') } catch (e) { /* 忽略 */ }
  try { o.wh = String($falcon.env.deviceWidth || '') + 'x' + String($falcon.env.deviceHeight || '') } catch (e) { /* 忽略 */ }
  const keys = fsApiKeys()
  o.fs = keys.length ? keys.join(',') : '-'
  try { return JSON.stringify(o) } catch (e) { return 'write=' + o.write }
}

// shell 通道：printf 不做转义解析，内容原样落盘；单引号交给 shq 处理。
// 缺点是要把内容塞进命令行，超大文件会撞 ARG_MAX —— 目前最大的是 chats.json（几十 KB），
// 离上限还很远。
function writeViaShell(path, text) {
  const g = getGlobal()
  if (!g || typeof g.execShell !== 'function') return { ok: false, error: 'execShell 不可用' }
  try {
    const ret = g.execShell('printf %s ' + shq(text) + ' > ' + shq(path))
    // 本固件 execShell 返回 boolean；false 说明命令没跑起来，产物是否落盘仍靠回读确认
    if (ret === false) return { ok: false, error: 'execShell 返回 false' }
    return { ok: true, error: '' }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

function callFsWrite(fn) {
  try {
    fn()
    return { ok: true, error: '' }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

// 返回 null 表示这条通道在这台设备上不存在
function runWrite(backend, path, text) {
  if (backend === 'fs.writeFile') {
    if (typeof fs.writeFile !== 'function') return null
    return callFsWrite(() => fs.writeFile(path, text))
  }
  if (backend === 'fs.writeFileSync') {
    if (typeof fs.writeFileSync !== 'function') return null
    return callFsWrite(() => fs.writeFileSync(path, text))
  }
  if (backend === 'shell') return writeViaShell(path, text)
  return null
}

// 同步写入，故意不返回 Promise：本机 fs.writeFile 是同步实现
export function writeText(path, text) {
  return writeTextEx(path, text).ok
}

// 带原因的写。注意本机一个坑：**目录不存在时 writeFile 不抛错也不落盘**，
// 所以 ok=true 并不等于真的写进去了 —— 调用方该回读的地方还是要回读。
export function writeTextEx(path, text) {
  const s = String(text == null ? '' : text)
  const order = planWrites(availableWrites(), _writeBackend)
  const fails = []
  for (let i = 0; i < order.length; i++) {
    const b = order[i]
    const r = runWrite(b, path, s)
    if (!r) { fails.push({ backend: b, error: '不可用' }); continue }
    if (r.ok) {
      if (_writeBackend !== b) _writeBackend = b
      if (!_writeLogged) {
        _writeLogged = b
        // 只在通道首次确定时记一次，避免刷屏（这条本身走日志缓冲，不会递归）
        if (i > 0) logLine('W', '写文件通道切到 ' + b + '（首选不可用）')
      }
      return { ok: true, error: '' }
    }
    fails.push({ backend: b, error: r.error })
  }
  // 写失败常见原因是目录没了（被清理、被换掉）。清掉缓存，下一次 ensureAppDir
  // 会重新逐段建，而不是因为"记着建过"直接跳过。
  _dirOk = {}
  return { ok: false, error: describeWriteFail(fails) }
}

export function writeFileSync(path, data) {
  return writeTextEx(path, String(data == null ? '' : data)).ok
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
  try {
    const v = await fs.exists(path)
    // 有固件把 fs.exists 实现成占位对象（返回 {tip:"FileModule.exists"}），
    // 那是真值 —— 直接 !! 会永远判"存在"，后面读不到又去重试，白等 1.2s。
    if (typeof v === 'boolean') return v
  } catch (e) { /* 走兜底 */ }
  const r = await readTextEx(path, 1)
  return r.ok
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
