// 人设卡（纯函数）
//
// 兼容三种来源：
//   1. 角色卡 v2：{ spec:'chara_card_v2', spec_version:'2.0', data:{ name, description, ... } }
//      —— 这是社区通用的格式（SillyTavern / 各类扮演应用导出的都是它）
//   2. 扁平角色卡：{ name, description, personality, scenario, ... }（老格式 / 手写）
//   3. 纯提示词文件（.txt / .md）：整段文字当"人设描述"用，文件名当名字
//
// 标准字段之外的**自定义字段也保留**（见 collectCustom）：像 affection_rules（好感度
// 规则）、trait_rules、roleplay_rules、timeout_signal 这类键是角色卡的灵魂，以前被
// 静默丢掉，导入后角色就不会按那些规则说话了。

export const CARD_LIMITS = {
  name: 40,
  description: 4000,
  // 真实卡片的 personality 经常超过 1200 字（蓝鲸损友娘那张 1246 字），
  // 截断会把【语言与格式】这类规则拦腰砍断，所以放宽到 4000
  personality: 4000,
  scenario: 2000,
  firstMessage: 1200,
  exampleDialogue: 2400,
  creatorNotes: 600,
  custom: 6000
}

function str(v, max) {
  const s = String(v == null ? '' : v).replace(/\r\n/g, '\n').trim()
  const m = max || 4000
  return s.length > m ? s.slice(0, m) : s
}

export function normalizeCard(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  // v2 把真正的字段装在 data 里
  const d = (src.spec === 'chara_card_v2' || (src.data && typeof src.data === 'object' && !src.name))
    ? src.data
    : src
  const o = d && typeof d === 'object' ? d : {}
  const custom = collectCustom(o)
  return {
    name: str(o.name, CARD_LIMITS.name),
    description: str(o.description, CARD_LIMITS.description),
    personality: str(o.personality, CARD_LIMITS.personality),
    scenario: str(o.scenario, CARD_LIMITS.scenario),
    firstMessage: str(o.first_mes || o.firstMessage || o.greeting, CARD_LIMITS.firstMessage),
    exampleDialogue: str(o.mes_example || o.exampleDialogue, CARD_LIMITS.exampleDialogue),
    creatorNotes: str(o.creator_notes || o.creatorNotes, CARD_LIMITS.creatorNotes),
    custom: custom.text,
    customKeys: custom.keys
  }
}

// ---- 自定义字段 ----
// 标准字段：已经各自有位置，不再重复进 custom
const KNOWN_KEYS = {
  name: 1, description: 1, personality: 1, scenario: 1,
  first_mes: 1, firstMessage: 1, greeting: 1,
  mes_example: 1, exampleDialogue: 1,
  creator_notes: 1, creatorNotes: 1,
  // 本应用导出的附加规则块：直接当 custom 用，不要再套一层【custom_rules】
  custom_rules: 1, custom: 1, customKeys: 1
}
// 纯元数据：对"怎么扮演这个角色"没有帮助，丢掉不算损失
const META_KEYS = {
  spec: 1, spec_version: 1, app: 1, at: 1,
  tags: 1, creator: 1, character_version: 1, extensions: 1,
  character_book: 1, alternate_greetings: 1,
  // 卡片标识（CETACEA_LOLI / SUCCUBUS_CATGIRL 之类），只是给程序看的 ID
  persona_key: 1
}
// 常见自定义键的中文名：提示词里直接给模型看英文键名，效果差一截
const CUSTOM_LABELS = {
  affection_rules: '好感度规则',
  system_prompt: '系统提示',
  post_history_instructions: '后置指示',
  roleplay_rules: '扮演规则',
  trait_rules: '特征规则',
  timeout_signal: '暂停信号',
  personality_tags: '性格标签',
  language: '语言要求',
  self_claim: '自我身份',
  food_preference: '偏好的食物',
  address_user_as: '对用户的称呼',
  mandatory_suffix: '固定结尾',
  mode: '模式'
}

function boolText(v) {
  return v === true ? '是' : v === false ? '否' : String(v)
}

// 值 → 一行或几行文字。对象拆成「子键：值」，数组用「、」连起来
function flatLines(v, indent) {
  const pad = indent || ''
  if (v == null) return []
  if (typeof v === 'string') return v.trim() ? [pad + v.trim()] : []
  if (typeof v === 'number' || typeof v === 'boolean') return [pad + boolText(v)]
  if (Array.isArray(v)) {
    const prim = v.every((x) => x == null || typeof x !== 'object')
    if (prim) {
      const s = v.map((x) => boolText(x)).join('、')
      return s ? [pad + s] : []
    }
    let out = []
    for (const item of v) out = out.concat(flatLines(item, pad))
    return out
  }
  if (typeof v === 'object') {
    let out = []
    for (const k of Object.keys(v)) {
      const val = v[k]
      if (val && typeof val === 'object') {
        const sub = flatLines(val, pad + '  ')
        if (sub.length) out.push(pad + k + '：')
        out = out.concat(sub)
      } else if (val != null && String(val).trim()) {
        out.push(pad + k + '：' + boolText(val))
      }
    }
    return out
  }
  return []
}

// 把标准字段以外的键收集成一段提示词文本（每个键一节【标题】）
function collectCustom(o) {
  const parts = []
  const keys = []
  const own = str(o.custom_rules || o.custom, CARD_LIMITS.custom)
  if (own) parts.push(own)
  for (const k of Object.keys(o)) {
    if (KNOWN_KEYS[k] || META_KEYS[k]) continue
    const lines = flatLines(o[k], '')
    if (!lines.length) continue
    keys.push(k)
    parts.push('【' + (CUSTOM_LABELS[k] || k) + '】\n' + lines.join('\n'))
  }
  let text = parts.join('\n\n')
  if (text.length > CARD_LIMITS.custom) text = text.slice(0, CARD_LIMITS.custom) + '\n…（内容过长，其余省略）'
  // 已经归一化过的卡再进一次 normalizeCard（设置页保存就是这条路）：
  // 这时自定义字段已经合并成 custom 文本了，别把原来的键名清单弄丢
  const oldKeys = Array.isArray(o.customKeys) ? o.customKeys.slice(0, 20) : []
  return { text: text, keys: keys.length ? keys : oldKeys }
}

export function cardIsEmpty(card) {
  if (!card) return true
  return !(card.name || card.description || card.personality || card.scenario)
}

// 开场白：对话为空时由角色先说的那一句。留空就等对方先开口。
export function greetingOf(card) {
  return normalizeCard(card).firstMessage
}

// 一个人设卡片 → 一段 system 提示词。
// 好感度 / 等级这类规则也照带：它们在卡片的自定义字段里（affection_rules 等），
// 由 normalizeCard 收进 custom，这里原样拼进去，不代模型做任何数值运算。
export function personaSystemPrompt(card, extra) {
  const c = normalizeCard(card)
  const parts = []
  const who = c.name || '这个角色'
  // 定位是「陪伴」而不是「演一场戏」：不写旁白、不描写环境动作，也不替对方说话。
  // 少了这几句，模型很容易把每轮回复写成带舞台提示的小说段落。
  parts.push('你现在扮演「' + who + '」。请始终以该角色的身份、口吻和视角说话，'
    + '像日常闲聊一样自然：不写旁白，不描写环境、动作和神态，不替对方说话或替对方做决定。'
    + '不要跳出角色，不要复述或解释这段设定，也不要提到自己是模型或 AI。')
  if (c.description) parts.push('【角色设定】\n' + c.description)
  if (c.personality) parts.push('【性格与说话方式】\n' + c.personality)
  if (c.scenario) parts.push('【日常背景】\n' + c.scenario
    + '\n（这只是你们相处的背景，不用描写，也不用刻意提起，除非对方问起。）')
  if (c.exampleDialogue) parts.push('【对话示例（模仿这个语气，不要照抄内容）】\n' + c.exampleDialogue)
  // 自定义字段：好感度规则、扮演规则、暂停信号等，原样作为规则交给模型
  if (c.custom) parts.push(c.custom)
  const ex = str(extra, 2000)
  if (ex) parts.push('【补充要求】\n' + ex)
  return parts.join('\n\n')
}

// 文件名 → 干净的显示名（去掉扩展名和后缀括号）
export function nameFromFile(filename) {
  let s = String(filename || '').replace(/^.*[\\/]/, '')
  s = s.replace(/\.(json|txt|md|markdown|yaml|yml)$/i, '')
  s = s.replace(/[_-]+/g, ' ').trim()
  return s.slice(0, 24) || '导入的人设'
}

// 文件类型：card=角色卡(json) / prompt=纯文本提示词 / data=本应用导出的存档
export function fileKind(filename) {
  const s = String(filename || '').toLowerCase()
  if (/\.(txt|md|markdown)$/.test(s)) return 'prompt'
  if (/\.json$/.test(s)) return 'card'
  return ''
}

// 解析导入文件。返回 { ok, kind, name, card, prompt, error }
//   card  → 角色卡字段（可能只填了一部分）
//   prompt→ 纯文本当作"补充要求"塞进人设
export function parsePersonaFile(text, filename) {
  const kind = fileKind(filename)
  const fallbackName = nameFromFile(filename)
  if (kind === 'prompt') {
    const body = String(text == null ? '' : text).trim()
    if (!body) return { ok: false, kind: kind, error: '文件是空的' }
    return {
      ok: true,
      kind: kind,
      name: fallbackName,
      card: { name: fallbackName, description: body.slice(0, CARD_LIMITS.description) },
      prompt: body
    }
  }
  if (kind !== 'card') return { ok: false, kind: kind, error: '只支持 .json / .txt / .md' }

  let raw = null
  try { raw = JSON.parse(String(text)) } catch (e) { return { ok: false, kind: kind, error: '不是合法的 JSON' } }
  if (!raw || typeof raw !== 'object') return { ok: false, kind: kind, error: 'JSON 里没有对象' }

  // 本应用自己导出的存档：{ data: { profile, ... } } → 直接取 profile
  if (raw.data && typeof raw.data === 'object' && raw.data.profile) {
    const p = raw.data.profile
    const card = normalizeCard(p.card || p)
    return { ok: true, kind: 'archive', name: (p.name || card.name || fallbackName).slice(0, 24), card: card, prompt: '' }
  }

  const card = normalizeCard(raw)
  if (cardIsEmpty(card)) return { ok: false, kind: kind, error: '没读到角色名或设定字段' }
  return { ok: true, kind: kind, name: (card.name || fallbackName).slice(0, 24), card: card, prompt: '' }
}

// 环境里能改的字段清单：设置页据此逐项渲染（避免把七歪八扭的卡塞进一个输入框）
export const CARD_ROWS = [
  { key: 'name', label: '名字' },
  { key: 'description', label: '设定' },
  { key: 'personality', label: '性格' },
  { key: 'scenario', label: '日常背景' },
  { key: 'firstMessage', label: '开场白' }
]
