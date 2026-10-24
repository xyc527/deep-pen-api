// SSE 解析（纯函数）。DeepSeek 每个事件基本是一行 data:，但按标准支持多行 data。
//
// 约定：调用方每次把"缓冲 + 新到文本"丢进来，拿回完整事件列表与残留尾巴。
// 残留尾巴必须留着，否则跨轮询被截断的事件会丢。

export function parseSse(buffer) {
  const events = []
  let rest = String(buffer == null ? '' : buffer)
  let dataLines = []

  for (;;) {
    const nl = rest.indexOf('\n')
    if (nl < 0) break
    let line = rest.slice(0, nl)
    rest = rest.slice(nl + 1)
    if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1)

    if (line === '') {
      if (dataLines.length) {
        events.push(dataLines.join('\n'))
        dataLines = []
      }
      continue
    }
    if (line.charAt(0) === ':') continue // 注释行
    if (line.indexOf('data:') === 0) {
      let v = line.slice(5)
      if (v.charAt(0) === ' ') v = v.slice(1)
      dataLines.push(v)
      continue
    }
    // event:/id:/retry: 等字段对本场景无意义，忽略
  }

  // 末尾残留：可能是半个事件。若最后一行是完整的 data: 但也可能是下一块的开始，
  // 统一留到下次处理（多等一个轮询周期的代价远小于丢一段内容）。
  if (dataLines.length) {
    // 把这些行留在 rest 里重新交给下次
    rest = 'data: ' + dataLines.join('\n') + '\n' + rest
  }
  return { events: events, rest: rest }
}

// 从单条事件里取正文增量。返回 { kind, text, obj }
//   kind: 'content' | 'reasoning' | 'done' | 'meta' | 'error' | 'ignore'
export function readChunk(data) {
  if (data === '[DONE]') return { kind: 'done' }
  let obj = null
  try {
    obj = JSON.parse(data)
  } catch (e) {
    return { kind: 'ignore' }
  }
  if (!obj) return { kind: 'ignore' }
  if (obj.error) return { kind: 'error', obj: obj, text: String(obj.error.message || obj.error.code || 'API 错误') }
  if (obj.usage && (!obj.choices || !obj.choices.length)) return { kind: 'meta', obj: obj }

  const choice = obj.choices && obj.choices[0]
  if (!choice) return { kind: 'ignore', obj: obj }
  const delta = choice.delta || {}
  if (delta.reasoning_content) return { kind: 'reasoning', text: delta.reasoning_content, obj: obj }
  if (delta.content) return { kind: 'content', text: delta.content, obj: obj }
  if (choice.finish_reason) return { kind: 'meta', obj: obj, finishReason: choice.finish_reason }
  return { kind: 'ignore', obj: obj }
}
