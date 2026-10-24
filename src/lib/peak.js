// 峰谷计费时段判定（纯函数，可单测）
//
// 官方**没有**提供"当前是峰还是谷"的接口，只在价格页脚注里写明规则：
//   「空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）
//     9:00-12:00、14:00-18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天
//     均为空闲时段。」
// 所以只能客户端自己算。这里刻意不读设备时区：一律按 UTC+8 推算北京时间，
// 设备时区设错（或没同步 NTP）也不会算错 —— 真正需要校正的是**系统时钟本身**，
// 用余额接口响应头里的 Date 做偏差补偿（setTimeSkew）。
//
// 另一个坑：2026-08-23 起周末统一按空闲计价，所以**不需要**「调休上班的周末」表，
// 只要法定节假日表。周末本来就整天空闲，节假日表里含周末的日期属于冗余，无害。

const BJ_OFFSET = 8 * 3600 * 1000
const DAY_MS = 86400000

// 2026 年法定节假日（国办发明电〔2025〕7 号），区间闭区间，MM-DD。
export const YEAR_HOLIDAYS = {
  2026: [
    ['01-01', '01-03'], // 元旦
    ['02-15', '02-23'], // 春节
    ['04-04', '04-06'], // 清明
    ['05-01', '05-05'], // 劳动节
    ['06-19', '06-21'], // 端午
    ['09-25', '09-27'], // 中秋
    ['10-01', '10-07'] // 国庆
  ]
}

// 高峰窗口（北京时间，分钟数）：上午 9:00-12:00、下午 14:00-18:00
export const PEAK_WINDOWS = [[540, 720], [840, 1080]]

const _holidaySets = {}

// 网络拉到的节假日安排，优先于内置表。
//   _netOff[year]  = { 'MM-DD': true }  放假
//   _netWork[year] = { 'MM-DD': true }  调休上班（当前规则下周末本来就全天空闲，
//                                        这张表只为将来规则改回去时留一手）
const _netOff = {}
const _netWork = {}
let _holidayMeta = { at: 0, source: '', years: [] }

// 落一份网络数据（days: [{date:'YYYY-MM-DD', isOffDay, name}]）
export function applyHolidayDays(year, days, meta) {
  const y = Number(year)
  if (!y || !Array.isArray(days) || !days.length) return false
  const off = {}
  const work = {}
  for (let i = 0; i < days.length; i++) {
    const d = days[i]
    const s = String((d && d.date) || '')
    if (s.length < 10) continue
    const key = s.slice(5, 10)
    if (d.isOffDay === false) work[key] = true
    else off[key] = true
  }
  if (!Object.keys(off).length) return false
  _netOff[y] = off
  _netWork[y] = work
  const years = Object.keys(_netOff).map((k) => parseInt(k, 10)).sort()
  _holidayMeta = { at: (meta && meta.at) || Date.now(), source: (meta && meta.source) || '', years: years }
  return true
}

export function holidayMeta() {
  return { at: _holidayMeta.at, source: _holidayMeta.source, years: _holidayMeta.years.slice() }
}

// 该年是否有可用的节假日数据（网络优先，其次内置表）
export function hasHolidayData(year) {
  return !!(_netOff[year] && Object.keys(_netOff[year]).length) || !!YEAR_HOLIDAYS[year]
}

// 某年是不是靠网络数据在跑（设置页用来显示数据来源）
export function holidayYearFrom(year) {
  return _netOff[year] ? 'net' : (YEAR_HOLIDAYS[year] ? 'builtin' : 'none')
}

function expandHolidays(year) {
  const ranges = YEAR_HOLIDAYS[year]
  const set = {}
  if (!ranges) return set
  for (let i = 0; i < ranges.length; i++) {
    const a = String(ranges[i][0]).split('-')
    const b = String(ranges[i][1]).split('-')
    let t = Date.UTC(year, parseInt(a[0], 10) - 1, parseInt(a[1], 10))
    const end = Date.UTC(year, parseInt(b[0], 10) - 1, parseInt(b[1], 10))
    // 上限兜底，防手写表写反造成死循环
    for (let guard = 0; t <= end && guard < 40; guard++) {
      const d = new Date(t)
      const key = pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
      set[key] = true
      t += DAY_MS
    }
  }
  return set
}

export function isHoliday(year, month, day) {
  const key = pad2(month) + '-' + pad2(day)
  const net = _netOff[year]
  if (net && Object.keys(net).length) return !!net[key]
  if (!_holidaySets[year]) _holidaySets[year] = expandHolidays(year)
  return !!_holidaySets[year][key]
}

// 调休上班日（当前规则下不影响峰谷判定，仅备将来规则变化）
export function isMakeupWorkday(year, month, day) {
  const net = _netWork[year]
  return !!(net && net[pad2(month) + '-' + pad2(day)])
}

export function holidayTableYears() {
  return Object.keys(YEAR_HOLIDAYS).map((y) => parseInt(y, 10)).sort()
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n
}

// 把时间戳拆成北京时间的各部分。dayStart 是北京时间当天 00:00:00.000 的时间戳。
export function bjParts(ts) {
  const t = Math.floor(ts / 1000) * 1000
  const d = new Date(t + BJ_OFFSET)
  const h = d.getUTCHours()
  const mi = d.getUTCMinutes()
  const s = d.getUTCSeconds()
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(), // 0=周日
    minutes: h * 60 + mi,
    dayStart: t - (h * 3600 + mi * 60 + s) * 1000
  }
}

// 某一天的高峰窗口（毫秒时间戳区间）；周末/节假日返回空数组
function windowsOfDay(p) {
  if (p.weekday === 0 || p.weekday === 6) return []
  if (isHoliday(p.year, p.month, p.day)) return []
  const out = []
  for (let i = 0; i < PEAK_WINDOWS.length; i++) {
    out.push([
      p.dayStart + PEAK_WINDOWS[i][0] * 60000,
      p.dayStart + PEAK_WINDOWS[i][1] * 60000
    ])
  }
  return out
}

// 从 now 开始向后找最近的高峰开始时间（10 天内；再远就没意义了）
function nextPeakStart(now, today) {
  for (let k = 0; k <= 10; k++) {
    const dayStart = today.dayStart + k * DAY_MS
    const p = bjParts(dayStart + 12 * 3600 * 1000)
    p.dayStart = dayStart
    const wins = windowsOfDay(p)
    for (let i = 0; i < wins.length; i++) {
      if (wins[i][0] > now) return wins[i][0]
    }
  }
  return 0
}

// 当前计费时段。
// 返回 { peak, label, reason, until, remainMs }
//   reason: 'workday'（工作日高峰） / 'weekend' / 'holiday' / 'break'（工作日午休或夜间）
export function billingPeriod(ts) {
  const now = typeof ts === 'number' ? ts : nowMs()
  const p = bjParts(now)
  const wins = windowsOfDay(p)

  for (let i = 0; i < wins.length; i++) {
    if (now >= wins[i][0] && now < wins[i][1]) {
      return {
        peak: true,
        label: '峰价',
        reason: 'workday',
        until: wins[i][1],
        remainMs: wins[i][1] - now
      }
    }
  }

  let reason = 'break'
  if (p.weekday === 0 || p.weekday === 6) reason = 'weekend'
  else if (isHoliday(p.year, p.month, p.day)) reason = 'holiday'

  const next = nextPeakStart(now, p)
  return {
    peak: false,
    label: '谷价',
    reason: reason,
    until: next,
    remainMs: next ? next - now : 0
  }
}

// 剩余时长 → 「1 小时 20 分」「23 分」「不到 1 分」
export function formatRemain(ms) {
  if (!ms || ms <= 0) return ''
  const totalMin = Math.floor(ms / 60000)
  if (totalMin < 1) return '不到 1 分'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return m + ' 分'
  return m ? h + ' 小时 ' + m + ' 分' : h + ' 小时'
}

// 时段原因 → 人话（显示在设置页那行小字里）
export function reasonText(period) {
  if (!period) return ''
  if (period.reason === 'weekend') return '周末全天空闲'
  if (period.reason === 'holiday') return '法定节假日全天空闲'
  if (period.reason === 'workday') return '工作日高峰'
  return '工作日非高峰时段'
}

// 一句话总结，给设置页/首页共用
export function describePeriod(ts) {
  const p = billingPeriod(ts)
  const remain = formatRemain(p.remainMs)
  let detail = ''
  if (p.peak) detail = remain ? '距转谷价 ' + remain : ''
  else detail = remain ? '距转峰价 ' + remain : '近期无高峰'
  return {
    peak: p.peak,
    label: p.label,
    reason: p.reason,
    reasonText: reasonText(p),
    remainMs: p.remainMs,
    until: p.until,
    detail: detail
  }
}

// ---- 时钟偏差 ----
// 设备时钟可能没同步（NTP 不一定通），而峰谷判定完全依赖"现在几点"。
// 余额接口的响应头里有 Date，用它可以算出设备时钟偏差，之后统一用 nowMs()。
let _skew = 0

export function setTimeSkew(ms) {
  const n = Number(ms)
  _skew = isFinite(n) ? n : 0
}

export function getTimeSkew() {
  return _skew
}

export function nowMs() {
  return Date.now() + _skew
}
