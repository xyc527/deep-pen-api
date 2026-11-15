// 存档文件（纯函数）
//
// 结构照《妹居物语》的存档来：顶层 version / timestamp / exportDate / data，
// data 下面分 profile / gameData / sessions / memory。
// 但**不带任何人物数值字段**（好感度 / 信任度 / 金币 / 等级 / 背包 / 商店都没有）——
// 需求里明确说了不要，本应用也确实没有这套玩法。
//
// 每个模式（角色）导出两个文件：
//   settings.json  —— 设置（含 Key / 服务地址 / 参数 / 记忆开关）
//   records.json   —— 对话记录 + 压缩记忆 + 人设卡
// 反向导入时按文件内容自动判断是哪一种。

import { normalizeSettings } from './settings.js'
import { normalizeCard } from './persona.js'
import { normalizeMemory, pruneNotes } from './memory.js'

export const ARCHIVE_VERSION = 1
export const ARCHIVE_APP = 'deepseek-pen'

// 导出根目录：/userdisk/Favorite/deepseek-pen/
//   export/<档案>/settings.json、records.json
//   import/          —— 用户丢人设文件的入口
//   persona/         —— 导出的人设卡与示例
// 放在 Favorite 下（注意大写 F）：这里是连电脑后最好找的目录，用户不用记应用名。
// 但三个子目录不能直接铺在 Favorite 根上（那里已经有系统的收藏 / 装机包），
// 所以外面再套一层应用名 —— 用户打开 Favorite 看到 deepseek-pen 一个文件夹，进去才是这三样。
export const ROOT_DIR = '/userdisk/Favorite/deepseek-pen'
export const EXPORT_DIR = ROOT_DIR + '/export'
export const IMPORT_DIR = ROOT_DIR + '/import'
// 人设文件（角色卡）单独一个目录：放进 import/ 会被列成"待导入文件"，
// 自己导出的东西又出现在导入列表里，看着像没导对地方
export const PERSONA_DIR = ROOT_DIR + '/persona'

export function safeName(s) {
  const t = String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '')
  return t.slice(0, 32) || 'unnamed'
}

// 一个档案（聊天模式 / 某个人设）对应的导出子目录名
export function profileFolder(profileKey, name) {
  const key = String(profileKey || 'chat')
  if (key === 'chat') return 'chat'
  return safeName(name || key) + '_' + key.replace(/[^A-Za-z0-9_-]/g, '').slice(-6)
}

export function pad2(n) {
  return (n < 10 ? '0' : '') + n
}

export function stampText(at) {
  const d = new Date(Number(at) || Date.now())
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

function isoText(at) {
  try { return new Date(Number(at) || Date.now()).toISOString() } catch (e) { return '' }
}

// ---------- 导出 ----------

export function buildSettingsDoc(opts) {
  const o = opts || {}
  const at = Number(o.at) || Date.now()
  const s = normalizeSettings(o.settings || {})
  return {
    version: ARCHIVE_VERSION,
    app: ARCHIVE_APP,
    kind: 'settings',
    mode: o.mode === 'role' ? 'role' : 'chat',
    timestamp: at,
    exportDate: isoText(at),
    data: {
      profile: {
        id: String(o.personaId || ''),
        name: String(o.personaName || (o.mode === 'role' ? '人设' : '聊天模式')),
        card: normalizeCard(o.card || {})
      },
      settings: {
        apiKey: String(s.apiKey || ''),
        baseUrl: String(s.baseUrl || ''),
        systemPrompt: String(s.systemPrompt || ''),
        maxHistory: s.maxHistory,
        saveMode: s.saveMode,
        showBalance: s.showBalance,
        sourceStyle: s.sourceStyle,
        memory: normalizeMemory(s.memory),
        params: Object.assign({}, s.params)
      }
    }
  }
}

// 只留"值得存下来"的字段：思考过程太占地方（一份记录能翻好几倍），
// pending / error 是运行时状态，存下来没意义
function slimMessages(list) {
  const out = []
  const src = list || []
  for (let i = 0; i < src.length; i++) {
    const m = src[i]
    if (!m || !m.role) continue
    const content = String(m.content == null ? '' : m.content)
    if (!content && !(m.images && m.images.length)) continue
    const rec = { id: String(m.id || ''), role: m.role, content: content, createdAt: Number(m.createdAt) || 0 }
    const reasoning = String(m.reasoning || '')
    if (reasoning) rec.reasoning = reasoning.length > 4000 ? reasoning.slice(0, 4000) : reasoning
    if (m.images && m.images.length) {
      rec.images = []
      for (let k = 0; k < m.images.length; k++) {
        const im = m.images[k] || {}
        rec.images.push({ name: String(im.name || ''), path: String(im.path || '') })
      }
    }
    if (m.sources && m.sources.length) {
      rec.sources = []
      for (let k = 0; k < m.sources.length; k++) {
        const so = m.sources[k] || {}
        rec.sources.push({ title: String(so.title || ''), url: String(so.url || '') })
      }
    }
    out.push(rec)
  }
  return out
}

export function buildRecordsDoc(opts) {
  const o = opts || {}
  const at = Number(o.at) || Date.now()
  const convs = o.convs || []
  const s = normalizeSettings(o.settings || {})
  const notes = pruneNotes(o.notes, 999)

  const sessions = []
  let msgCount = 0
  let firstAt = 0
  let lastAt = 0
  for (let i = 0; i < convs.length; i++) {
    const c = convs[i]
    if (!c || !c.id) continue
    const messages = slimMessages(c.messages)
    msgCount += messages.length
    const ca = Number(c.createdAt) || 0
    const ua = Number(c.updatedAt) || ca
    if (ca && (!firstAt || ca < firstAt)) firstAt = ca
    if (ua > lastAt) lastAt = ua
    sessions.push({
      id: String(c.id),
      title: String(c.title || '新对话'),
      createdAt: ca,
      updatedAt: ua,
      messages: messages
    })
  }

  return {
    version: ARCHIVE_VERSION,
    app: ARCHIVE_APP,
    kind: 'records',
    mode: o.mode === 'role' ? 'role' : 'chat',
    timestamp: at,
    exportDate: isoText(at),
    data: {
      profile: {
        id: String(o.personaId || ''),
        name: String(o.personaName || (o.mode === 'role' ? '人设' : '聊天模式')),
        card: normalizeCard(o.card || {})
      },
      // 这一块对应妹居物语的 gameData，但只留"进度/时间/设置/提示词"，
      // 没有好感度、等级、金币、背包那类数值
      gameData: {
        playerProgress: {
          conversationCount: sessions.length,
          messageCount: msgCount,
          firstAt: firstAt,
          lastAt: lastAt
        },
        timeSystem: {
          createdAt: firstAt,
          updatedAt: at
        },
        settings: {
          saveMode: s.saveMode,
          maxHistory: s.maxHistory,
          memory: normalizeMemory(s.memory),
          params: Object.assign({}, s.params)
        },
        prompts: {
          system: String(s.systemPrompt || ''),
          persona: String(o.personaPrompt || '')
        }
      },
      sessions: sessions,
      memory: { notes: notes }
    }
  }
}

export function toJson(doc) {
  try { return JSON.stringify(doc, null, 2) } catch (e) { return '{}' }
}

// ---------- 导入 ----------

function parseJson(text) {
  try { return JSON.parse(String(text)) } catch (e) { return null }
}

// 判断一个 JSON 是本应用的设置档还是记录档
export function detectKind(obj) {
  const o = obj && typeof obj === 'object' ? obj : {}
  if (o.kind === 'settings' || o.kind === 'records') return o.kind
  const d = o.data && typeof o.data === 'object' ? o.data : null
  if (d) {
    if (Array.isArray(d.sessions)) return 'records'
    if (d.settings) return 'settings'
  }
  if (o.apiKey != null || o.params) return 'settings'
  return ''
}

export function parseSettingsArchive(text) {
  const obj = parseJson(text)
  if (!obj) return { ok: false, error: '不是合法的 JSON' }
  const kind = detectKind(obj)
  if (kind !== 'settings') return { ok: false, error: '这不是设置文件' }
  const d = obj.data && typeof obj.data === 'object' ? obj.data : obj
  const raw = d.settings && typeof d.settings === 'object' ? d.settings : d
  const settings = normalizeSettings(raw)
  const profile = d.profile && typeof d.profile === 'object' ? d.profile : {}
  return {
    ok: true,
    settings: settings,
    name: String(profile.name || '').slice(0, 24),
    card: normalizeCard(profile.card || {}),
    at: Number(obj.timestamp) || 0
  }
}

export function parseRecordsArchive(text) {
  const obj = parseJson(text)
  if (!obj) return { ok: false, error: '不是合法的 JSON' }
  const kind = detectKind(obj)
  if (kind !== 'records') return { ok: false, error: '这不是记录文件' }
  const d = obj.data && typeof obj.data === 'object' ? obj.data : {}
  const list = Array.isArray(d.sessions) ? d.sessions : []
  const convs = []
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (!c || !c.id) continue
    const messages = []
    const src = Array.isArray(c.messages) ? c.messages : []
    for (let k = 0; k < src.length; k++) {
      const m = src[k]
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue
      messages.push({
        id: String(m.id || 'm_' + i + '_' + k),
        role: m.role,
        content: String(m.content == null ? '' : m.content),
        reasoning: String(m.reasoning || ''),
        images: Array.isArray(m.images) ? m.images : [],
        sources: Array.isArray(m.sources) ? m.sources : [],
        error: '',
        pending: false,
        createdAt: Number(m.createdAt) || 0
      })
    }
    convs.push({
      id: String(c.id),
      title: String(c.title || '新对话'),
      createdAt: Number(c.createdAt) || 0,
      updatedAt: Number(c.updatedAt) || 0,
      messages: messages
    })
  }
  const mem = d.memory && typeof d.memory === 'object' ? d.memory : {}
  const notes = pruneNotes(Array.isArray(mem.notes) ? mem.notes : [], 999)
  const profile = d.profile && typeof d.profile === 'object' ? d.profile : {}
  return {
    ok: true,
    convs: convs,
    notes: notes,
    name: String(profile.name || '').slice(0, 24),
    card: normalizeCard(profile.card || {}),
    at: Number(obj.timestamp) || 0
  }
}

// 给别人看的简介（导入列表里一行一条）
export function archiveSummary(obj) {
  const o = obj && typeof obj === 'object' ? obj : {}
  const kind = detectKind(o)
  const d = o.data && typeof o.data === 'object' ? o.data : {}
  const profile = d.profile && typeof d.profile === 'object' ? d.profile : {}
  const sessions = Array.isArray(d.sessions) ? d.sessions : []
  let msgs = 0
  for (let i = 0; i < sessions.length; i++) msgs += (sessions[i].messages || []).length
  return {
    kind: kind,
    name: String(profile.name || '') || '未命名',
    at: Number(o.timestamp) || 0,
    sessions: sessions.length,
    messages: msgs
  }
}

// ---------- 人设卡（角色卡文件） ----------
//
// 导出成 chara_card_v2 而不是内部结构：社区通用，用户能拿去别的应用用，
// 改完还能原样导回来（parsePersonaFile 认识 data 下的字段）。
export function buildPersonaCardDoc(card, opts) {
  const c = normalizeCard(card || {})
  const o = opts || {}
  const data = {
    name: c.name,
    description: c.description,
    personality: c.personality,
    scenario: c.scenario,
    first_mes: c.firstMessage,
    mes_example: c.exampleDialogue,
    creator_notes: c.creatorNotes || '由词典笔「DeepSeek」导出，可直接放回 import/ 目录再导入'
  }
  // 自定义字段（好感度规则等）也要带出去：只导标准字段的话，再导回来规则就没了。
  // 重新导入时 collectCustom 会把 custom_rules 直接当 custom 用，不会多套一层标题。
  if (c.custom) data.custom_rules = c.custom
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    app: ARCHIVE_APP,
    at: Number(o.at) || Date.now(),
    data: data
  }
}

// 文件名：保留中文（用户要能一眼认出是谁），只把路径分隔符之类的换掉
export function personaFileName(name) {
  return safeName(name || 'persona') + '.json'
}

// 示例角色卡：每个字段都写了"这里该写什么"，用户照着改一遍就能导入
export function buildPersonaSampleDoc(at) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    app: ARCHIVE_APP,
    at: Number(at) || Date.now(),
    data: {
      name: '示例：退休物理老师',
      description: '（写"他是谁"：身份、经历、住在哪、和说话的人是什么关系。越具体越像，可以分几行写。）',
      personality: '（写"他怎么说话"：语气、口癖、怎么称呼对方、爱聊什么。'
        + '例如：说话慢，爱用「哎」开头，喜欢拿生活里的例子讲道理，被问倒了会先沉默一下。）',
      scenario: '（写"日常背景"：你们是什么关系、在哪儿生活、平时各在做什么。'
        + '它只当聊天的底子，不会被反复朗读，所以别写成一场戏。）',
      first_mes: '（开场白：打开对话时角色先说的那一句。留空就等你先开口。）',
      mes_example: '（对话示例，可留空。例如：\n{{user}}: 老师，浮力是什么？\n{{char}}: 哎，你先想想，木头为什么浮在水上？）',
      creator_notes: '这是示例文件：照着改成自己的内容，放到 /userdisk/Favorite/deepseek-pen/import/ 里，'
        + '再在设置 → 人设与角色 里点「导入人设文件」'
    }
  }
}
