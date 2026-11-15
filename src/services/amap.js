// 高德地图的取用编排（Key 管理 + 网络 + 解析）
//
// 分层：URL 构造与解析全在 lib/amap.js（纯函数、可 Node 单测），
// 这里只负责「拿到 Key → 发请求 → 把结果收敛成统一形状」。
//
// Key 单独存一个文件（store.js 的 amap.json），不挂 settings：
// 地图是设备能力，切人设/切模式不该让它失效。

import { fetchJsonGet } from './api.js'
import { loadAmapCfg, saveAmapCfg } from './store.js'
import { logLine } from '../lib/logfile.js'
import {
  amapReady, placeSearchUrl, placeAroundUrl, weatherUrl, geocodeUrl, regeoUrl, drivingUrl, ipUrl,
  parseAmap, poiList, weatherNow, weatherForecast, geocodeFirst, regeoText, routeBrief, ipCity,
  fmtDistance, fmtDuration
} from '../lib/amap.js'

// 会话级缓存：页面不该每敲一个字都去读盘
let _cfg = null

export async function amapCfg() {
  if (_cfg === null) _cfg = await loadAmapCfg()
  return _cfg
}

export async function amapKey() {
  const c = await amapCfg()
  return c.key
}

// 设置页保存 Key：先落内存再落盘，落盘失败也不至于当场用不了
export async function setAmapKey(key) {
  const c = await amapCfg()
  const s = String(key == null ? '' : key).trim()
  const auto = c.auto !== false
  const ok = saveAmapCfg({ key: s, auto: auto })
  _cfg = { key: s, auto: auto }
  return { key: s, saved: ok }
}

// 「聊天中自动识别」开关：关掉后只有明确说「使用高德地图」才查
export async function setAmapAuto(on) {
  const c = await amapCfg()
  const auto = !!on
  const ok = saveAmapCfg({ key: c.key, auto: auto })
  _cfg = { key: c.key, auto: auto }
  return { auto: auto, saved: ok }
}

// 同步读开关。没读盘前按「开」算 —— 新用户装上就该能用
export function amapAutoOn() {
  return _cfg ? _cfg.auto !== false : true
}

// 同步取（页面已 ensure 过时用，避免 async 传染）
export function amapKeyCached() {
  return (_cfg && _cfg.key) || ''
}

// 同步判「配没配」：给界面决定显示/隐藏入口用。
// 没 ensure 过时返回 false —— 宁可少显示一个入口，也别让用户点进去报错
export function amapConfigured() {
  return amapReady(amapKeyCached())
}

// 只判断「有没有可用的 Key」。开关的开关由调用方自己看 amapAutoOn()：
// 强制触发（「使用高德地图」）在开关关掉时仍然要能用
export async function ensureAmap() {
  const c = await amapCfg()
  return amapReady(c.key)
}

// 统一请求：把「超时 / HTTP 错 / 业务错」收敛成 {ok, data, error}
async function call(url, opts) {
  const r = await fetchJsonGet(url, opts)
  if (!r.ok) {
    const msg = r.error === 'TIMEOUT' ? '请求超时，检查一下网络' : '请求失败（' + r.error + '）'
    return { ok: false, data: null, error: msg }
  }
  if (r.status !== 200) {
    return { ok: false, data: null, error: '服务返回 HTTP ' + r.status + '，稍后再试' }
  }
  const p = parseAmap(r.body)
  if (!p.ok) return { ok: false, data: null, error: p.error }
  return { ok: true, data: p.obj, error: '' }
}

const NO_KEY = '还没配置高德 Key（设置 → 地图与天气）'

// 关键词搜地点
export async function searchPlace(opts) {
  const o = opts || {}
  const key = await amapKey()
  if (!amapReady(key)) return { ok: false, items: [], error: NO_KEY }
  if (!String(o.keywords || '').trim()) return { ok: false, items: [], error: '请输入要搜的地点' }
  const r = await call(placeSearchUrl({
    key: key, keywords: o.keywords, city: o.city, offset: o.offset, page: o.page
  }), { timeoutMs: o.timeoutMs || 8000 })
  if (!r.ok) return { ok: false, items: [], error: r.error }
  const items = poiList(r.data)
  if (!items.length) return { ok: false, items: [], error: '没搜到这个地方，换个说法试试' }
  return { ok: true, items: items, error: '' }
}

// 周边搜（要先有坐标：'lng,lat'）
export async function searchAround(opts) {
  const o = opts || {}
  const key = await amapKey()
  if (!amapReady(key)) return { ok: false, items: [], error: NO_KEY }
  if (!String(o.location || '').trim()) return { ok: false, items: [], error: '缺少中心点坐标' }
  const r = await call(placeAroundUrl({
    key: key, location: o.location, keywords: o.keywords, radius: o.radius, offset: o.offset
  }), { timeoutMs: o.timeoutMs || 8000 })
  if (!r.ok) return { ok: false, items: [], error: r.error }
  return { ok: true, items: poiList(r.data), error: '' }
}

// 天气：forecast=true 拿 4 天预报，否则拿实时
export async function weather(opts) {
  const o = opts || {}
  const key = await amapKey()
  if (!amapReady(key)) return { ok: false, now: null, forecast: [], error: NO_KEY }
  const city = String(o.city || '').trim()
  if (!city) return { ok: false, now: null, forecast: [], error: '请输入城市名' }
  const r = await call(weatherUrl({ key: key, city: city, forecast: !!o.forecast }), { timeoutMs: o.timeoutMs || 8000 })
  if (!r.ok) return { ok: false, now: null, forecast: [], error: r.error }
  if (o.forecast) {
    const list = weatherForecast(r.data)
    if (!list.length) return { ok: false, now: null, forecast: [], error: '没拿到预报数据' }
    return { ok: true, now: null, forecast: list, error: '' }
  }
  const now = weatherNow(r.data)
  if (!now) return { ok: false, now: null, forecast: [], error: '没拿到天气数据' }
  return { ok: true, now: now, forecast: [], error: '' }
}

// 地址 → 坐标
export async function geocode(opts) {
  const o = opts || {}
  const key = await amapKey()
  if (!amapReady(key)) return { ok: false, item: null, error: NO_KEY }
  const r = await call(geocodeUrl({ key: key, address: o.address, city: o.city }), { timeoutMs: o.timeoutMs || 8000 })
  if (!r.ok) return { ok: false, item: null, error: r.error }
  const item = geocodeFirst(r.data)
  if (!item) return { ok: false, item: null, error: '这个地址定位不到' }
  return { ok: true, item: item, error: '' }
}

// 坐标 → 地址
export async function regeo(opts) {
  const o = opts || {}
  const key = await amapKey()
  if (!amapReady(key)) return { ok: false, item: null, error: NO_KEY }
  const r = await call(regeoUrl({ key: key, location: o.location }), { timeoutMs: o.timeoutMs || 8000 })
  if (!r.ok) return { ok: false, item: null, error: r.error }
  const item = regeoText(r.data)
  if (!item) return { ok: false, item: null, error: '这个坐标找不到对应地址' }
  return { ok: true, item: item, error: '' }
}

// 驾车路线
export async function driving(opts) {
  const o = opts || {}
  const key = await amapKey()
  if (!amapReady(key)) return { ok: false, route: null, error: NO_KEY }
  if (!o.origin || !o.destination) return { ok: false, route: null, error: '需要起点和终点' }
  const r = await call(drivingUrl({
    key: key, origin: o.origin, destination: o.destination, strategy: o.strategy
  }), { timeoutMs: o.timeoutMs || 10000 })
  if (!r.ok) return { ok: false, route: null, error: r.error }
  const route = routeBrief(r.data, o.maxSteps || 3)
  if (!route) return { ok: false, route: null, error: '没算出路来，换个起终点试试' }
  return { ok: true, route: route, error: '' }
}

// 设置页「测试 Key」：用一个最省配额的天气查询验一下。
// 为什么不拿地点搜索试：那个配额最小，用户可能一天只有几百次，
// 一个测试按钮不该吃掉一次搜索配额（天气配额大得多）。
export async function testAmapKey(key) {
  const k = String(key == null ? '' : key).trim()
  if (!amapReady(k)) return { ok: false, error: 'Key 太短，检查一下有没有复制全' }
  const u = weatherUrl({ key: k, city: '110000' })
  const r = await fetchJsonGet(u, { timeoutMs: 8000 })
  logLine('I', 'amap test status=' + r.status + ' ok=' + r.ok + ' err=' + r.error
    + ' len=' + String(r.body || '').length + ' head=' + String(r.body || '').slice(0, 160))
  if (!r.ok) {
    return { ok: false, error: r.error === 'TIMEOUT' ? '连接超时，检查网络' : '连接失败（' + r.error + '）' }
  }
  if (r.status !== 200) return { ok: false, error: '服务返回 HTTP ' + r.status }
  const p = parseAmap(r.body)
  if (!p.ok) return { ok: false, error: p.error }
  const w = weatherNow(p.obj)
  if (!w) return { ok: false, error: 'Key 能用，但没取到天气数据' }
  return { ok: true, error: '', sample: w }
}

// 诊断用：当前 Key 的掩码，避免整串打到界面上
export function amapKeyMask() {
  const s = (_cfg && _cfg.key) || ''
  if (!s) return ''
  if (s.length <= 8) return s.slice(0, 2) + '****'
  return s.slice(0, 4) + '****' + s.slice(-4)
}

// ---------- 聊天里的意图执行 ----------
//
// 输入是 lib/mapintent.js 认出来的意图，输出统一成 {ok, kind, data, error}。
// data 的具体形状要和 lib/mapintent.js 的 formatMapContext() 对得上。

// 没给城市时的兜底：IP 定位到城市级再查
async function cityByIp() {
  const key = await amapKey()
  if (!amapReady(key)) return { ok: false, city: '', error: NO_KEY }
  const r = await call(ipUrl({ key: key }), { timeoutMs: 6000 })
  if (!r.ok) return { ok: false, city: '', error: r.error }
  const it = ipCity(r.data)
  if (!it) return { ok: false, city: '', error: '不知道你在哪个城市，说个城市名试试（比如"上海天气"）' }
  return { ok: true, city: it.city, error: '' }
}

// 执行一条地图意图。任何失败都收敛成 {ok:false, error:人话}，绝不抛——
// 主流程是"聊天"，地图查不到只能降级，不能把这一轮回答弄挂
export async function runMapIntent(intent) {
  const it = intent || {}
  const kind = it.kind
  if (kind === 'weather') {
    let city = String(it.city || '').trim()
    let cityText = city
    if (!city) {
      const ip = await cityByIp()
      if (!ip.ok) return { ok: false, kind: kind, data: null, error: ip.error }
      city = ip.city
      cityText = city
    }
    const r = await weather({ city: city, forecast: !!it.forecast })
    if (!r.ok) return { ok: false, kind: kind, data: null, error: r.error }
    return { ok: true, kind: kind, error: '', data: { now: r.now, forecast: r.forecast, cityText: cityText } }
  }

  if (kind === 'place') {
    const kw = String(it.keywords || '').trim()
    if (!kw) return { ok: false, kind: kind, data: null, error: '没听出要搜什么地方' }
    const r = await searchPlace({ keywords: kw, city: it.city, offset: 8 })
    if (!r.ok) return { ok: false, kind: kind, data: null, error: r.error }
    return { ok: true, kind: kind, error: '', data: { items: r.items, keyword: kw } }
  }

  if (kind === 'route') {
    const o = String(it.origin || '').trim()
    const d = String(it.destination || '').trim()
    if (!o || !d) return { ok: false, kind: kind, data: null, error: '说清楚从哪到哪，比如"从北京到上海怎么走"' }
    // 地名要先转坐标，driving 只收 'lng,lat'
    const go = await geocode({ address: o })
    if (!go.ok) return { ok: false, kind: kind, data: null, error: '起点「' + o + '」找不到：' + go.error }
    const gd = await geocode({ address: d })
    if (!gd.ok) return { ok: false, kind: kind, data: null, error: '终点「' + d + '」找不到：' + gd.error }
    const r = await driving({
      origin: go.item.lng + ',' + go.item.lat,
      destination: gd.item.lng + ',' + gd.item.lat,
      maxSteps: 5
    })
    if (!r.ok) return { ok: false, kind: kind, data: null, error: r.error }
    return {
      ok: true,
      kind: kind,
      error: '',
      data: {
        route: r.route,
        originText: go.item.address || o,
        destText: gd.item.address || d,
        distanceText: fmtDistance(r.route.distance),
        durationText: fmtDuration(r.route.duration)
      }
    }
  }

  if (kind === 'geocode') {
    const addr = String(it.address || '').trim()
    if (!addr) return { ok: false, kind: kind, data: null, error: '没听出是哪个地址' }
    const r = await geocode({ address: addr })
    if (!r.ok) return { ok: false, kind: kind, data: null, error: r.error }
    return { ok: true, kind: kind, error: '', data: { item: r.item, addressText: addr } }
  }

  if (kind === 'regeo') {
    const loc = String(it.location || '').trim()
    if (!loc) return { ok: false, kind: kind, data: null, error: '没认出坐标' }
    const r = await regeo({ location: loc })
    if (!r.ok) return { ok: false, kind: kind, data: null, error: r.error }
    return { ok: true, kind: kind, error: '', data: { item: r.item, location: loc } }
  }

  return { ok: false, kind: 'none', data: null, error: '没有可执行的地图查询' }
}
