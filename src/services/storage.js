// 平台存储：优先走 $falcon.jsapi.storage（应用私有命名空间），文件通道退回兜底。
//
// 为什么不能只靠文件：同机型（X7 / rk）上的另一个小程序实测「panet 的文件 API 报成功
// 但不落盘」——writeFile 返回正常、目录里也有文件，重启后内容却没了或读到空的。
// 所以从 v0.1.20 起，设置/会话同时写两份：文件（好排查，能用 adb 直接看）+ storage
// （宿主托管，真正会落盘的那个）。读的时候文件优先，文件读不到或内容坏了再读 storage。
//
// 真机事实（照这份平台笔记来，改之前先读一遍）：
//  - **必须在对象上直接调用**：st.getStorage({key})。把方法摘出来单独调、或用
//    .call/.apply，QuickJS 原生方法会丢 receiver 直接失败，且本平台禁止补救。
//  - 参数两种形态都要试：{key: k} 和裸字符串 k；写是 {key, data}（item 风格 {key, value}）。
//  - 返回形态多样：字符串 / {data} / {value} / {result} / Promise（还可能 reject）。
//    Promise 失败不接会崩（真机 Error: nf），所以这里统一 .then(ok, fail) 吞掉。
//  - 读 800ms、写 1000ms 超时；超时按失败处理，调用方自己兜底。
//  - 应用私有存储卸载重装即清空；设备级 setGlobalStorage 重装不丢（本工程不用它）。

const READ_TIMEOUT = 800
const WRITE_TIMEOUT = 1000

function errText(e) {
  if (!e) return 'unknown'
  if (typeof e === 'string') return e
  const s = [e.name, e.message].filter(Boolean).join(' ')
  return s || String(e)
}

function safeFalcon() {
  try {
    return (typeof $falcon !== 'undefined' && $falcon) ? $falcon : null
  } catch (e) { return null }
}

// storage 对象可能挂在 $falcon.jsapi / $falcon 两级，形如 storage 或 item 风格
function pickApi() {
  const f = safeFalcon()
  if (!f) return null
  const scopes = []
  try { if (f.jsapi && typeof f.jsapi === 'object') scopes.push(f.jsapi) } catch (e) { /* 忽略 */ }
  scopes.push(f)
  for (let i = 0; i < scopes.length; i++) {
    let st = null
    try { st = scopes[i].storage } catch (e) { st = null }
    if (!st) continue
    try {
      if (typeof st.getStorage === 'function' && typeof st.setStorage === 'function') {
        return { obj: st, kind: 'jsapi-storage' }
      }
      if (typeof st.getItem === 'function' && typeof st.setItem === 'function') {
        return { obj: st, kind: 'jsapi-item' }
      }
    } catch (e) { /* 忽略 */ }
  }
  return null
}

let _apiCache
let _apiAt = 0
// 探测一次缓存住；1 分钟后再探（宿主对象可能在切页/热启动后换掉）
function api() {
  const now = Date.now()
  if (_apiCache !== undefined && now - _apiAt < 60000) return _apiCache
  _apiAt = now
  try { _apiCache = pickApi() } catch (e) { _apiCache = null }
  return _apiCache
}

export function storageKind() {
  const a = api()
  return a ? a.kind : 'none'
}

export function storageAvailable() {
  return !!api()
}

// storage 上到底有哪些方法（诊断行用，排查"这个固件什么形态"）
export function storageApiNames() {
  const a = api()
  if (!a) return ''
  const out = []
  try {
    for (const k in a.obj) out.push(k)
  } catch (e) { /* 忽略 */ }
  if (!out.length) {
    try {
      const names = Object.getOwnPropertyNames(a.obj)
      for (let i = 0; i < names.length; i++) out.push(names[i])
    } catch (e) { /* 忽略 */ }
  }
  return out.join(',')
}

// 统一成 {ok, value, error}：同步返回值 / Promise / 抛错 / 超时都收敛到这里
function withTimeout(fn, ms) {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      resolve({ ok: false, value: null, error: 'timeout ' + ms + 'ms' })
    }, ms)
    const finish = (r) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    let ret
    try {
      ret = fn()
    } catch (e) {
      finish({ ok: false, value: null, error: errText(e) })
      return
    }
    if (ret && typeof ret.then === 'function') {
      // 不接 rejection 会崩（Error: nf），两个分支都给
      ret.then((v) => finish({ ok: true, value: v, error: '' }),
        (e) => finish({ ok: false, value: null, error: errText(e) }))
    } else {
      finish({ ok: true, value: ret, error: '' })
    }
  })
}

function extract(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    const keys = ['data', 'value', 'result', 'content', 'text']
    for (let i = 0; i < keys.length; i++) {
      const x = v[keys[i]]
      if (x === undefined || x === null) continue
      if (typeof x === 'string') return x
      // {data: {value: '...'}} 这种套娃也见得到
      if (typeof x === 'object') {
        const y = extract(x)
        if (y !== null) return y
      } else return String(x)
    }
  }
  return null
}

// 读一个 key。失败/超时/空串都返回 null，调用方自行兜底
export async function storageGet(key) {
  const a = api()
  if (!a) return null
  const st = a.obj
  const item = a.kind === 'jsapi-item'
  const calls = item
    ? [() => st.getItem({ key: key }), () => st.getItem(key)]
    : [() => st.getStorage({ key: key }), () => st.getStorage(key)]
  for (let i = 0; i < calls.length; i++) {
    const r = await withTimeout(calls[i], READ_TIMEOUT)
    if (!r.ok) continue
    const v = extract(r.value)
    // 部分固件"写成功但读回空串"，空串当没读到，继续试下一种形态
    if (v !== null && v !== '') return v
  }
  return null
}

// 写一个 key。返回 true 只代表宿主没报错，关键数据仍建议回读
export async function storageSet(key, text) {
  const a = api()
  if (!a) return false
  const st = a.obj
  const s = String(text == null ? '' : text)
  const item = a.kind === 'jsapi-item'
  const calls = item
    ? [() => st.setItem({ key: key, value: s }), () => st.setItem({ key: key, data: s })]
    : [() => st.setStorage({ key: key, data: s }), () => st.setStorage({ key: key, value: s })]
  for (let i = 0; i < calls.length; i++) {
    const r = await withTimeout(calls[i], WRITE_TIMEOUT)
    if (r.ok) return true
  }
  return false
}

export async function storageRemove(key) {
  const a = api()
  if (!a) return false
  const st = a.obj
  const item = a.kind === 'jsapi-item'
  try {
    const fn = item ? st.removeItem : st.removeStorage
    if (typeof fn !== 'function') return false
    const r = await withTimeout(() => fn({ key: key }), WRITE_TIMEOUT)
    return r.ok
  } catch (e) {
    return false
  }
}

// 诊断用：写探针 → 回读 → 比对。设置页「诊断」把结果直接摆出来
export async function storageSelfTest() {
  const a = api()
  if (!a) return { ok: false, kind: 'none', step: 'detect', error: '宿主没有 storage' }
  const key = '__dp_probe'
  const text = 'ok-' + Date.now()
  const w = await storageSet(key, text)
  if (!w) return { ok: false, kind: a.kind, step: 'write', error: '写入失败或超时' }
  const back = await storageGet(key)
  if (back === null) return { ok: false, kind: a.kind, step: 'read', error: '写进去读不出来' }
  if (back !== text) return { ok: false, kind: a.kind, step: 'compare', error: '读回内容不一致' }
  return { ok: true, kind: a.kind, step: 'done', error: '' }
}
