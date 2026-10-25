// DeepSeek API 客户端（纯 API 端点，不经过任何反代）
//
// 为什么用 curl 而不是 fetch/JSAPI：
//  1) 本设备 curl 7.79.1 + OpenSSL，实测直连 api.deepseek.com 0.3s（200）；
//  2) QuickJS 下没有流式 fetch，SSE 只能靠 `curl -N` 落盘 + 轮询增量读；
//  3) 认证头用 `-H @file` 传入，key 不出现在 `ps` 命令行里。
//
// ⚠️ 本固件（4.9.9）的 `global.Global.execShell` 是**同步阻塞**的：
//   它会一直等到整条命令退出才返回，期间的 JS 线程完全不跑。
//    实测证据：发一条长回复，`tmp/*.out` 在 2s 时已 64KB、4s 时 1.3MB，
//    但屏幕 4 秒内一动不动，「停止」按钮点了也没反应，直到 curl 退出才一次性
//    把全文画出来 —— 也就是说"流式"从来没真的流过，界面是"卡死→瞬间全出"。
//    无网时 curl 会一直等到 --max-time（原来 180s），于是表现为"卡死变砖"。
//  修法：把 curl 用 `setsid` 扔进独立会话后台跑，shell 立刻返回。
//    JS 线程因此一直空闲，才能做到：真流式、随时「停止」、超时/断网快速报错。
//
// 平台契约（真机验证）：execShell 无回显，一切产物靠文件落地 + 轮询。

import { execShell, readText, writeText, removeFile, exists, ensureAppDir, joinPath, shq, sleep } from './platform.js'
import { parseSse, readChunk } from '../lib/sse.js'
import { holidaySources, parseHolidayPayload, HOLIDAY_UA } from '../lib/holiday.js'
import { holdIncompleteTail, stripInternalTags } from '../lib/text.js'
import { parseSearchResults } from '../lib/search.js'

const POLL_MS = 120
const TMP_KEEP = false
// 连接阶段上限：断网/域名解析不了时必须在几秒内失败，绝不能拖到整体超时
const CONNECT_TIMEOUT_S = 8
// 整体上限（秒）
const DEFAULT_TIMEOUT_MS = 120000
// 首包/中途静默上限：超过这么久一个新字节都没有，判网络假死并杀掉 curl
const IDLE_TIMEOUT_MS = 45000

function tmpDir() {
  return ensureAppDir('tmp')
}

function apiErr(code, message, raw) {
  const e = new Error(message)
  e.code = code
  e.raw = raw
  return e
}

// HTTP/业务错误 → 人话
export function explainError(status, text) {
  let msg = ''
  let code = ''
  try {
    const obj = JSON.parse(String(text || ''))
    if (obj && obj.error) {
      msg = obj.error.message || ''
      code = obj.error.code || obj.error.type || ''
    }
  } catch (e) { /* 非 JSON */ }

  if (status === 401) return 'API Key 无效或已失效（401）' + (msg ? '：' + msg : '')
  if (status === 402) return '账户余额不足（402）' + (msg ? '：' + msg : '')
  if (status === 429) return '请求过于频繁，被限流（429），请稍后再试' + (msg ? '：' + msg : '')
  if (status === 400) return '请求参数有误（400）' + (msg ? '：' + msg : '')
  if (status === 404) return '接口路径不存在（404），请检查服务地址' + (msg ? '：' + msg : '')
  if (status >= 500) return '服务端错误（' + status + '）' + (msg ? '：' + msg : '')
  if (status === 0) return '无法连接服务器，请检查网络与服务地址' + (msg ? '：' + msg : '')
  return 'HTTP ' + status + (msg ? '：' + msg : msg ? '' : (text ? String(text).slice(0, 120) : ''))
}

function buildCurl(opts) {
  const dir = tmpDir()
  const token = 'ds' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
  const reqFile = joinPath(dir, token + '.req.json')
  const hdrFile = joinPath(dir, token + '.hdr')
  const outFile = joinPath(dir, token + '.out')
  const errFile = joinPath(dir, token + '.err')
  const statusFile = joinPath(dir, token + '.status')
  const flagFile = joinPath(dir, token + '.done')
  const pidFile = joinPath(dir, token + '.pid')
  // 响应头单独落盘（只在要读 Date 校时的时候用）
  const respHdrFile = joinPath(dir, token + '.rhdr')

  if (opts.body) writeText(reqFile, JSON.stringify(opts.body))
  // 没给 Key 的请求（如节假日数据）不要带空的 Authorization，
  // 有的 CDN / WAF 看到 `Bearer `（空值）会直接 400。
  let hdr = 'Content-Type: application/json\n'
  if (opts.apiKey) hdr += 'Authorization: Bearer ' + String(opts.apiKey) + '\n'
  // jsDelivr 前面的 Cloudflare 会按 UA 判定：curl 默认 UA 会被丢进人机校验（403），
  // 所以拉第三方数据时显式伪装成桌面浏览器。
  if (opts.userAgent) hdr += 'User-Agent: ' + String(opts.userAgent) + '\n'
  writeText(hdrFile, hdr)

  const url = opts.url ? String(opts.url) : (String(opts.baseUrl).replace(/\/+$/, '') + opts.path)
  const secs = Math.ceil((opts.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000)
  const connectS = opts.connectTimeoutS || CONNECT_TIMEOUT_S

  // 注意：这里的每一段都会成为 `sh -c` 的命令体，因此内部管道/引号都已用 shq 转过义
  const inner =
    'echo $$ > ' + shq(pidFile) + '; ' +
    'curl -sS -N --connect-timeout ' + connectS +
    ' --max-time ' + secs +
    ' -X ' + (opts.method || 'POST') +
    ' -H @' + shq(hdrFile) +
    (opts.method === 'GET' ? '' : ' --data-binary @' + shq(reqFile)) +
    (opts.dumpHeaders ? ' -D ' + shq(respHdrFile) : '') +
    ' -o ' + shq(outFile) +
    " -w '%{http_code}' " + shq(url) +
    ' > ' + shq(statusFile) + ' 2> ' + shq(errFile) +
    '; printf 1 > ' + shq(flagFile)

  launchDetached(inner)

  return {
    token: token, reqFile: reqFile, hdrFile: hdrFile, outFile: outFile,
    errFile: errFile, statusFile: statusFile, flagFile: flagFile, pidFile: pidFile,
    respHdrFile: respHdrFile
  }
}

// 把命令丢到独立会话里跑，立刻返回。
// setsid: 脱离当前会话/进程组，execShell 等不到它；fd 全部重定向，避免它把
// execShell 的管道占住（那会让 execShell 一直等到 curl 结束，等于没解决）。
function launchDetached(inner) {
  const cmd = 'setsid sh -c ' + shq(inner) + ' >/dev/null 2>&1 </dev/null &'
  try { execShell(cmd) } catch (e) { /* 下面靠 out 文件是否存在判断成败 */ }
}

async function cleanup(files) {
  if (TMP_KEEP) return
  const all = [files.reqFile, files.hdrFile, files.outFile, files.errFile, files.statusFile, files.flagFile, files.pidFile, files.respHdrFile]
  for (let i = 0; i < all.length; i++) await removeFile(all[i])
}

// 取消：优先按 pid 杀整个进程组，再兜底按 token 匹配命令行
export function cancelFiles(files) {
  if (!files) return
  const p = '$(cat ' + shq(files.pidFile) + ' 2>/dev/null)'
  execShell(
    'P=' + p + '; ' +
    'if [ -n "$P" ]; then kill -TERM -$P 2>/dev/null; kill -9 -$P 2>/dev/null; kill -9 $P 2>/dev/null; fi; ' +
    'pkill -f ' + shq(files.token) + ' 2>/dev/null; ' +
    'printf 1 > ' + shq(files.flagFile) + '; true'
  )
}

export function cancelToken(token) {
  execShell('pkill -f ' + shq(token) + ' 2>/dev/null; true')
}

async function readStatus(files) {
  const s = (await readText(files.statusFile, 1)) || ''
  return parseInt(s.replace(/[^\d]/g, '') || '0', 10)
}

// 列模型：设置页「扫描可用模型」与引导页「测试连接」共用
export async function listModels(opts) {
  const timeoutMs = opts.timeoutMs || 15000
  const files = buildCurl({
    baseUrl: opts.baseUrl, apiKey: opts.apiKey, path: '/models',
    method: 'GET', timeoutMs: timeoutMs, body: null
  })
  try {
    const ok = await waitFlag(files, timeoutMs)
    if (!ok) {
      cancelFiles(files)
      throw apiErr('TIMEOUT', '获取模型列表超时（' + Math.round(timeoutMs / 1000) + 's）')
    }
    const status = await readStatus(files)
    const body = (await readText(files.outFile, 1)) || ''
    if (status !== 200) throw apiErr('HTTP_' + status, explainError(status, body), body)
    const obj = JSON.parse(body)
    const arr = Array.isArray(obj.data) ? obj.data : []
    // 只保留 id，其它字段（object/owned_by）对界面没用
    return arr.map((m) => ({ id: String(m && m.id || ''), owned: String(m && m.owned_by || '') }))
      .filter((m) => m.id)
  } finally {
    await cleanup(files)
  }
}

// 余额查询地址。
// 官方文档是 `GET /user/balance`（**裸根路径**），而本项目的 baseUrl 默认带 `/v1`
// （chat/completions、models 都在 /v1 下），直接拼会 404，所以这里去掉末尾的 /v1。
export function balanceEndpoint(baseUrl) {
  const root = String(baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '')
  return root + '/user/balance'
}

// 查余额：GET /user/balance
// 返回 { available, currency, total, granted, toppedUp, totalText, serverTime }
// serverTime 来自响应头 Date，用于校准设备时钟（峰谷判定完全依赖"现在几点"）。
export async function fetchBalance(opts) {
  const timeoutMs = opts.timeoutMs || 8000
  const files = buildCurl({
    url: balanceEndpoint(opts.baseUrl),
    apiKey: opts.apiKey,
    method: 'GET',
    timeoutMs: timeoutMs,
    connectTimeoutS: 6,
    body: null,
    dumpHeaders: true
  })
  try {
    const ok = await waitFlag(files, timeoutMs)
    if (!ok) {
      cancelFiles(files)
      throw apiErr('TIMEOUT', '余额查询超时（' + Math.round(timeoutMs / 1000) + 's）')
    }
    const status = await readStatus(files)
    const body = (await readText(files.outFile, 1)) || ''
    if (status !== 200) {
      const errText = (await readText(files.errFile, 1)) || ''
      if (!status && errText) throw apiErr('NETWORK', explainCurl(errText))
      // 第三方反代通常没有实现这个端点 → 404，文案要说清不是 Key 的问题
      if (status === 404) throw apiErr('NO_ENDPOINT', '该服务地址没有 /user/balance 接口（余额仅官方地址可用）')
      throw apiErr('HTTP_' + status, explainError(status, body), body)
    }
    let obj = null
    try { obj = JSON.parse(body) } catch (e) { throw apiErr('PARSE', '余额返回无法解析') }

    const infos = Array.isArray(obj && obj.balance_infos) ? obj.balance_infos : []
    let one = null
    for (let i = 0; i < infos.length; i++) {
      if (String(infos[i] && infos[i].currency).toUpperCase() === 'CNY') { one = infos[i]; break }
    }
    if (!one) one = infos[0] || {}

    const rawHdr = (await readText(files.respHdrFile, 1)) || ''
    const dm = /^date:[ \t]*(.+)$/im.exec(rawHdr)
    let serverTime = 0
    if (dm) {
      const parsed = Date.parse(dm[1].replace(/\r/g, '').trim())
      if (isFinite(parsed)) serverTime = parsed
    }

    return {
      available: obj && obj.is_available === true,
      currency: String(one.currency || ''),
      total: num(one.total_balance),
      granted: num(one.granted_balance),
      toppedUp: num(one.topped_up_balance),
      totalText: String(one.total_balance == null ? '' : one.total_balance),
      serverTime: serverTime
    }
  } finally {
    await cleanup(files)
  }
}

function num(v) {
  const n = parseFloat(v)
  return isFinite(n) ? n : 0
}

// ---- 法定节假日 ----
// 解析与数据源在 lib/holiday.js（纯函数，可单测）；这里只负责"把 curl 跑起来"。
// 拉不到就退回 peak.js 里的内置表，功能不受影响。
export async function fetchHolidayYear(year, opts) {
  const options = opts || {}
  const timeoutMs = options.timeoutMs || 6000
  const list = holidaySources(year)
  let lastErr = null
  for (let i = 0; i < list.length; i++) {
    const src = list[i]
    const files = buildCurl({
      url: src.url,
      apiKey: '',
      userAgent: HOLIDAY_UA,
      method: 'GET',
      timeoutMs: timeoutMs,
      connectTimeoutS: 5,
      body: null,
      dumpHeaders: false
    })
    try {
      const ok = await waitFlag(files, timeoutMs)
      if (!ok) { cancelFiles(files); lastErr = 'TIMEOUT'; continue }
      const status = await readStatus(files)
      const body = (await readText(files.outFile, 2)) || ''
      if (status !== 200) { lastErr = 'HTTP ' + status; continue }
      const days = parseHolidayPayload(src.kind, body, year)
      if (!days) { lastErr = 'EMPTY'; continue }
      return { year: Number(year), days: days, source: src.kind, url: src.url }
    } catch (e) {
      lastErr = (e && e.code) || 'ERR'
    } finally {
      await cleanup(files)
    }
  }
  throw apiErr('HOLIDAY_FAIL', '节假日数据拉取失败（' + String(lastErr || 'unknown') + '）')
}

// 引导页 / 设置页的「测试连接」：一次拿到结论，不让界面傻等
export async function testConnection(opts) {
  try {
    const models = await listModels({ baseUrl: opts.baseUrl, apiKey: opts.apiKey, timeoutMs: 15000 })
    if (!models.length) return { ok: false, error: '连接成功但模型列表为空', models: [] }
    return { ok: true, models: models, error: '' }
  } catch (e) {
    return { ok: false, models: [], error: (e && e.message) || '连接失败' }
  }
}

async function waitFlag(files, timeoutMs) {
  const start = Date.now()
  const limit = timeoutMs || DEFAULT_TIMEOUT_MS
  while (Date.now() - start < limit) {
    if (await exists(files.flagFile)) return true
    await sleep(POLL_MS)
  }
  return false
}

// 主入口：发一条对话。
// handlers: onContent(text, full) / onReasoning(text, full) / onUsage(usage) / onFinish(info)
// 返回 { content, reasoning, usage, finishReason, status }
export async function sendChat(opts) {
  const handlers = opts.handlers || {}
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS
  const files = buildCurl({
    baseUrl: opts.baseUrl, apiKey: opts.apiKey, path: '/chat/completions',
    method: 'POST', body: opts.body, timeoutMs: timeoutMs
  })

  let content = ''
  let reasoning = ''
  let usage = null
  let finishReason = ''
  let done = false
  let consumed = 0
  let buffer = ''
  let upstreamError = null

  const handleEvents = (events) => {
    for (let i = 0; i < events.length; i++) {
      const ev = readChunk(events[i])
      if (ev.kind === 'done') { done = true; continue }
      if (ev.kind === 'error') { upstreamError = ev.text; continue }
      if (ev.kind === 'meta') {
        if (ev.obj && ev.obj.usage) { usage = ev.obj.usage; if (handlers.onUsage) handlers.onUsage(usage) }
        if (ev.finishReason) finishReason = ev.finishReason
        continue
      }
      if (ev.kind === 'reasoning') {
        reasoning += ev.text
        if (handlers.onReasoning) handlers.onReasoning(ev.text, reasoning)
        continue
      }
      if (ev.kind === 'content') {
        content += ev.text
        if (handlers.onContent) handlers.onContent(ev.text, content)
      }
    }
  }

  const drain = async () => {
    const raw = await readText(files.outFile, 1)
    if (!raw) return 0
    // 末尾可能是半个多字节字符：先扣住，下一轮再拼，避免被解码成替换字符后错位
    const held = holdIncompleteTail(raw)
    if (held.complete.length <= consumed) return 0
    const fresh = held.complete.slice(consumed)
    consumed = held.complete.length
    if (!fresh) return 0
    const parsed = parseSse(buffer + fresh)
    buffer = parsed.rest
    handleEvents(parsed.events)
    return fresh.length
  }

  try {
    const start = Date.now()
    let lastDataAt = start
    for (;;) {
      if (opts.shouldCancel && opts.shouldCancel()) {
        cancelFiles(files)
        throw apiErr('CANCELLED', '已停止')
      }
      await sleep(POLL_MS)
      const got = await drain()
      if (got > 0) lastDataAt = Date.now()
      if (upstreamError) break
      if (done) break
      if (await exists(files.flagFile)) {
        await drain() // curl 结束时可能刚写完最后一段
        break
      }
      const now = Date.now()
      if (now - start > timeoutMs) {
        cancelFiles(files)
        throw apiErr('TIMEOUT', '请求超时（' + Math.round(timeoutMs / 1000) + 's）')
      }
      // 静默超时：连上了但迟迟没有数据（弱网、DNS 黑洞、代理断了）
      if (!content && !reasoning && now - lastDataAt > IDLE_TIMEOUT_MS) {
        cancelFiles(files)
        throw apiErr('NETWORK', '网络无响应（' + Math.round(IDLE_TIMEOUT_MS / 1000) + 's 未收到任何数据）')
      }
    }

    const status = await readStatus(files)

    if (upstreamError) throw apiErr('API', upstreamError)
    if (status && status !== 200) {
      const body = (await readText(files.outFile, 1)) || ''
      throw apiErr('HTTP_' + status, explainError(status, body), body)
    }
    if (!done && !content && !reasoning) {
      const errText = (await readText(files.errFile, 1)) || ''
      const body = (await readText(files.outFile, 1)) || ''
      if (errText && /curl:/.test(errText)) {
        throw apiErr('NETWORK', explainCurl(errText))
      }
      throw apiErr('EMPTY', '没有收到任何内容' + (body ? '：' + String(body).slice(0, 120) : ''))
    }
    if (!done && (content || reasoning)) finishReason = finishReason || 'incomplete'

    const result = {
      content: stripInternalTags(content),
      reasoning: stripInternalTags(reasoning),
      usage: usage,
      finishReason: finishReason || 'stop',
      status: status
    }
    if (handlers.onFinish) handlers.onFinish(result)
    return result
  } finally {
    await cleanup(files)
  }
}

// curl 的报错原文 → 人话
function explainCurl(errText) {
  const one = String(errText).replace(/^curl:\s*/i, '').split('\n')[0] || ''
  if (/timed out|Timeout/i.test(one)) return '连接超时，请检查网络（' + one + '）'
  if (/Could not resolve|resolve host/i.test(one)) return '域名解析失败，请检查网络或服务地址'
  if (/Connection refused/i.test(one)) return '服务拒绝连接，请检查服务地址'
  if (/certificate|SSL/i.test(one)) return 'TLS 握手失败（' + one + '）'
  return one
}

// 非流式 POST：一次拿完整 JSON。
// sendOnce（chat）和 searchWeb（tools/search）共用这段轮询骨架 ——
// 两者的差别只有路径和返回体解析，没必要各写一遍。
async function postJson(opts) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS
  const files = buildCurl({
    baseUrl: opts.baseUrl, apiKey: opts.apiKey, path: opts.path,
    method: 'POST', body: opts.body, timeoutMs: timeoutMs
  })
  try {
    const start = Date.now()
    let ok = false
    while (Date.now() - start < timeoutMs) {
      if (opts.shouldCancel && opts.shouldCancel()) {
        cancelFiles(files)
        throw apiErr('CANCELLED', '已停止')
      }
      if (await exists(files.flagFile)) { ok = true; break }
      await sleep(POLL_MS)
    }
    if (!ok) {
      cancelFiles(files)
      throw apiErr('TIMEOUT', '请求超时（' + Math.round(timeoutMs / 1000) + 's）')
    }
    const status = await readStatus(files)
    const body = (await readText(files.outFile, 1)) || ''
    if (status !== 200) {
      const errText = (await readText(files.errFile, 1)) || ''
      if (!status && errText) throw apiErr('NETWORK', explainCurl(errText))
      throw apiErr('HTTP_' + status, explainError(status, body), body)
    }
    return { status: status, body: body }
  } finally {
    await cleanup(files)
  }
}

// 联网搜索：POST /v1/tools/search
// 官方是原始 JSON API，不是 SSE —— 一次请求一次响应，比 chat 简单。
// baseUrl 默认带 /v1（chat/models 的约定），所以这里只拼 /tools/search。
// 计费：0.005 元/次成功请求（返回非空 results 才收费）。
export async function searchWeb(opts) {
  const count = Math.max(1, Math.min(10, parseInt(opts.count, 10) || 6))
  const body = {
    query: String(opts.query || '').slice(0, 128),
    count: count,
    need_content: false
  }
  if (opts.oriQuestion) body.ori_question = String(opts.oriQuestion).slice(0, 128)

  let r
  try {
    r = await postJson({
      baseUrl: opts.baseUrl, apiKey: opts.apiKey, path: '/tools/search',
      body: body, timeoutMs: opts.timeoutMs || 15000, shouldCancel: opts.shouldCancel
    })
  } catch (e) {
    // 第三方反代一般没实现这个端点 → 404 说清楚，别让人以为是 Key 到期
    if (e && e.code === 'HTTP_404') {
      throw apiErr('NO_SEARCH', '该服务地址没有搜索接口（/tools/search 仅官方地址可用）')
    }
    throw e
  }

  let obj = null
  try { obj = JSON.parse(r.body) } catch (e) { throw apiErr('PARSE', '搜索结果无法解析') }
  return { results: parseSearchResults(obj), status: r.status }
}

// 非流式（stream=false）：一次拿完整 JSON
export async function sendOnce(opts) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS
  const r = await postJson({
    baseUrl: opts.baseUrl, apiKey: opts.apiKey, path: '/chat/completions',
    body: opts.body, timeoutMs: timeoutMs, shouldCancel: opts.shouldCancel
  })
  let obj = null
  try { obj = JSON.parse(r.body) } catch (e) { throw apiErr('PARSE', '返回内容无法解析') }
  const msg = obj && obj.choices && obj.choices[0] && obj.choices[0].message
  return {
    content: stripInternalTags((msg && msg.content) || ''),
    reasoning: stripInternalTags((msg && msg.reasoning_content) || ''),
    usage: obj.usage || null,
    finishReason: (obj.choices && obj.choices[0] && obj.choices[0].finish_reason) || 'stop',
    status: r.status
  }
}
