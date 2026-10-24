// 法定节假日数据源与解析（纯函数，可单测）
//
// 官方**没有**节假日接口；这里用两个第三方源，数据都来自"照国务院公告誊抄"的静态 JSON：
//   1) holiday-cn（GitHub NateScarlet/holiday-cn，每年一个文件，走 jsDelivr CDN）
//      结构：{ year, papers[], days: [{ name, date, isOffDay }] }
//   2) timor.tech（国内服务，Cloudflare 前置，必须带浏览器 UA 才不触发人机校验）
//      结构：{ code, holiday: { 'MM-DD': { holiday: bool, name } } }  —— 只列特殊日
//
// 两个源在 2026 年上完全一致（33 天放假 + 6 天调休补班），所以互为备份是安全的。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export const HOLIDAY_UA = UA

export function holidaySources(year) {
  const y = String(year)
  const gh = 'NateScarlet/holiday-cn@master/' + y + '.json'
  return [
    { url: 'https://cdn.jsdelivr.net/gh/' + gh, kind: 'holiday-cn' },
    { url: 'https://fastly.jsdelivr.net/gh/' + gh, kind: 'holiday-cn' },
    { url: 'https://timor.tech/api/holiday/year/' + y, kind: 'timor' }
  ]
}

// 把两种格式统一成 [{ date:'YYYY-MM-DD', isOffDay, name }]，按日期排序。
//
// 数据质量门槛：一天都没有就返回 null。这一条很关键 —— 次年公告发布前（例如 10 月
// 去问 2027 年）holiday-cn 会返回 `days: []`，timor 返回 `holiday: {}`。
// 如果把它当成有效数据，峰谷判定就会以为"明年全年无休"，国庆也会按峰价算。
export function parseHolidayPayload(kind, body, year) {
  let obj = null
  try { obj = JSON.parse(body) } catch (e) { return null }
  if (!obj || typeof obj !== 'object') return null

  const out = []
  if (kind === 'timor') {
    const map = obj.holiday || {}
    const keys = Object.keys(map)
    for (let i = 0; i < keys.length; i++) {
      const k = String(keys[i])
      if (!/^\d{2}-\d{2}$/.test(k)) continue
      const v = map[k] || {}
      out.push({ date: String(year) + '-' + k, isOffDay: v.holiday !== false, name: String(v.name || '') })
    }
  } else {
    const days = Array.isArray(obj.days) ? obj.days : []
    for (let i = 0; i < days.length; i++) {
      const d = days[i]
      if (!d || !d.date) continue
      const s = String(d.date)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue
      out.push({ date: s, isOffDay: d.isOffDay !== false, name: String(d.name || '') })
    }
  }

  if (out.length < 5) return null
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return out
}

// 从统一结构里取统计（放这里是为了单测能直接断言两边一致）
export function countHolidayDays(days) {
  let off = 0
  let work = 0
  for (let i = 0; i < (days || []).length; i++) {
    if (days[i].isOffDay) off++
    else work++
  }
  return { off: off, work: work }
}
