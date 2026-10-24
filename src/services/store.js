// 持久化：设置 + 会话。全部走文件（本机 storage JSAPI 的 Promise 有挂起风险，
// 不拿它做关键路径）。

import { readText, writeText, ensureAppDir, joinPath, exists } from './platform.js'
import { normalizeSettings, DEFAULT_SETTINGS } from '../lib/settings.js'
import { normalizeBalance } from '../lib/balance.js'

const F_SETTINGS = 'settings.json'
const F_CHATS = 'chats.json'
const F_PHOTO_SEEN = 'photoseen.json'
const F_BALANCE = 'balance.json'
const F_HOLIDAY = 'holiday.json'

function p(name) {
  return joinPath(ensureAppDir(), name)
}

export async function loadSettings() {
  // 文件不存在是**确定性**答案（首次启动就是这样），不能当瞬时错误反复重试：
  // 之前固定重试 4 次，冷启动会在日志里刷出 8 次 ENOENT，纯属浪费 flash I/O。
  if (!(await exists(p(F_SETTINGS)))) return normalizeSettings(DEFAULT_SETTINGS)
  // 存在但读到空，多半是写到一半被读到了，才值得重试
  const raw = await readText(p(F_SETTINGS), 3)
  if (!raw) return normalizeSettings(DEFAULT_SETTINGS)
  try {
    return normalizeSettings(JSON.parse(raw))
  } catch (e) {
    return normalizeSettings(DEFAULT_SETTINGS)
  }
}

export function saveSettings(settings) {
  const s = normalizeSettings(settings)
  s.updatedAt = Date.now()
  const ok = writeText(p(F_SETTINGS), JSON.stringify(s))
  return ok ? s : null
}

export async function loadChats() {
  if (!(await exists(p(F_CHATS)))) return []
  const raw = await readText(p(F_CHATS), 3)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((c) => c && c.id && Array.isArray(c.messages))
  } catch (e) {
    return []
  }
}

// 会话上限：设备只有 1GB 内存，且整个 JSON 要一次性读写
export const MAX_CONVERSATIONS = 24

// 「上次看到的照片」快照。必须落盘，不能只放内存：
// 从系统相机返回时页面可能已经被框架重建，内存里的快照就没了，
// 新拍的照片会被当成"首次基线"而静默丢掉（实机踩到过）。
export async function loadPhotoSeen() {
  if (!(await exists(p(F_PHOTO_SEEN)))) return null
  const raw = await readText(p(F_PHOTO_SEEN), 2)
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
  return writeText(p(F_PHOTO_SEEN), JSON.stringify(list))
}

export function saveChats(convs) {
  const list = (convs || []).slice()
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  const kept = list.slice(0, MAX_CONVERSATIONS)
  const ok = writeText(p(F_CHATS), JSON.stringify(kept))
  return ok
}

// 余额缓存：单独一个文件，不去动 settings.json（那个每次改参数都会重写，
// 混在一起容易在流式过程中互相覆盖）。
export async function loadBalance() {
  if (!(await exists(p(F_BALANCE)))) return null
  const raw = await readText(p(F_BALANCE), 2)
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
  return writeText(p(F_BALANCE), JSON.stringify(normalizeBalance(balance)))
}

// 节假日数据缓存：{ at, source, years: { '2026': [{date,isOffDay,name}, ...] } }
// 一年只变一次，所以不做节流；存下来是为了断网 / 首次启动也能用真实安排。
export async function loadHolidayCache() {
  if (!(await exists(p(F_HOLIDAY)))) return null
  const raw = await readText(p(F_HOLIDAY), 2)
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
  return writeText(p(F_HOLIDAY), JSON.stringify(cache))
}

export function exportAll(settings, convs) {
  return JSON.stringify({ settings: settings, conversations: convs, at: Date.now() })
}