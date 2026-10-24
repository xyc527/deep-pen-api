// 法定节假日数据的取用编排（缓存 + 网络 + 内置表兜底）
//
// 为什么需要这一层：峰谷判定依赖"今天算不算法定节假日"，而这个安排每年由国务院
// 在**前一年 11 月前后**公布。写死表意味着每年都要改代码重新出包，所以：
//   内置表（peak.js）   —— 永远可用，兜底
//   网络拉取（api.js）  —— 公布后自动跟上
//   本地缓存（holiday.json）—— 断网也不丢
//
// 判定"要不要拉"只看当前年：春节/国庆都在当年，跨年那一两天误差无关紧要
// （12 月底顺带把次年也拉一次，公布得早就能提前用上）。

import { fetchHolidayYear } from './api.js'
import { loadHolidayCache, saveHolidayCache } from './store.js'
import { applyHolidayDays, holidayMeta, hasHolidayData, bjParts, nowMs } from '../lib/peak.js'

const STALE_MS = 30 * 86400000 // 一个月刷一次足够：数据一年才变一次
const RETRY_MS = 6 * 3600000 // 拉失败别反复试，6 小时后再来
let _lastTry = 0
let _busy = false

// 把缓存里的数据装进运行时表（同步语义：调用后立刻生效）
export async function restoreHoliday() {
  const cache = await loadHolidayCache()
  if (!cache) return null
  const years = cache.years || {}
  const keys = Object.keys(years)
  for (let i = 0; i < keys.length; i++) {
    applyHolidayDays(keys[i], years[keys[i]], { at: cache.at, source: cache.source })
  }
  return cache
}

function cacheAge(cache) {
  if (!cache || !cache.at) return Infinity
  return nowMs() - Number(cache.at)
}

// 需要的话拉一次。失败不抛错 —— 顶栏和设置页不能因为第三方接口挂了就报红。
// 返回 { ok, msg, fetched: [] }
export async function ensureHoliday(opts) {
  const options = opts || {}
  const p = bjParts(nowMs())
  const want = [p.year]
  if (p.month >= 11) want.push(p.year + 1) // 11 月后顺带拉次年（公告通常已发布）

  const cache = await loadHolidayCache()
  const cached = (cache && cache.years) || {}
  const missing = want.filter((y) => !cached[y] || !(cached[y] || []).length)
  const stale = cacheAge(cache) > STALE_MS

  if (_busy) return { ok: false, msg: '正在刷新', fetched: [] }
  if (!options.force) {
    if (!missing.length && !stale) return { ok: true, msg: '数据已是最新', fetched: [] }
    if (nowMs() - _lastTry < RETRY_MS) return { ok: false, msg: '稍后再试', fetched: [] }
  }

  _busy = true
  _lastTry = nowMs()
  const fetched = []
  const merged = Object.assign({}, cached)
  let err = ''
  try {
    for (let i = 0; i < want.length; i++) {
      const y = want[i]
      // 强制刷新时也照样重拉；非强制时已有的年份跳过
      if (!options.force && cached[y] && (cached[y] || []).length) continue
      try {
        const r = await fetchHolidayYear(y, { timeoutMs: 6000 })
        applyHolidayDays(r.year, r.days, { at: nowMs(), source: r.source })
        merged[y] = r.days
        fetched.push(r.year)
        // 拿到一年就立刻落盘：后面那一年失败也不影响已拿到的
        await saveHolidayCache({ at: nowMs(), source: r.source, years: merged })
      } catch (e) {
        err = (e && e.message) || '拉取失败'
      }
    }
  } finally {
    _busy = false
  }

  if (fetched.length) return { ok: true, msg: '已更新 ' + fetched.join('、'), fetched: fetched }
  return { ok: false, msg: err || '没有可更新的一年', fetched: [] }
}

// 给界面看的一句话：数据来源与新鲜度
export function holidaySummary() {
  const meta = holidayMeta()
  const p = bjParts(nowMs())
  const from = hasHolidayData(p.year) ? '有' : '无'
  if (!meta.at) return { text: '内置表（当年 ' + from + '）', years: meta.years, at: 0, source: 'builtin' }
  return {
    text: meta.years.join('/') + ' 年 · ' + (meta.source === 'timor' ? 'timor.tech' : 'holiday-cn') + ' · ' + agoText(meta.at),
    years: meta.years,
    at: meta.at,
    source: meta.source
  }
}

function agoText(at) {
  const d = Math.max(0, nowMs() - Number(at))
  const day = Math.floor(d / 86400000)
  if (day >= 1) return day + ' 天前更新'
  const h = Math.floor(d / 3600000)
  if (h >= 1) return h + ' 小时前更新'
  return '刚刚更新'
}

export function resetHolidayThrottle() {
  _lastTry = 0
}
