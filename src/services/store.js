// 持久化：设置 + 会话。全部走文件（本机 storage JSAPI 的 Promise 有挂起风险，
// 不拿它做关键路径）。
//
// 设置是按"档案"分的：聊天模式一份，扮演模式下的**每个人设各一份**（完全隔离）。
// 磁盘上仍是一个 settings.json（v2 结构），但对外只暴露"当前这份"，见 lib/profile.js。

import { readText, readTextEx, writeText, writeTextEx, ensureAppDir, joinPath, exists, logLine } from './platform.js'
import { storageGet, storageSet, storageAvailable } from './storage.js'
import {
  normalizeDoc, emptyDoc, pickProfile, writeProfile, profileKey,
  setMode as docSetMode, setActivePersona, addPersona as docAddPersona,
  removePersona as docRemovePersona, renamePersona as docRenamePersona,
  setPersonaCard as docSetPersonaCard, cloneProfile
} from '../lib/profile.js'
import { pruneNotes } from '../lib/memory.js'
import { judgeReadback } from '../lib/savecheck.js'
import { normalizeBalance } from '../lib/balance.js'
import { publishMemory } from '../lib/uistate.js'

const F_SETTINGS = 'settings.json'
const F_CHATS = 'chats.json'
const F_PHOTO_SEEN = 'photoseen.json'
const F_BALANCE = 'balance.json'
const F_HOLIDAY = 'holiday.json'
const F_AMAP = 'amap.json'

// 档案名直接拼进文件名，只留安全字符（人设 id 已经是 p_xxx，这里再兜一层）
function fileTag(key) {
  return String(key || 'chat').replace(/[^A-Za-z0-9_-]/g, '')
}

function p(name) {
  return joinPath(ensureAppDir(), name)
}

// 一条数据写两份：文件 + 宿主 storage。
// 文件好用（adb 能直接看、能导出），但本机型有「writeFile 报成功却不落盘」的记录；
// storage 是真会落盘的那个，但部分固件读回空串。所以两边都写，读的时候文件优先、
// 读不到或内容坏了再读 storage —— 任一边正常，用户的设置和会话就不会丢。
const MIRROR_MAX = 60000

function mirror(name, text) {
  const s = String(text == null ? '' : text)
  if (!s || s.length > MIRROR_MAX) return
  storageSet(name, s).then((ok) => {
    if (!ok) logLine('W', 'storage 镜像失败 ' + name + ' len=' + s.length)
  }, () => { /* 已在 storage 层吞过，这里再兜一层 */ })
}

async function readDoc(file, name, retries) {
  if (await exists(file)) {
    const r = await readTextEx(file, retries || 3)
    if (r.ok && r.text) return r.text
    if (!r.ok) logLine('W', '读文件失败 ' + name + ' :: ' + r.error)
  }
  const sv = await storageGet(name)
  if (sv) {
    logLine('W', '从 storage 恢复 ' + name + ' len=' + sv.length)
    return sv
  }
  return null
}

// 当前这份设置文档。切模式 / 切人设 / 改人设卡都改它，再整体落盘。
// 放模块级（不是页面级）是有原因的：saveSettings 必须是**同步**的
// （本机 fs.writeFile 同步实现，await 反而卡事件循环），同步就没法先读文件
// 再改槽位 —— 那份文件在 loadSettings 时已经读进内存了。
let _doc = null

export function getDoc() {
  if (!_doc) _doc = emptyDoc()
  return _doc
}

export function getProfileKey() {
  return profileKey(getDoc())
}

export async function loadSettings() {
  // readDoc 内部：文件存在才读（不存在是确定性答案，不值得反复重试），文件读不到再读 storage
  const raw = await readDoc(p(F_SETTINGS), F_SETTINGS, 3)
  let doc = null
  if (raw) {
    try {
      doc = normalizeDoc(JSON.parse(raw))
    } catch (e) {
      logLine('W', 'settings.json 解析失败，用默认值')
      doc = null
    }
  }
  _doc = doc || emptyDoc()
  return pickProfile(_doc)
}

// 落盘整份文档（同步）。saved 是归一化后要写的内容，返回是否成功。
function writeDoc(doc) {
  doc.updatedAt = Date.now()
  const text = JSON.stringify(doc)
  const path = p(F_SETTINGS)
  let reason = ''
  // 两轮：首次启动时 mkdir / fs 可能还没就绪，补一次基本能过
  for (let attempt = 1; attempt <= 2; attempt++) {
    ensureAppDir()
    const r = writeTextEx(path, text)
    if (r.ok) {
      if (attempt > 1) logLine('W', 'saveSettings 第 ' + attempt + ' 轮才写成功')
      lastSave = { ok: true, reason: '', path: path, at: doc.updatedAt, attempt: attempt }
      mirror(F_SETTINGS, text)
      // 本机 writeFile 有"不报错也不落盘"的分支（实测把目标换成目录时就是），
      // 所以 ok 不等于写成功，必须回读确认。异步做，不拖慢自动保存。
      scheduleVerify(text, path)
      return true
    }
    reason = r.error
    logLine('E', 'saveSettings 写失败 第' + attempt + '轮 :: ' + r.error + ' @ ' + path)
  }
  // 文件通道挂了但宿主 storage 还在：数据其实存下来了，别让用户看到"保存失败"
  if (storageAvailable()) {
    mirror(F_SETTINGS, text)
    lastSave = { ok: true, reason: '仅存储通道', path: path, at: doc.updatedAt, attempt: 2 }
    logLine('W', 'saveSettings 改走 storage 通道（文件写入失败：' + shortErr(reason) + '）')
    return true
  }
  lastSave = { ok: false, reason: shortErr(reason), path: path, at: Date.now(), attempt: 2 }
  return false
}

// 最近一次保存的结果。界面拿它显示"到底为什么没存上"，日志拿它留现场。
// 以前 saveSettings 只返回 null，调用方除了说一句"保存失败"什么都讲不出来。
let lastSave = { ok: true, reason: '', path: '', at: 0, attempt: 0 }

export function getLastSaveInfo() {
  return lastSave
}

function shortErr(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > 56 ? t.slice(0, 56) + '…' : (t || 'unknown')
}

export function saveSettings(settings) {
  const doc = getDoc()
  writeProfile(doc, settings)
  if (!writeDoc(doc)) return null
  return pickProfile(doc)
}

// ---------- 模式 / 人设 ----------
// 这三件事都要"立刻落盘"：切过去之后用户看到的是另一套配置，
// 如果只留在内存里，重启回到旧模式，设置和记录就对不上了。

export function switchMode(mode) {
  const doc = getDoc()
  docSetMode(doc, mode)
  if (!writeDoc(doc)) return null
  return pickProfile(doc)
}

export function switchPersona(id) {
  const doc = getDoc()
  if (!setActivePersona(doc, id)) return null
  if (!writeDoc(doc)) return null
  return pickProfile(doc)
}

export function addPersona(opts) {
  const doc = getDoc()
  const id = docAddPersona(doc, opts || {})
  if (!id) return ''
  writeDoc(doc)
  return id
}

export function removePersona(id) {
  const doc = getDoc()
  if (!docRemovePersona(doc, id)) return false
  // 删掉的正好是当前人设时，activeId 已被改指到第一个，这里要把模式也交代清楚
  if (!doc.role.personas.length) doc.mode = 'chat'
  writeDoc(doc)
  return true
}

export function renamePersona(id, name) {
  const doc = getDoc()
  if (!docRenamePersona(doc, id, name)) return false
  writeDoc(doc)
  return true
}

export function savePersonaCard(id, card) {
  const doc = getDoc()
  if (!docSetPersonaCard(doc, id, card)) return false
  writeDoc(doc)
  return true
}

// 「与 XX 一致」要读**别人**的那份设置。这里不动内存里的当前档案，
// 只构造一个临时视图给 pickProfile 铺平 —— 切过去再切回来会有两次写盘，
// 中途断电就变成"切了模式但没切回来"。
export function readOtherProfile(mode, personaId) {
  const doc = getDoc()
  if (mode === 'chat') {
    return pickProfile({ mode: 'chat', chat: doc.chat, role: doc.role })
  }
  let found = null
  const list = doc.role.personas || []
  for (let i = 0; i < list.length; i++) if (list[i].id === personaId) found = list[i]
  if (!found) return null
  return pickProfile({ mode: 'role', chat: doc.chat, role: { activeId: found.id, personas: list } })
}

// 「与本模式/某个人设一致」：把源设置整包复制到当前档案
export function cloneProfileInto(source) {
  const doc = getDoc()
  cloneProfile(source, doc.mode, doc)
  if (!writeDoc(doc)) return null
  return pickProfile(doc)
}


// 写后读回：只留一个待执行的校验，连续改动不会堆成一片读。
//
// 关键点：**每次写入都要换掉"期望内容"并重新计时**。
// 以前是"已经排了一个就不管了"——连续两次写入（导入人设时 addPersona + switchPersona
// 会连写三遍）时，第一次排的校验读到的是第三遍的内容，长度一样、内容不同，
// 于是报「写后读回不一致」，把一次完全正常的保存记成了失败。
let verifyTimer = null
let verifyWant = { text: '', path: '' }
function scheduleVerify(expected, path) {
  verifyWant = { text: expected, path: path }
  if (verifyTimer) clearTimeout(verifyTimer)
  verifyTimer = setTimeout(() => {
    verifyTimer = null
    const expected2 = verifyWant.text
    const path2 = verifyWant.path
    readTextEx(path2, 1).then((r) => {
      const expected = expected2
      const path = path2
      const v = judgeReadback(expected, r)
      if (!v.ok) {
        lastSave = { ok: false, reason: v.reason, path: path, at: Date.now(), attempt: 2 }
        logLine('E', 'saveSettings ' + v.reason +
          '（len 期望 ' + String(v.wantLen == null ? expected.length : v.wantLen) +
          ' 实际 ' + String(v.gotLen == null ? 0 : v.gotLen) + '）@ ' + path)
      }
    }).catch((e) => {
      logLine('E', 'saveSettings 读回异常 :: ' + (e && e.message ? e.message : e))
    })
  }, 250)
}

// 写入自检：给设置页「诊断」用，分步告诉用户卡在哪一步（写 / 读 / 内容）
export async function selfTestWrite() {
  const dir = ensureAppDir()
  const file = joinPath(dir, 'selftest.txt')
  const text = 'ok-' + Date.now()
  const w = writeTextEx(file, text)
  if (!w.ok) return { ok: false, step: 'write', error: shortErr(w.error), dir: dir }
  const r = await readTextEx(file, 2)
  if (!r.ok) return { ok: false, step: 'read', error: shortErr(r.error), dir: dir }
  if (String(r.text) !== text) return { ok: false, step: 'compare', error: '写进去的是另一份内容', dir: dir }
  return { ok: true, step: 'done', error: '', dir: dir }
}

export async function loadChats() {
  const raw = await readDoc(p(chatFile()), chatFile(), 3)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((c) => c && c.id && Array.isArray(c.messages))
  } catch (e) {
    return []
  }
}

// 会话文件按档案分：聊天模式沿用 chats.json（老数据不用迁移），
// 每个人设各一个 chats_role_<id>.json —— 切人设就是换一套记录
function chatFile() {
  const k = getProfileKey()
  return k === 'chat' ? F_CHATS : 'chats_' + fileTag(k) + '.json'
}

// 会话上限：设备只有 1GB 内存，且整个 JSON 要一次性读写
export const MAX_CONVERSATIONS = 24

// 「上次看到的照片」快照。必须落盘，不能只放内存：
// 从系统相机返回时页面可能已经被框架重建，内存里的快照就没了，
// 新拍的照片会被当成"首次基线"而静默丢掉（实机踩到过）。
export async function loadPhotoSeen() {
  const raw = await readDoc(p(F_PHOTO_SEEN), F_PHOTO_SEEN, 2)
  if (!raw) return null
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return arr
      .filter((x) => x && typeof x.key === 'string')
      .map((x) => ({ key: x.key, mtime: Number(x.mtime) || 0 }))
  } catch (e) {
    return null
  }
}

export function savePhotoSeen(photos) {
  const list = (photos || []).slice(0, 80).map((p) => ({ key: p.key, mtime: p.mtime || 0 }))
  const text = JSON.stringify(list)
  const ok = writeText(p(F_PHOTO_SEEN), text)
  mirror(F_PHOTO_SEEN, text)
  return ok
}

export function saveChats(convs) {
  const list = (convs || []).slice()
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  const kept = list.slice(0, MAX_CONVERSATIONS)
  const text = JSON.stringify(kept)
  const name = chatFile()
  const ok = writeText(p(name), text)
  mirror(name, text)
  return ok
}

// 余额缓存：单独一个文件，不去动 settings.json（那个每次改参数都会重写，
// 混在一起容易在流式过程中互相覆盖）。也按档案分 —— 每个人设可以是不同的 Key，
// 余额当然是各查各的。
function balanceFile() {
  const k = getProfileKey()
  return k === 'chat' ? F_BALANCE : 'balance_' + fileTag(k) + '.json'
}

export async function loadBalance() {
  const name = balanceFile()
  const raw = await readDoc(p(name), name, 2)
  if (!raw) return null
  try {
    const b = normalizeBalance(JSON.parse(raw))
    // at 为 0 表示从没成功查过，等于没有
    return b.at ? b : null
  } catch (e) {
    return null
  }
}

export function saveBalance(balance) {
  const text = JSON.stringify(normalizeBalance(balance))
  const name = balanceFile()
  const ok = writeText(p(name), text)
  mirror(name, text)
  return ok
}

// ---------- 记忆（上下文压缩的产物）----------
// 按档案存：切人设就是换一段记忆，不会把两个人的对话混在一起。
export function memoryFile() {
  return 'memory_' + fileTag(getProfileKey()) + '.json'
}

// floor = 「清空记忆」那一刻的时间戳。比它更早的消息不再折进记忆 ——
// 否则用户点完清空、随手再发一句，被丢弃的那十几条又会被原样折回来，
// 看起来就是"清空没生效"。清空之后新产生的对话照常攒。
export async function loadMemoryState() {
  const name = memoryFile()
  const raw = await readDoc(p(name), name, 2)
  if (!raw) return { notes: [], floor: 0 }
  try {
    const o = JSON.parse(raw)
    const list = o && Array.isArray(o.notes) ? o.notes : []
    const floor = o && typeof o.floor === 'number' && o.floor > 0 ? o.floor : 0
    return { notes: pruneNotes(list, 999), floor: floor }
  } catch (e) {
    return { notes: [], floor: 0 }
  }
}

export async function loadMemory() {
  const st = await loadMemoryState()
  return st.notes
}

export function saveMemory(notes, floor) {
  const list = pruneNotes(notes, 999)
  const text = JSON.stringify({ at: Date.now(), floor: Number(floor) || 0, notes: list })
  const name = memoryFile()
  const ok = writeText(p(name), text)
  mirror(name, text)
  return ok
}

export function clearMemory() {
  const ok = saveMemory([], Date.now())
  // 首页实例还活着，手上那份 memNotes 不会自己失效；不通知的话下次发消息
  // 会把刚清掉的记忆原样折回去，看起来像"清空没生效"。
  publishMemory()
  return ok
}

// 节假日数据缓存：{ at, source, years: { '2026': [{date,isOffDay,name}, ...] } }
// 一年只变一次，所以不做节流；存下来是为了断网 / 首次启动也能用真实安排。
export async function loadHolidayCache() {
  const raw = await readDoc(p(F_HOLIDAY), F_HOLIDAY, 2)
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    if (!o || !o.years || typeof o.years !== 'object') return null
    return o
  } catch (e) {
    return null
  }
}

export function saveHolidayCache(cache) {
  const text = JSON.stringify(cache)
  const ok = writeText(p(F_HOLIDAY), text)
  mirror(F_HOLIDAY, text)
  return ok
}

// 高德地图 Key：**不按档案分**，单独一个文件。
// 地图/天气是「这台设备的能力」，不是某个角色的设定 —— 挂进 settings 的话，
// 切个人设就变成"地图突然不能用了，得再填一次 Key"，没人受得了这个。
// 配置里有两个字段：
//   key  —— 高德 Web服务 Key
//   auto —— 聊天里是否自动识别意图（关掉后只有明确说「使用高德地图」才查）。
//           老文件没有 auto 字段，按 true 处理：升级上来的用户不该突然失去这个功能
export async function loadAmapCfg() {
  const raw = await readDoc(p(F_AMAP), F_AMAP, 2)
  if (!raw) return { key: '', auto: true }
  try {
    const o = JSON.parse(raw)
    return {
      key: typeof o.key === 'string' ? o.key.trim() : '',
      auto: o.auto !== false
    }
  } catch (e) {
    return { key: '', auto: true }
  }
}

export function saveAmapCfg(cfg) {
  const c = cfg || {}
  const text = JSON.stringify({
    key: String(c.key == null ? '' : c.key).trim(),
    auto: c.auto !== false,
    at: Date.now()
  })
  const ok = writeText(p(F_AMAP), text)
  mirror(F_AMAP, text)
  return ok
}

export async function loadAmapKey() {
  const c = await loadAmapCfg()
  return c.key
}

export function saveAmapKey(key) {
  return saveAmapCfg({ key: key, auto: true })
}

export function exportAll(settings, convs) {
  return JSON.stringify({ settings: settings, conversations: convs, at: Date.now() })
}