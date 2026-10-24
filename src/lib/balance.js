// 余额的归一化与展示文案（纯函数）
//
// 官方返回（GET /user/balance）：
//   { "is_available": true,
//     "balance_infos": [{ "currency": "CNY", "total_balance": "110.00",
//                         "granted_balance": "10.00", "topped_up_balance": "100.00" }] }
// 金额是**字符串**且固定两位小数，别直接当数字做字符串拼接。

export const LOW_BALANCE = 5
export const CRITICAL_BALANCE = 1

function num(v) {
  const n = parseFloat(v)
  return isFinite(n) ? n : 0
}

// 落到本地的缓存结构（跨重启保留，断网时也能显示上次的值）
export function normalizeBalance(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  return {
    available: s.available === true,
    currency: String(s.currency || 'CNY'),
    total: num(s.total),
    granted: num(s.granted),
    toppedUp: num(s.toppedUp),
    at: Number(s.at) || 0,
    skew: Number(s.skew) || 0
  }
}

export function currencySymbol(currency) {
  const c = String(currency || 'CNY').toUpperCase()
  if (c === 'USD') return '$'
  return '¥'
}

// 12.3 → ¥12.30；金额固定两位，避免「¥12.3」这种半截显示
export function moneyText(amount, currency) {
  const n = Number(amount)
  if (!isFinite(n)) return currencySymbol(currency) + '--'
  return currencySymbol(currency) + n.toFixed(2)
}

export function balanceLevel(amount, available) {
  if (available === false) return 'empty'
  const n = Number(amount)
  if (!isFinite(n) || n <= 0) return 'empty'
  if (n < CRITICAL_BALANCE) return 'critical'
  if (n < LOW_BALANCE) return 'low'
  return 'ok'
}

// 顶栏芯片文案：余额 + 当前时段（一个字符，小屏上比「峰价/谷价」省地方）
export function balanceChipText(balance, period) {
  const mark = period ? (period.peak ? '峰' : '谷') : ''
  if (!balance || !balance.at) return mark ? '余额·' + mark : '余额'
  const money = moneyText(balance.total, balance.currency)
  return mark ? money + '·' + mark : money
}

// 设置页那行的文字：余额 + 可用状态
export function balanceDetailText(balance) {
  if (!balance || !balance.at) return '未查询'
  if (balance.available === false) return moneyText(balance.total, balance.currency) + '（余额不足）'
  return moneyText(balance.total, balance.currency)
}

// 充值 / 赠送拆分
export function balanceSplitText(balance) {
  if (!balance || !balance.at) return ''
  return '充值 ' + moneyText(balance.toppedUp, balance.currency) +
    ' · 赠送 ' + moneyText(balance.granted, balance.currency)
}

// 缓存时间 → 「3 分钟前」/「10-24 18:20」
export function updatedAgo(at, now) {
  if (!at) return ''
  const diff = Math.max(0, (now || Date.now()) - at)
  if (diff < 60000) return '刚刚更新'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前更新'
  const d = new Date(at)
  const p = (n) => (n < 10 ? '0' : '') + n
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ' 更新'
}
