// 高德地图 Web 服务（纯函数，零平台依赖）
//
// 为什么选高德而不是腾讯：两家都是「明文 Key 拼 URL + 一次请求出 JSON + 个人开发者
// 每日刷新配额」，但高德多一项「天气查询」—— 词典笔这种设备天气是高频刚需，
// 少接一个数据源就少一套 Key 和一套错误处理。
//
// 真机/实测事实（2026-10-30 用真 Key 验过）：
//  - 必须是「Web服务」类型的 Key（不是「Web端(JS API)」），直接拼 query，**不要 Bearer**。
//  - 成功 = status:"1" + infocode:"10000"；失败 = status:"0" + infocode（见 CODES）。
//  - **所有数值字段都是字符串**（count:"100"、temperature:"13"），别当 number 算。
//  - 地点搜索/周边/详情这类是「按次扣每日配额」的大头（个人开发者每天只有几百次），
//    超了返回 10003。天气、逆地理配额大得多。所以 UI 上要避免每次输入都发请求。
//  - location 格式一律 `经度,纬度`（lng 在前），跟"纬度在前"的直觉相反。

export const AMAP_BASE = 'https://restapi.amap.com/v3'

// 常用 infocode → 人话。
// 只收词典笔真会遇到的：Key 类、配额类、参数类。其余走兜底文案。
export const AMAP_CODES = {
  '10000': '成功',
  '10001': 'Key 无效或已过期，请到控制台确认',
  '10002': '这个 Key 没有开通该服务（要去控制台勾选 Web服务）',
  '10003': '今日配额已用完，明天 0 点恢复（个人开发者额度较小）',
  '10004': '请求太频繁，稍等一下再试',
  '10005': 'IP 白名单限制，请在控制台放行本机 IP',
  '10006': '域名白名单限制，Web服务 Key 不需要填域名',
  '10007': '数字签名校验失败（本应用不用签名方式）',
  '10009': 'Key 与平台不匹配：需要用「Web服务」类型的 Key',
  '10012': '该 Key 权限不足，请在控制台勾选 Web服务',
  '10013': 'Key 已被回收，请重新申请',
  '10021': '并发超限，稍后再试',
  '10029': 'Key 校验失败，请重新复制',
  '20000': '请求参数不合法',
  '20001': '缺少必填参数',
  '20003': '服务端未知错误，稍后再试',
  '20800': '起点或终点不在中国境内',
  '20801': '起点/终点附近找不到道路',
  '20802': '路线计算失败，换个起终点试试'
}

export function amapErrorText(infocode, info) {
  const code = String(infocode || '')
  if (AMAP_CODES[code]) return AMAP_CODES[code]
  const raw = String(info || '').trim()
  if (raw) return raw + '（' + (code || '?') + '）'
  return '请求失败（' + (code || '未知') + '）'
}

// Key 形如 32 位十六进制。不做强校验（高德可能改长度），只挡明显没填的
// 参数直接收 key 字符串（不挂在 settings 上）：地图是「设备能力」，
// 不属于某个档案 —— 切人设/切模式不该让用户重新填一遍 Key。
export function amapReady(key) {
  const k = String(key || '').trim()
  return k.length >= 16
}

export function amapKeyOf(key) {
  return String(key || '').trim()
}

function q(v) {
  return encodeURIComponent(String(v == null ? '' : v))
}

// 拼 URL 的统一出口：只拼有值的参数，避免 `city=&page=` 这种空参
function url(path, params) {
  const parts = []
  const keys = Object.keys(params)
  for (let i = 0; i < keys.length; i++) {
    const v = params[keys[i]]
    if (v === undefined || v === null || v === '') continue
    parts.push(keys[i] + '=' + q(v))
  }
  return AMAP_BASE + path + '?' + parts.join('&')
}

// ---------- 各接口的 URL 构造 ----------

// 关键词搜索：最常用。city 可空（全国搜）
export function placeSearchUrl(opts) {
  const o = opts || {}
  return url('/place/text', {
    key: o.key,
    keywords: o.keywords,
    city: o.city,
    citylimit: o.cityLimit ? 'true' : '',
    offset: clampInt(o.offset, 1, 25, 10),
    page: clampInt(o.page, 1, 100, 1),
    extensions: 'base'
  })
}

// 周边搜索：要有中心点坐标（lng,lat）
export function placeAroundUrl(opts) {
  const o = opts || {}
  return url('/place/around', {
    key: o.key,
    location: o.location,
    keywords: o.keywords,
    radius: clampInt(o.radius, 1, 50000, 3000),
    offset: clampInt(o.offset, 1, 25, 10),
    page: clampInt(o.page, 1, 100, 1),
    extensions: 'base'
  })
}

// 天气：city 传 adcode（如 110000）或中文城市名都行。
// forecast=true 拿 4 天预报（extensions=all），否则拿实时（extensions=base）
export function weatherUrl(opts) {
  const o = opts || {}
  return url('/weather/weatherInfo', {
    key: o.key,
    city: o.city,
    extensions: o.forecast ? 'all' : 'base'
  })
}

// IP 定位：「今天天气怎么样」没给城市时的兜底，拿到当前城市名再查天气。
// 只用于这个场景 —— 设备走宽带出口，定位精度就是城市级，别拿它当 GPS
export function ipUrl(opts) {
  const o = opts || {}
  return url('/ip', { key: o.key })
}

// 地理编码：地址 → 坐标
export function geocodeUrl(opts) {
  const o = opts || {}
  return url('/geocode/geo', { key: o.key, address: o.address, city: o.city })
}

// 逆地理编码：坐标 → 地址
export function regeoUrl(opts) {
  const o = opts || {}
  return url('/geocode/regeo', { key: o.key, location: o.location })
}

// 驾车路径规划
export function drivingUrl(opts) {
  const o = opts || {}
  return url('/direction/driving', {
    key: o.key,
    origin: o.origin,
    destination: o.destination,
    extensions: 'base',
    strategy: clampInt(o.strategy, 0, 10, 0)
  })
}

function clampInt(v, min, max, dft) {
  let n = parseInt(v, 10)
  if (!isFinite(n)) n = dft
  if (n < min) n = min
  if (n > max) n = max
  return n
}

// ---------- 解析 ----------

// 统一入口：把 curl 拿回来的 body 文本收敛成 {ok, obj, error}
// 高德的错误是「HTTP 200 + status:"0"」，所以不能只看状态码
export function parseAmap(text) {
  const raw = String(text == null ? '' : text).trim()
  if (!raw) return { ok: false, obj: null, error: '服务器没有返回内容' }
  let obj = null
  try {
    obj = JSON.parse(raw)
  } catch (e) {
    // 配额或网关错误偶尔回 HTML
    if (/^</.test(raw)) return { ok: false, obj: null, error: '返回的不是 JSON（可能是网关拦截）' }
    return { ok: false, obj: null, error: '返回内容无法解析' }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, obj: null, error: '返回结构异常' }
  if (String(obj.status) !== '1') {
    return { ok: false, obj: obj, error: amapErrorText(obj.infocode, obj.info) }
  }
  return { ok: true, obj: obj, error: '' }
}

// POI 列表 → 统一结构。字段全是字符串，这里统一转好，页面不再操心
export function poiList(obj) {
  const src = (obj && Array.isArray(obj.pois)) ? obj.pois : []
  const out = []
  for (let i = 0; i < src.length; i++) {
    const p = src[i]
    if (!p || !p.name) continue
    const loc = String(p.location || '')
    const xy = loc ? loc.split(',') : []
    out.push({
      id: String(p.id || ''),
      name: String(p.name || ''),
      address: String(p.address || ''),
      // 高德的 type 形如 "风景名胜;风景名胜;国家级景点"，取最后一级最像人话
      type: shortType(p.type),
      tel: String(p.tel || ''),
      city: String(p.cityname || ''),
      district: String(p.adname || ''),
      lng: xy.length === 2 ? xy[0] : '',
      lat: xy.length === 2 ? xy[1] : '',
      // 只有周边搜索才有
      distance: String(p.distance || '')
    })
  }
  return out
}

function shortType(t) {
  const s = String(t || '')
  if (!s) return ''
  const parts = s.split(';')
  return parts[parts.length - 1] || s
}

// 实时天气 → 统一结构
export function weatherNow(obj) {
  const lives = (obj && Array.isArray(obj.lives)) ? obj.lives : []
  if (!lives.length) return null
  const w = lives[0] || {}
  return {
    province: String(w.province || ''),
    city: String(w.city || ''),
    adcode: String(w.adcode || ''),
    weather: String(w.weather || ''),
    temperature: String(w.temperature || ''),
    windDirection: String(w.winddirection || ''),
    windPower: String(w.windpower || ''),
    humidity: String(w.humidity || ''),
    reportTime: String(w.reporttime || '')
  }
}

// 预报 → 每天一条
export function weatherForecast(obj) {
  const fs = (obj && Array.isArray(obj.forecasts)) ? obj.forecasts : []
  if (!fs.length) return []
  const casts = Array.isArray(fs[0].casts) ? fs[0].casts : []
  const out = []
  for (let i = 0; i < casts.length; i++) {
    const c = casts[i] || {}
    out.push({
      date: String(c.date || ''),
      dayWeather: String(c.dayweather || ''),
      nightWeather: String(c.nightweather || ''),
      dayTemp: String(c.daytemp || ''),
      nightTemp: String(c.nighttemp || ''),
      dayWind: String(c.daywind || ''),
      dayPower: String(c.daypower || '')
    })
  }
  return out
}

// 地理编码 → 第一条
export function geocodeFirst(obj) {
  const list = (obj && Array.isArray(obj.geocodes)) ? obj.geocodes : []
  if (!list.length) return null
  const g = list[0] || {}
  const loc = String(g.location || '')
  const xy = loc ? loc.split(',') : []
  return {
    address: String(g.formatted_address || ''),
    province: String(g.province || ''),
    city: String(g.city || ''),
    district: String(g.district || ''),
    level: String(g.level || ''),
    lng: xy.length === 2 ? xy[0] : '',
    lat: xy.length === 2 ? xy[1] : ''
  }
}

// IP 定位结果 → 城市名。高德在查不到时会返回 city 为 [] 或空串，这时返回 null，
// 由调用方提示用户直接说城市名，不要拿一个空城市去查天气（会返回空 lives）
export function ipCity(obj) {
  const city = obj && typeof obj.city === 'string' ? obj.city.trim() : ''
  const prov = obj && typeof obj.province === 'string' ? obj.province.trim() : ''
  const adcode = obj && obj.adcode ? String(obj.adcode).trim() : ''
  if (city && city.length >= 2) return { city: city, adcode: adcode, province: prov }
  if (prov && prov.length >= 2) return { city: prov, adcode: adcode, province: prov }
  return null
}

// 逆地理 → 地址串
export function regeoText(obj) {
  const r = (obj && obj.regeocode) ? obj.regeocode : null
  if (!r) return null
  const ac = r.addressComponent || {}
  return {
    address: String(r.formatted_address || ''),
    province: String(ac.province || ''),
    city: typeof ac.city === 'string' ? ac.city : String(ac.city || ''),
    district: String(ac.district || ''),
    township: String(ac.township || '')
  }
}

// 驾车路线 → 统一结构（只留前三步，屏幕放不下更多）
export function routeBrief(obj, maxSteps) {
  const route = (obj && obj.route) ? obj.route : null
  const paths = (route && Array.isArray(route.paths)) ? route.paths : []
  if (!paths.length) return null
  const p = paths[0] || {}
  const steps = Array.isArray(p.steps) ? p.steps : []
  const limit = maxSteps || 3
  const out = []
  for (let i = 0; i < steps.length && out.length < limit; i++) {
    const s = steps[i] || {}
    out.push({
      instruction: String(s.instruction || ''),
      road: String(s.road || ''),
      distance: String(s.distance || '')
    })
  }
  return {
    distance: String(p.distance || ''),
    duration: String(p.duration || ''),
    steps: out,
    stepCount: steps.length
  }
}

// ---------- 展示用格式化 ----------

// 米 → 人话（800 → 800m，1500 → 1.5km）
export function fmtDistance(m) {
  const n = parseFloat(m)
  if (!isFinite(n) || n <= 0) return ''
  if (n < 1000) return Math.round(n) + 'm'
  return (Math.round(n / 100) / 10) + 'km'
}

// 秒 → 人话（1300 → 21分钟，4500 → 1小时15分钟）
export function fmtDuration(sec) {
  const n = parseInt(sec, 10)
  if (!isFinite(n) || n <= 0) return ''
  const min = Math.round(n / 60)
  if (min < 60) return min + '分钟'
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? (h + '小时' + m + '分钟') : (h + '小时')
}

// 一条 POI 的副标题：有距离优先显示距离，其次地址
export function poiSubtitle(p) {
  const o = p || {}
  const d = fmtDistance(o.distance)
  const addr = String(o.address || '')
  if (d && addr) return d + ' · ' + addr
  if (d) return d
  if (addr) return addr
  return [o.district, o.type].filter(Boolean).join(' · ')
}

// 天气一句话（顶栏/卡片标题用）
export function weatherLine(w) {
  if (!w) return ''
  const parts = []
  if (w.city) parts.push(w.city)
  if (w.weather) parts.push(w.weather)
  if (w.temperature) parts.push(w.temperature + '°C')
  return parts.join(' ')
}

// 天气详情行（列表用）：温度 / 风 / 湿度
export function weatherRows(w) {
  if (!w) return []
  const rows = []
  if (w.weather || w.temperature) {
    rows.push({ label: '天气', value: [w.weather, w.temperature ? w.temperature + '°C' : ''].filter(Boolean).join(' ') })
  }
  if (w.windDirection || w.windPower) {
    rows.push({ label: '风力', value: [w.windDirection, w.windPower ? w.windPower + '级' : ''].filter(Boolean).join(' ') })
  }
  if (w.humidity) rows.push({ label: '湿度', value: w.humidity + '%' })
  if (w.reportTime) rows.push({ label: '更新', value: w.reportTime })
  return rows
}
