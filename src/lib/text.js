// 文本清洗与小工具（纯函数）

// 移除模型偶发泄露的内部协议标签。
// 两族都要清：
//   1) <|tool_calls_begin|> 这类尖括号竖线标签（历史版本工具协议）
//   2) <ds_safety>...</ds_safety> 这类安全判定注解（实测会漏进正文，整段是内部提示词）
const RE_DS_TAG = /<ds_[a-z_]+>[\s\S]*?<\/ds_[a-z_]+>/gi
const RE_PIPE_TAG = /<\|[^|]{1,40}\|>/g
const RE_MISC = /<\/?(invoke|parameter|tool_call|tool_calls)>/gi

export function stripInternalTags(text) {
  if (!text) return text
  return String(text).replace(RE_DS_TAG, '').replace(RE_PIPE_TAG, '').replace(RE_MISC, '')
}

// 流式读取时，文件末尾可能停在半个多字节字符上：解码后通常是 U+FFFD。
// 这个字符不能算"已收到"，也不能推进已消费长度，否则下一轮会错位。
// 返回 { complete, tail }：complete 是可直接展示的部分，tail 留到下一轮拼接。
export function holdIncompleteTail(text) {
  const s = String(text == null ? '' : text)
  let end = s.length
  while (end > 0 && s.charCodeAt(end - 1) === 0xfffd) end--
  return { complete: s.slice(0, end), tail: s.slice(end) }
}

// 中文按 1、ASCII 按 0.55 估宽，用于在 936 宽的屏上做粗略的行数估计
export function estimateWidth(text, fontPx) {
  const s = String(text || '')
  let w = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    w += c > 0x2e80 ? 1 : 0.55
  }
  return w * (fontPx || 16)
}

export function clip(text, maxLen) {
  const s = String(text || '')
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1) + '…'
}

export function formatTokens(n) {
  const v = Number(n) || 0
  if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k'
  return String(v)
}
