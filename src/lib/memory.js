// 上下文压缩与长期记忆（纯函数）
//
// 要解决的问题：`maxHistory` 一到，更早的对话就被整段丢掉 —— 用户会觉得
// "它把前面说过的话忘光了"。这里改成**压缩**而不是丢弃：
//
//   超出窗口的消息 → 每条折成一行摘要（按消息 id 去重）→ 存进 memory 文件
//   下次请求 → 摘要作为一条 system 消息附在系统提示词后面
//
// 为什么不在前端调模型做摘要：本机请求一次要多花一次 token 和时间，
// 而设备是"笔"——用户想要的即时回复，多等两秒比少两行细节更难受。
// 抽取式摘要（保留原句开头）信息损失小且完全可预测，还能单测。

export const MEMORY_DEFAULT = { on: true, lines: 24 }

export const MEMORY_LINES_MIN = 6
export const MEMORY_LINES_MAX = 60

// 单条摘要保留多少字：用户那句短（往往就是问题的关键），回答那句长，
// 留前 110 字足够看出"当时聊到哪儿了"
const KEEP_USER = 60
const KEEP_AI = 110

export function normalizeMemory(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  let lines = parseInt(s.lines, 10)
  if (!isFinite(lines)) lines = MEMORY_DEFAULT.lines
  if (lines < MEMORY_LINES_MIN) lines = MEMORY_LINES_MIN
  if (lines > MEMORY_LINES_MAX) lines = MEMORY_LINES_MAX
  return {
    // 只有显式写 false 才关（老配置没这个字段 → 默认开，符合"默认开启"的要求）
    on: s.on === false ? false : true,
    lines: lines
  }
}

function flatten(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
}

export function clip(s, n) {
  const t = flatten(s)
  return t.length > n ? t.slice(0, n) + '…' : t
}

// 一条消息 → 摘要条目。空消息 / 报错消息不进记忆（记下来只会污染上下文）
export function memoryEntry(msg, now) {
  if (!msg || !msg.id) return null
  if (msg.error) return null
  const body = flatten(msg.content)
  if (!body) return null
  const isUser = msg.role === 'user'
  return {
    id: String(msg.id),
    at: Number(msg.createdAt) || Number(now) || 0,
    role: isUser ? 'user' : 'assistant',
    text: isUser ? clip(body, KEEP_USER) : clip(body, KEEP_AI)
  }
}

export function hasNote(notes, id) {
  const list = notes || []
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return true
  return false
}

// 只保留"水位之后"的消息。清空记忆时把当时的时间记成 floor，
// 比它更早的对话不再折回来 —— 否则用户点完清空、随手再发一句，
// 之前被丢弃的那十几条又会被原样折进记忆，"清空"看起来完全没生效。
export function notesAfter(messages, floor) {
  const f = Number(floor) || 0
  const list = messages || []
  if (!f) return list
  const out = []
  for (let i = 0; i < list.length; i++) {
    if ((list[i] && list[i].createdAt ? list[i].createdAt : 0) > f) out.push(list[i])
  }
  return out
}

// 把一批消息折进记忆。已记过的按 id 跳过 —— 重抽 / 修改内容之后同一条
// 消息可能再次落进折叠范围，靠 id 去重才不会越记越乱。
export function foldMessages(notes, messages, opts) {
  const o = opts || {}
  const max = o.lines || MEMORY_DEFAULT.lines
  const out = (notes || []).slice()
  let added = 0
  const msgs = messages || []
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (!m || hasNote(out, m.id)) continue
    const e = memoryEntry(m, o.now)
    if (!e) continue
    out.push(e)
    added++
  }
  // 只留最近 max 条：老的记忆比没有更糟 —— 它会把上下文挤满而且越来越跑偏
  const kept = out.length > max ? out.slice(out.length - max) : out
  return { notes: kept, added: added, dropped: out.length - kept.length }
}

export function pruneNotes(notes, max) {
  const list = (notes || []).filter((n) => n && n.id && n.text)
  const m = max || MEMORY_DEFAULT.lines
  return list.length > m ? list.slice(list.length - m) : list
}

// 给 API 用的一段正文。没有记忆时返回空串（调用方据此决定加不加这条 system）
export function memoryText(notes) {
  const list = pruneNotes(notes, 999)
  if (!list.length) return ''
  const lines = []
  for (let i = 0; i < list.length; i++) {
    const n = list[i]
    lines.push((n.role === 'user' ? '我：' : 'AI：') + n.text)
  }
  return '【早前对话的压缩记忆】（按时间顺序，供你保持连贯，不用复述）\n' + lines.join('\n')
}

export function memorySummary(notes) {
  const list = pruneNotes(notes, 999)
  let chars = 0
  for (let i = 0; i < list.length; i++) chars += String(list[i].text || '').length
  return { count: list.length, chars: chars, lastAt: list.length ? list[list.length - 1].at : 0 }
}

// 请求前的一步：算清楚这次要"丢掉"哪些消息，把它们折进记忆。
// 返回 { keep, drop, notes }，调用方拿 drop 去 foldMessages。
//   enabled=false → 保持老行为，直接按 maxMessages 截断，不产生记忆
export function planCompression(messages, maxMessages, enabled) {
  const usable = (messages || []).filter((m) => !m.error && !m.pending && (m.content || (m.images && m.images.length)))
  // maxHistory=0 是合法设置（"完全不带历史"），不能当成"没传参数"而回落到 24，
  // 否则计划和实际发给 API 的数量对不上，该折叠的没折
  const max = (typeof maxMessages === 'number' && maxMessages >= 0) ? maxMessages : 24
  if (!enabled) return { keep: usable.slice(Math.max(0, usable.length - max)), drop: [], notes: null }
  if (usable.length <= max) return { keep: usable, drop: [], notes: null }
  const cut = usable.length - max
  return { keep: usable.slice(cut), drop: usable.slice(0, cut), notes: null }
}
