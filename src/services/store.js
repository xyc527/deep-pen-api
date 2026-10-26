// 持久化：设置 + 会话。全部走文件（本机 storage JSAPI 的 Promise 有挂起风险，
// 不拿它做关键路径）。

import { readText, readTextEx, writeText, writeTextEx, ensureAppDir, joinPath, exists, logLine } from './platform.js'
import { normalizeSettings, DEFAULT_SETTINGS } from '../lib/settings.js'
import { judgeReadback } from '../lib/savecheck.js'
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
  const s = normalizeSettings(settings)
  s.updatedAt = Date.now()
  const text = JSON.stringify(s)
  const path = p(F_SETTINGS)
  let reason = ''
  // 两轮：首次启动时 mkdir / fs 可能还没就绪，补一次基本能过
  for (let attempt = 1; attempt <= 2; attempt++) {
    ensureAppDir()
    const r = writeTextEx(path, text)
    if (r.ok) {
      if (attempt > 1) logLine('W', 'saveSettings 第 ' + attempt + ' 轮才写成功')
      lastSave = { ok: true, reason: '', path: path, at: s.updatedAt, attempt: attempt }
      // 本机 writeFile 有"不报错也不落盘"的分支（实测把目标换成目录时就是），
      // 所以 ok 不等于写成功，必须回读确认。异步做，不拖慢自动保存。
      scheduleVerify(text, path)
      return s
    }
    reason = r.error
    logLine('E', 'saveSettings 写失败 第' + attempt + '轮 :: ' + r.error + ' @ ' + path)
  }
  lastSave = { ok: false, reason: shortErr(reason), path: path, at: Date.now(), attempt: 2 }
  return null
}

// 写后读回：只留一个待执行的校验，连续改动不会堆成一片读
let verifyPending = false
function scheduleVerify(expected, path) {
  if (verifyPending) return
  verifyPending = true
  setTimeout(() => {
    verifyPending = false
    readTextEx(path, 1).then((r) => {
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