// 会话 / 消息模型（纯函数）

let seq = 0
export function uid(prefix) {
  seq = (seq + 1) % 1e6
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + seq.toString(36)
}

export function newConversation() {
  return {
    id: uid('c'),
    title: '新对话',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  }
}

export function newMessage(role, text) {
  return {
    id: uid('m'),
    role: role,
    content: text || '',
    reasoning: '',
    images: [],
    error: '',
    pending: false,
    createdAt: Date.now()
  }
}

// 标题取首条用户消息，去掉换行并截断
export function titleFrom(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (!s) return '新对话'
  return s.length > 14 ? s.slice(0, 14) + '…' : s
}

export function ensureTitle(conv) {
  if (!conv) return conv
  if (conv.title && conv.title !== '新对话') return conv
  for (let i = 0; i < conv.messages.length; i++) {
    const m = conv.messages[i]
    if (m.role === 'user' && m.content) { conv.title = titleFrom(m.content); break }
  }
  return conv
}

// 裁剪历史：保留最近 maxTurns 条"完整"消息（跳过错误/空的）
export function trimMessages(messages, maxMessages) {
  const usable = (messages || []).filter((m) => !m.error && !m.pending && (m.content || (m.images && m.images.length)))
  if (usable.length <= maxMessages) return usable
  return usable.slice(usable.length - maxMessages)
}

// 组装发给 API 的 messages。
// imageUrlOf(path) 由调用方提供（同步返回 data URL 或 null），保持本函数可测。
export function buildApiMessages(messages, opts) {
  const o = opts || {}
  const max = typeof o.maxMessages === 'number' ? o.maxMessages : 24
  const list = trimMessages(messages, max)
  const out = []

  if (o.systemPrompt) out.push({ role: 'system', content: String(o.systemPrompt) })

  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    const imgs = (m.images || []).slice()
    if (m.role === 'user' && imgs.length) {
      const parts = []
      const text = String(m.content || '').trim()
      if (text) parts.push({ type: 'text', text: text })
      let resolved = 0
      for (let k = 0; k < imgs.length; k++) {
        const url = o.imageUrlOf ? o.imageUrlOf(imgs[k].path) : null
        if (url) { parts.push({ type: 'image_url', image_url: { url: url } }); resolved++ }
      }
      // 一张图都没能解析时退回纯文本，避免空 content 报错；
      // 连文本都没有就补一句占位：绝不能把整条消息丢掉，
      // 否则模型会完全无视这次输入（历史里凭空少一轮，回复驴唇不对马嘴）。
      if (parts.length === 1 && parts[0].type === 'text') out.push({ role: 'user', content: parts[0].text })
      else if (parts.length) out.push({ role: 'user', content: parts })
      else out.push({ role: 'user', content: '（' + imgs.length + ' 张图片读取失败，无法显示）' })
      continue
    }
    out.push({ role: m.role, content: String(m.content || '') })
  }
  return out
}

export function lastAssistant(conv) {
  const msgs = (conv && conv.messages) || []
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return msgs[i]
  return null
}

export function summarizeUsage(usage) {
  if (!usage) return ''
  const parts = []
  if (usage.prompt_tokens != null) parts.push('入 ' + usage.prompt_tokens)
  if (usage.completion_tokens != null) parts.push('出 ' + usage.completion_tokens)
  const d = usage.completion_tokens_details
  if (d && d.reasoning_tokens) parts.push('思考 ' + d.reasoning_tokens)
  if (usage.prompt_cache_hit_tokens) parts.push('缓存命中 ' + usage.prompt_cache_hit_tokens)
  return parts.join('  ·  ')
}
