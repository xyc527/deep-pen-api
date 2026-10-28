// 持久化：设置 + 会话。全部走文件（本机 storage JSAPI 的 Promise 有挂起风险，
// 不拿它做关键路径）。

import { readText, readTextEx, writeText, writeTextEx, ensureAppDir, joinPath, exists, logLine } from './platform.js'
import { storageGet, storageSet, storageAvailable } from './storage.js'
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

export async function loadSettings() {
  // readDoc 内部：文件存在才读（不存在是确定性答案，不值得反复重试），文件读不到再读 storage
  const raw = await readDoc(p(F_SETTINGS), F_SETTINGS, 3)
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
      mirror(F_SETTINGS, text)
      // 本机 writeFile 有"不报错也不落盘"的分支（实测把目标换成目录时就是），
      // 所以 ok 不等于写成功，必须回读确认。异步做，不拖慢自动保存。
      scheduleVerify(text, path)
      return s
    }
    reason = r.error
    logLine('E', 'saveSettings 写失败 第' + attempt + '轮 :: ' + r.error + ' @ ' + path)
  }
  // 文件通道挂了但宿主 storage 还在：数据其实存下来了，别让用户看到"保存失败"
  if (storageAvailable()) {
    mirror(F_SETTINGS, text)
    lastSave = { ok: true, reason: '仅存储通道', path: path, at: s.updatedAt, attempt: 2 }
    logLine('W', 'saveSettings 改走 storage 通道（文件写入失败：' + shortErr(reason) + '）')
    return s
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
  const raw = await readDoc(p(F_CHATS), F_CHATS, 3)
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
  const ok = writeText(p(F_CHATS), text)
  mirror(F_CHATS, text)
  return ok
}

// 余额缓存：单独一个文件，不去动 settings.json（那个每次改参数都会重写，
// 混在一起容易在流式过程中互相覆盖）。
export async function loadBalance() {
  const raw = await readDoc(p(F_BALANCE), F_BALANCE, 2)
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
  const ok = writeText(p(F_BALANCE), text)
  mirror(F_BALANCE, text)
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

export function exportAll(settings, convs) {
  return JSON.stringify({ settings: settings, conversations: convs, at: Date.now() })
}