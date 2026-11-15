// 设置文档 v2：一份 settings.json 里装两套设置 —— 聊天模式一套、扮演模式下
// **每个人设各一套**（用户要求"完全隔离"，连 Key / 模型 / 参数都各存一份）。
//
// 关键设计：对外仍然只暴露"扁平一份设置"。
//   loadSettings()  → 取当前模式/当前人设的那一套，铺平返回（带 mode/personaId 等标记）
//   saveSettings(s) → 按当前模式写回对应槽位
// 这样 index.vue / setup.vue / 各个 api 调用完全不用知道分层的存在，
// 只有设置页需要关心"切模式 / 切人设"。
//
// 为什么不给每个模式各开一个文件：切模式要保证"两边都读得到、写不丢"，
// 单文件里换槽位只需要一次写；多文件在"写一半断电"时会留下半套配置。

import { normalizeSettings } from './settings.js'
import { normalizeCard } from './persona.js'

export const DOC_VERSION = 2
export const MODE_CHAT = 'chat'
export const MODE_ROLE = 'role'

// 人设数量上限：设备只有 1GB 内存，整份文档每次保存都要序列化一遍，
// 每人设又带一套完整设置 + 角色卡，8 个已经很够用
export const MAX_PERSONAS = 8

export function modeLabel(mode) {
  return mode === MODE_ROLE ? '扮演' : '聊天'
}

function safeId(s) {
  return String(s || '').replace(/[^A-Za-z0-9_-]/g, '')
}

export function newPersonaId(seed) {
  const t = (Number(seed) || Date.now()).toString(36)
  return 'p_' + t
}

// 一个人设 = 名字 + 角色卡 + 一整套独立设置
export function normalizePersona(raw, idx) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const i = Number(idx) || 0
  let id = safeId(p.id)
  if (!id) id = newPersonaId(Date.now() + i)
  const card = normalizeCard(p.card)
  const name = String(p.name || '').trim() || card.name || ('人设 ' + (i + 1))
  return {
    id: id,
    name: name.slice(0, 24),
    card: card,
    settings: normalizeSettings(p.settings && typeof p.settings === 'object' ? p.settings : {}),
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Number(p.updatedAt) || 0
  }
}

export function normalizeDoc(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  // v1（老版本文件）：整份就是聊天模式的设置，没有 chat / role 这两个槽
  const nested = src.chat && typeof src.chat === 'object'
  if (!nested) {
    return {
      version: DOC_VERSION,
      updatedAt: Number(src.updatedAt) || 0,
      mode: MODE_CHAT,
      chat: normalizeSettings(src),
      role: { activeId: '', personas: [] }
    }
  }

  const roleSrc = src.role && typeof src.role === 'object' ? src.role : {}
  const rawList = Array.isArray(roleSrc.personas) ? roleSrc.personas : []
  const personas = []
  const seen = {}
  for (let i = 0; i < rawList.length && personas.length < MAX_PERSONAS; i++) {
    const p = normalizePersona(rawList[i], i)
    if (seen[p.id]) continue
    seen[p.id] = 1
    personas.push(p)
  }
  let activeId = safeId(roleSrc.activeId)
  let hit = false
  for (let i = 0; i < personas.length; i++) if (personas[i].id === activeId) hit = true
  // 指向已删除的人设时自动落到第一个：否则"扮演模式"会拿着空设置打请求
  if (!hit) activeId = personas.length ? personas[0].id : ''

  return {
    version: DOC_VERSION,
    updatedAt: Number(src.updatedAt) || 0,
    mode: src.mode === MODE_ROLE ? MODE_ROLE : MODE_CHAT,
    chat: normalizeSettings(src.chat),
    role: { activeId: activeId, personas: personas }
  }
}

export function emptyDoc() {
  return normalizeDoc(null)
}

export function activePersona(doc) {
  if (!doc || !doc.role || !doc.role.personas) return null
  const list = doc.role.personas
  for (let i = 0; i < list.length; i++) if (list[i].id === doc.role.activeId) return list[i]
  return list.length ? list[0] : null
}

export function findPersona(doc, id) {
  if (!doc || !doc.role || !doc.role.personas) return null
  const list = doc.role.personas
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
  return null
}

export function personasBrief(doc) {
  const out = []
  const list = (doc && doc.role && doc.role.personas) || []
  for (let i = 0; i < list.length; i++) out.push({ id: list[i].id, name: list[i].name })
  return out
}

// 当前是哪一份设置：'chat' 或 'role_<id>'。会话 / 余额 / 记忆的文件名都按它分。
export function profileKey(doc) {
  if (doc && doc.mode === MODE_ROLE) {
    const p = activePersona(doc)
    if (p) return 'role_' + p.id
  }
  return 'chat'
}

// 取当前这份设置（铺平，带标记字段）。
// 标记字段（mode / personaId / personaCard / personas）不是设置本身，
// settingsSignature 用 normalizeSettings 归一化时会自动丢掉它们，
// 所以"切人设"不会被误判成"有未保存改动"。
// 铺平成一份"页面能直接用"的设置对象。
// 深拷贝一层是必须的：页面改设置时习惯写 Object.assign({}, settings.params)，
// 但只要有谁忘了套这层、直接改 params.x，就会顺手把文档缓存里的那份也改了
// （下一个人设读到的就是被污染的设置）。
function cloneFlat(src) {
  const s = src || {}
  const out = Object.assign({}, s)
  out.params = Object.assign({}, s.params)
  out.memory = Object.assign({}, s.memory)
  out.models = Array.isArray(s.models) ? s.models.slice() : []
  return out
}

export function pickProfile(doc) {
  const d = doc || emptyDoc()
  const brief = personasBrief(d)
  const p = activePersona(d)
  if (d.mode === MODE_ROLE && p) {
    return Object.assign(cloneFlat(p.settings), {
      mode: MODE_ROLE,
      personaId: p.id,
      personaName: p.name,
      // 角色卡的名字为空时用显示名兜底：不然拼出来的 system 提示词是
      // 「你现在扮演「这个角色」」，看着像没配置成功
      personaCard: Object.assign({}, p.card, { name: p.card.name || p.name }),
      personas: brief
    })
  }
  // 扮演模式但一个人设都没有：退回聊天模式那份，界面不该拿到空 Key
  return Object.assign(cloneFlat(d.chat), {
    mode: MODE_CHAT,
    personaId: '',
    personaName: '',
    personaCard: null,
    personas: brief
  })
}

export function writeProfile(doc, flat) {
  const d = doc || emptyDoc()
  const s = normalizeSettings(flat)
  if (d.mode === MODE_ROLE) {
    const p = activePersona(d)
    if (p) {
      p.settings = s
      p.updatedAt = Date.now()
      return d
    }
  }
  d.chat = s
  return d
}

// 新建 / 导入人设时，只沿用"连接"这一段（Key / 地址 / 模型清单）。
// 为什么：新档案如果 Key 是空的，用户刚导入一张角色卡、回到首页说句话，
// 得到的是"还没填有效的 API Key" —— 看起来像导入失败。参数 / 提示词 / 记忆
// 仍然全是各自独立的默认值，"完全隔离"没有被打破（各存各的一份）。
export function connectionOnly(s) {
  const src = s || {}
  return {
    apiKey: String(src.apiKey || ''),
    baseUrl: src.baseUrl || '',
    models: Array.isArray(src.models) ? src.models.slice() : []
  }
}

export function setMode(doc, mode) {
  const d = doc
  if (mode === MODE_ROLE) {
    d.mode = MODE_ROLE
    // 第一次进扮演模式：没有可用人设就建一个，否则设置页会显示"没有 Key"
    // 而用户其实什么都没动过 —— 那种体验等同于"一进去就坏了"
    if (!activePersona(d)) addPersona(d, { name: '默认人设', settings: connectionOnly(d.chat) })
  } else {
    d.mode = MODE_CHAT
  }
  return d
}

export function setActivePersona(doc, id) {
  if (!findPersona(doc, id)) return false
  doc.role.activeId = id
  return true
}

export function addPersona(doc, opts) {
  const o = opts || {}
  const role = doc.role
  if (role.personas.length >= MAX_PERSONAS) return ''
  let id = safeId(o.id)
  if (!id || findPersona(doc, id)) id = newPersonaId(Date.now() + role.personas.length)
  const p = normalizePersona({
    id: id,
    name: o.name,
    card: o.card,
    settings: o.settings || {}
  }, role.personas.length)
  role.personas.push(p)
  if (!role.activeId) role.activeId = p.id
  return p.id
}

export function removePersona(doc, id) {
  const role = doc.role
  const out = []
  let removed = false
  for (let i = 0; i < role.personas.length; i++) {
    if (role.personas[i].id === id) { removed = true; continue }
    out.push(role.personas[i])
  }
  // 至少留一个：扮演模式没有"零人设"这个状态（切回去会立刻自动建一个）
  if (!removed || !out.length) return false
  role.personas = out
  if (role.activeId === id) role.activeId = out[0].id
  return true
}

export function renamePersona(doc, id, name) {
  const p = findPersona(doc, id)
  if (!p) return false
  const s = String(name || '').trim()
  if (!s) return false
  p.name = s.slice(0, 24)
  // 角色卡里的名字一起改：界面上只有一处"名字"，两处不同步就会
  // 出现"改名了但提示词里还是旧名字"这种对不上的情况
  if (!p.card.name || p.card.name !== p.name) p.card.name = p.name
  p.updatedAt = Date.now()
  return true
}

export function setPersonaCard(doc, id, card) {
  const p = findPersona(doc, id)
  if (!p) return false
  p.card = normalizeCard(card)
  if (p.card.name && p.name === '默认人设') p.name = p.card.name.slice(0, 24)
  p.updatedAt = Date.now()
  return true
}

// 「与 XX 一致」：把另一份设置整包复制过来（是复制，不是实时联动 ——
// 实时联动会让"完全隔离"名存实亡，改一处两边一起变，用户没法只调一边）
export function cloneProfile(source, targetMode, doc) {
  const src = normalizeSettings(source || {})
  if (targetMode === MODE_ROLE && activePersona(doc)) {
    const p = activePersona(doc)
    p.settings = src
    p.updatedAt = Date.now()
    return true
  }
  doc.chat = src
  return true
}
