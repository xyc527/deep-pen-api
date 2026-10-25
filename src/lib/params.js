// DeepSeek API 参数模型（严格对齐官方文档 api-docs.deepseek.com/api/create-chat-completion）
//
// 这一层是纯函数：不碰平台 API、不读全局，可在 Node 里跑断言。
// 设置页的控件全部由 PARAMS 驱动生成，请求体由 buildBody 组装，
// 这样"界面能调什么"和"实际发什么"永远来自同一份定义，不会漂。

export const ENDPOINTS = {
  chat: '/chat/completions',
  models: '/models'
}

// 模型清单：官方只有两个；deepseek-v4-flash 是已退役名的兼容别名（实测可用，
// 由 V4.1-Flash 承接），这里不列出来避免误导，但请求时仍会透传用户手填值。
export const MODELS = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek V4.1 Flash',
    short: 'V4.1 Flash',
    contextWindow: 1048576,
    maxOutput: 393216,
    vision: true,
    efforts: ['none', 'low', 'high', 'max']
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    short: 'V4 Pro',
    contextWindow: 1048576,
    maxOutput: 393216,
    vision: true,
    efforts: ['none', 'low', 'high', 'max']
  }
]

export const MODEL_IDS = MODELS.map((m) => m.id)

export function findModel(id) {
  for (let i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i]
  return null
}

// 模型短名：首页顶栏芯片只放得下几个字。
// models 是 /models 扫出来的 [{id,label}]，没扫过就退回内置清单。
export function shortModelLabel(id, models) {
  const known = findModel(id)
  if (known) return known.short || known.label
  const list = models || []
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === id) return list[i].label || String(id)
  }
  return String(id || '').replace(/^deepseek-/, '') || '模型'
}

// 设置页「模型」那一项的可选值。
//
// 没扫描过 → 用内置清单的友好长名（DeepSeek V4.1 Flash）。
// 扫描过   → **显示接口返回的 id 本身**（deepseek-flash）。
//
// 为什么不用友好名覆盖：内置清单恰好就有 deepseek-flash / deepseek-v4-pro 两个，
// 扫描结果按 id 命中后又被换回一模一样的中文长名，界面上一个字都没变 ——
// 用户点完「扫描模型」，看到的还是原来那些选项，自然会认为"没刷新、
// 没显示扫描结果"。显示真实 id 既能证明刷新了，也确实是服务端给的名字。
export function modelOptions(models) {
  const scanned = models && models.length ? models : null
  const list = scanned || MODELS.map((m) => ({ id: m.id, label: m.label }))
  const out = []
  for (let i = 0; i < list.length; i++) {
    const id = String(list[i] && list[i].id || '')
    if (!id) continue
    if (scanned) {
      out.push({ value: id, label: id })
      continue
    }
    const known = findModel(id)
    out.push({ value: id, label: known ? known.label : (list[i].label || id) })
  }
  return out.length ? out : MODELS.map((m) => ({ value: m.id, label: m.label }))
}

export function isVisionModel(id) {
  const m = findModel(id)
  return m ? !!m.vision : true
}

// 参数定义。kind 决定设置页用哪种控件：
//   enum   → 分段选择（options）
//   number → 步进器（min/max/step）
//   bool   → 开关
//   text   → 文本输入（ime）
//   int    → 数字输入
// scope 决定该项在什么条件下才有意义（thinking / noThinking / stream），
// 界面据此置灰并给出原因，避免"调了不生效"的困惑。
export const PARAMS = [
  {
    key: 'model', group: 'core', label: '模型', kind: 'enum',
    options: MODELS.map((m) => ({ value: m.id, label: m.label })),
    default: 'deepseek-flash',
    doc: 'model 仅接受 deepseek-flash / deepseek-v4-pro'
  },
  {
    key: 'thinking', group: 'core', label: '深度思考', kind: 'bool', default: true,
    doc: 'thinking.type = enabled/disabled；关闭后不返回 reasoning_content'
  },
  {
    key: 'reasoningEffort', group: 'core', label: '思考强度', kind: 'enum',
    scope: 'thinking',
    options: [
      { value: 'none', label: '关闭' },
      { value: 'low', label: '低' },
      { value: 'high', label: '高' },
      { value: 'max', label: '极高' }
    ],
    default: 'high',
    doc: 'reasoning_effort：none/low/high/max，默认 high；max 时 max_tokens 上限 128K'
  },
  {
    key: 'temperature', group: 'sampling', label: '温度', kind: 'number',
    scope: 'noThinking', min: 0, max: 2, step: 0.1, default: 1,
    doc: 'temperature 0–2，默认 1；仅非思考模式生效'
  },
  {
    key: 'topP', group: 'sampling', label: 'Top P', kind: 'number',
    scope: 'thinking', min: 0.95, max: 1, step: 0.01, default: 1,
    doc: 'top_p 仅在思考模式生效，有效范围 0.95–1.0（低于 0.95 按 0.95 处理）'
  },
  {
    key: 'maxTokens', group: 'sampling', label: '最大输出', kind: 'number',
    min: 0, max: 393216, step: 1024, default: 0,
    doc: 'max_tokens 1–393216；0 = 不传，由服务端决定（非思考 8K / 思考 64K / max 128K）'
  },
  {
    key: 'stopText', group: 'sampling', label: '停止词', kind: 'text', default: '',
    doc: 'stop：留空不传；多个用英文逗号分隔，最多 16 个'
  },
  {
    key: 'jsonMode', group: 'output', label: 'JSON 输出', kind: 'bool', default: false,
    doc: 'response_format = json_object；需自行在提示词里要求输出 JSON，否则可能生成空白流'
  },
  {
    key: 'logprobs', group: 'output', label: '返回对数概率', kind: 'bool', default: false,
    doc: 'logprobs=true 时返回每个输出 token 的对数概率'
  },
  {
    key: 'topLogprobs', group: 'output', label: 'Top logprobs', kind: 'number',
    scope: 'logprobs', min: 0, max: 20, step: 1, default: 0,
    doc: 'top_logprobs 0–20，须同时开启 logprobs'
  },
  {
    key: 'toolChoice', group: 'output', label: '工具选择', kind: 'enum',
    options: [
      { value: 'none', label: '不调用' },
      { value: 'auto', label: '自动' }
    ],
    default: 'none',
    doc: 'tool_choice：none/auto；required 与指定工具在思考模式下会 400，故不提供'
  },
  {
    key: 'stream', group: 'output', label: '流式输出', kind: 'bool', default: true,
    doc: 'stream=true 走 SSE 逐字返回'
  },
  {
    key: 'includeUsage', group: 'output', label: '返回用量', kind: 'bool',
    scope: 'stream', default: true,
    doc: 'stream_options.include_usage；必须与 stream=true 同时出现，否则 400'
  },
  {
    // 以前这里是 webSearch(bool)，发的是官方未公开的 web_search_options ——
    // 端点收下但不检索，模型照样答“无法获取实时数据”，等于安慰剂。现在删掉那个假字段，
    // 换成真的：提问前先调 POST /v1/tools/search 拿资料，再把资料注入上下文。
    key: 'searchMode', group: 'web', label: '联网搜索', kind: 'enum',
    options: [
      { value: 'off', label: '关' },
      { value: 'auto', label: '自动' },
      { value: 'always', label: '常开' }
    ],
    default: 'off',
    doc: '关=不搜；自动=仅在问题明显有时效/外部信息需求时搜（本地规则判断，零额外延迟）；常开=每问必搜。搜索按次计费 5 元/1000 次'
  },
  {
    key: 'searchCount', group: 'web', label: '搜索结果数', kind: 'number',
    scope: 'search', min: 1, max: 10, step: 1, default: 6,
    doc: '每次搜索取回并注入上下文的网页条数（1–10）。条数不影响计费，只影响注入的上下文长度'
  },
  {
    key: 'userId', group: 'experimental', label: '用户标识', kind: 'text', default: '',
    doc: 'user_id：仅允许 [a-zA-Z0-9-_]，最长 512；用于 KVCache 与安全审核隔离，留空不传'
  }
]

export const PARAM_MAP = (() => {
  const m = {}
  for (let i = 0; i < PARAMS.length; i++) m[PARAMS[i].key] = PARAMS[i]
  return m
})()

export function defaultParams() {
  const out = {}
  for (let i = 0; i < PARAMS.length; i++) out[PARAMS[i].key] = PARAMS[i].default
  return out
}

// 某个参数当前是否生效；返回 { active, reason }
export function scopeOf(key, params) {
  const p = PARAM_MAP[key]
  if (!p) return { active: false, reason: '未知参数' }
  const thinkingOn = params.thinking !== false
  if (p.scope === 'thinking' && !thinkingOn) {
    return { active: false, reason: '仅思考模式生效（已关闭深度思考）' }
  }
  if (p.scope === 'noThinking' && thinkingOn) {
    return { active: false, reason: '仅非思考模式生效（当前开启了深度思考）' }
  }
  if (p.scope === 'stream' && !params.stream) {
    return { active: false, reason: '仅流式输出时可用' }
  }
  if (p.scope === 'logprobs' && !params.logprobs) {
    return { active: false, reason: '需先开启"返回对数概率"' }
  }
  // 搜索结果数只在联网搜索开着时才有意义
  if (p.scope === 'search' && String(params.searchMode || 'off') === 'off') {
    return { active: false, reason: '需先在「联网搜索」里选择 自动 或 常开' }
  }
  return { active: true, reason: '' }
}

export function clampNumber(p, value) {
  let v = Number(value)
  if (!isFinite(v)) v = p.default
  if (typeof p.min === 'number' && v < p.min) v = p.min
  if (typeof p.max === 'number' && v > p.max) v = p.max
  if (typeof p.step === 'number' && p.step > 0) {
    const base = p.min || 0
    v = base + Math.round((v - base) / p.step) * p.step
    // 浮点步进会累积误差（0.1 的倍数出现 0.30000000000000004）
    v = Math.round(v * 1e6) / 1e6
  }
  return v
}

export function parseStop(text) {
  return String(text || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 16)
}

function validUserId(id) {
  if (!id) return true
  return /^[a-zA-Z0-9\-_]{1,512}$/.test(id)
}

// 组装请求体。
// 返回 { ok, body, warnings, errors }：
//   errors   非空 = 不能发（配置自相矛盾）
//   warnings 非空 = 可发但要注意（例如被服务端忽略的项）
export function buildBody(params, messages, opts) {
  const options = opts || {}
  const errors = []
  const warnings = []
  const p = Object.assign(defaultParams(), params || {})

  if (!p.model) errors.push('未选择模型')
  if (!Array.isArray(messages) || messages.length === 0) errors.push('没有可发送的消息')

  const thinkingOn = p.thinking !== false
  if (!thinkingOn && p.reasoningEffort && p.reasoningEffort !== 'none') {
    // 文档：reasoning_effort=none 即关闭思考；开启思考时才有 low/high/max
  }
  if (p.toolChoice === 'required' && thinkingOn) {
    errors.push('思考模式下不支持 tool_choice=required')
  }
  if (!validUserId(p.userId)) {
    errors.push('用户标识只允许字母、数字、- 和 _，最长 512')
  }

  const body = {
    model: p.model,
    messages: messages,
    stream: !!p.stream
  }

  // thinking：官方用 thinking.type 表达开关
  body.thinking = { type: thinkingOn ? 'enabled' : 'disabled' }

  if (thinkingOn) {
    const effort = p.reasoningEffort || 'high'
    body.reasoning_effort = effort
    // 思考模式下 temperature 无效，不发送以免用户误以为调了有用
    if (p.topP !== undefined && Number(p.topP) < 1) {
      if (Number(p.topP) < 0.95) warnings.push('top_p 低于 0.95，服务端按 0.95 处理')
      body.top_p = clampNumber(PARAM_MAP.topP, p.topP)
    }
  } else {
    body.reasoning_effort = 'none'
    if (p.temperature !== undefined) {
      body.temperature = clampNumber(PARAM_MAP.temperature, p.temperature)
    }
  }

  if (Number(p.maxTokens) > 0) {
    body.max_tokens = Math.round(clampNumber(PARAM_MAP.maxTokens, p.maxTokens))
  }

  const stop = parseStop(p.stopText)
  if (stop.length) body.stop = stop.length === 1 ? stop[0] : stop

  if (p.jsonMode) body.response_format = { type: 'json_object' }

  if (p.logprobs) {
    body.logprobs = true
    if (Number(p.topLogprobs) > 0) body.top_logprobs = Math.round(clampNumber(PARAM_MAP.topLogprobs, p.topLogprobs))
  }

  if (options.tools && options.tools.length) {
    body.tools = options.tools
    body.tool_choice = p.toolChoice === 'required' ? 'required' : (p.toolChoice || 'auto')
  }

  if (p.stream && p.includeUsage !== false) {
    body.stream_options = { include_usage: true }
  }

  if (p.userId) body.user_id = p.userId

  return { ok: errors.length === 0, body: body, warnings: warnings, errors: errors }
}

// 请求体的可读摘要（用于"请求预览"面板，方便排查"为什么没生效"）
export function describeBody(body) {
  const out = []
  const keys = ['model', 'stream', 'max_tokens', 'temperature', 'top_p', 'reasoning_effort', 'stop', 'logprobs', 'top_logprobs', 'user_id']
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (body[k] !== undefined && body[k] !== null) out.push(k + '=' + JSON.stringify(body[k]))
  }
  if (body.thinking) out.push('thinking=' + body.thinking.type)
  if (body.response_format) out.push('response_format=' + body.response_format.type)
  if (body.stream_options) out.push('stream_options=include_usage')
  if (body.messages && body.messages.some && body.messages.some((m) => m && m.role === 'system' && /【联网搜索结果】/.test(String(m.content || '')))) {
    out.push('联网搜索结果=已注入')
  }
  out.push('messages=' + (body.messages ? body.messages.length : 0) + '条')
  return out.join('  ')
}
