// 高德地图：从一句人话里认出「要不要查地图、查什么」（纯函数，可在 Node 里断言）
//
// 为什么在本地判断：词典笔上没有可靠的 function calling 链路，也不能指望模型
// 自己决定"去调工具"。所以由客户端从原话里认出意图 → 查 → 把真实数据注入上下文，
// 跟 lib/search.js 的联网搜索是同一套路子。
//
// 两档触发：
//   1) 强制——原话里出现「使用高德地图」这类祈使句，必然触发（用户明确要求）
//   2) 自动——认出明确的天气/路线/地点/坐标意图才触发，宁少勿多

export const MAP_KINDS = ['none', 'weather', 'place', 'route', 'geocode', 'regeo']

// ---------- 强制触发 ----------
// 不能简单写成 /高德地图/：「高德地图和百度地图哪个好」是在问我问题，不是让我去查。
// 必须带祈使动词，或者出现在句首被当作"指令前缀"。
const FORCE = [
  /(使用|用|调用|借助|通过|走|查|打开|试试)高德(地图)?/,
  /^\s*高德(地图)?[\s,，:：、]+/
]

// ---------- 意图词 ----------
const WEATHER = /天气|气温|温度|多少度|下雨|降雨|雨伞|冷不冷|热不热|穿什么|空气质量|雾霾|风力|刮风|湿度/
const FORECAST = /明天|后天|未来|一周|几天|这几天|接下来|预报|周末/
const ROUTE = /怎么去|怎么走|怎么到|怎么过去|路线|导航|驾车|开车|多远|多久能到|要多久|几点到/
const AROUND = /附近|周边|旁边|周围/
const PLACE = /哪里有|哪儿有|在哪|位置|地址|怎么找/
const GEO = /经纬度|坐标/
// 坐标串：116.397,39.908（高德要求小数点后不超过 6 位，但这里只负责认出来）
const COORD = /(\d{1,3}\.\d{2,8})\s*[,，]\s*(\d{1,2}\.\d{2,8})/

// 常用城市。只为「从残留文本里认出城市」兜底，认不出就让调用方去问用户
const CITIES = [
  '北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '天津', '重庆', '成都',
  '武汉', '西安', '长沙', '郑州', '济南', '青岛', '沈阳', '大连', '哈尔滨', '长春',
  '石家庄', '太原', '合肥', '福州', '厦门', '南昌', '南宁', '昆明', '贵阳', '兰州',
  '西宁', '银川', '乌鲁木齐', '拉萨', '呼和浩特', '海口', '三亚', '无锡', '宁波', '温州',
  '佛山', '东莞', '珠海', '中山', '惠州', '常州', '徐州', '烟台', '洛阳', '唐山',
  '保定', '香港', '澳门', '台北'
]

// 去掉首尾的助词/标点。中文里「北京的天气」和「北京天气」要归一
function trimEdge(s) {
  let t = String(s == null ? '' : s)
  for (let i = 0; i < 4; i++) {
    const before = t
    t = t.replace(/^[\s,，。.、；;：:！!？?"'“”‘’（）()]+/, '')
    t = t.replace(/[\s,，。.、；;：:！!？?"'“”‘’（）()]+$/, '')
    t = t.replace(/^[的地得了吧呢啊呀哦]+/, '')
    t = t.replace(/[的地得了吧呢啊呀哦]+$/, '')
    if (t === before) break
  }
  return t
}

// 去掉尾部的动作词：「南京开车」→「南京」、「上海要多久」→「上海」
function trimTailAction(s) {
  let t = trimEdge(s)
  const tail = /(开车|驾车|导航|坐车|打车|走|过去|要多久|多远|多久|怎么走|怎么去|怎么到|路线|怎么过去)$/
  for (let i = 0; i < 4; i++) {
    const before = t
    t = trimEdge(t.replace(tail, ''))
    if (t === before) break
  }
  return t
}

// 从一段话里认城市。
// loose=true 才用「抹掉天气词后剩下的汉字」兜底 —— 这个兜底对「北京天气」有效，
// 但对「天安门在哪」会把整句当城市（于是带着一个假城市去搜地点，必然搜不到），
// 所以搜地点时一律走 strict：只认城市表和「XX市/省/区/县」。
export function pickCity(s, loose) {
  const t = String(s == null ? '' : s)
  for (let i = 0; i < CITIES.length; i++) {
    if (t.indexOf(CITIES[i]) >= 0) return CITIES[i]
  }
  const m = /([\u4e00-\u9fa5]{2,6}?)(市|省|区|县)/.exec(t)
  if (m) return trimEdge(m[1])
  if (!loose) return ''
  // 残留兜底：把天气/时间/语气词全抹掉，剩下的 2–6 个汉字大概率就是地名
  const rest = trimEdge(t
    .replace(WEATHER, ' ')
    .replace(FORECAST, ' ')
    .replace(/怎么样|如何|查询|查一下|查下|帮我|请问|告诉我|一下|现在|实时|今天|今日|会|有|的|呢|吗|啊|呀|了|～|~/g, ' '))
  if (!rest || rest.length < 2 || rest.length > 6) return ''
  if (/\s/.test(rest) || !/^[\u4e00-\u9fa5]+$/.test(rest)) return ''
  // 「不错」「很好」这类是评价，不是地名
  if (/不错|很好|真好|不好|一般|舒服|糟糕|最近|这边|那边|家里|外面|室外|室内/.test(rest)) return ''
  return rest
}

// 路线：拆出起点和终点。「去上海怎么走」只有终点，算不出路线，交给调用方提示
export function pickRoute(s) {
  const t = String(s == null ? '' : s)
  let m = /从\s*(.{1,20}?)\s*到\s*(.{1,24}?)\s*(怎么|多远|多久|要多久|路线|开车|驾车|导航|$)/.exec(t)
  if (m) {
    const o = trimTailAction(m[1])
    const d = trimTailAction(m[2])
    if (o && d) return { origin: o, destination: d }
  }
  m = /(.{1,20}?)\s*(?:到|去|至)\s*(.{1,24}?)\s*(?:怎么走|怎么去|怎么到|怎么过去|多远|多久|要多久|路线|导航)/.exec(t)
  if (m) {
    const o = trimTailAction(m[1].replace(/^(从|我现在在|我在|我现在)/, ''))
    const d = trimTailAction(m[2])
    if (o && d) return { origin: o, destination: d }
  }
  m = /(?:去|到)\s*(.{1,20}?)\s*(?:怎么走|怎么去|怎么到|多远|要多久)/.exec(t)
  if (m) {
    const d = trimTailAction(m[1])
    if (d) return { origin: '', destination: d }
  }
  return null
}

// 地点关键词：「附近的咖啡店」→ 咖啡店；「天安门在哪」→ 天安门
export function pickPlace(s) {
  const t = String(s == null ? '' : s)
  let m = /(?:附近|周边|旁边|周围)的?\s*(.{1,20})/.exec(t)
  if (m) return trimEdge(m[1])
  m = /(?:哪里有|哪儿有)\s*(.{1,20})/.exec(t)
  if (m) return trimEdge(m[1])
  m = /(.{1,20}?)\s*在哪/.exec(t)
  if (m) return trimEdge(m[1])
  m = /(?:查一下|查下|搜一下|搜下|找一下|找找|查|搜|找)\s*(.{1,20})/.exec(t)
  if (m) return trimEdge(m[1])
  return trimEdge(t)
}

// 地址：「天安门的经纬度」→ 天安门
export function pickAddress(s) {
  const t = String(s == null ? '' : s).replace(GEO, ' ')
  return trimEdge(t.replace(/的|是|多少|请问|帮我|查一下|查下/g, ' '))
}

// 主入口：返回 {kind, ...}。kind === 'none' 表示这句不用查
export function parseMapIntent(text) {
  const raw = String(text == null ? '' : text).trim()
  const out = {
    kind: 'none',
    forced: false,
    forecast: false,
    city: '',
    keywords: '',
    origin: '',
    destination: '',
    address: '',
    location: '',
    query: ''
  }
  // 太长的不当查询（多半是让我处理一段材料）
  if (!raw || raw.length > 500) return out

  // 1) 剥掉强制触发词，剩下的才是真正的查询内容
  let rest = raw
  let forced = false
  for (let i = 0; i < FORCE.length; i++) {
    if (FORCE[i].test(raw)) {
      forced = true
      rest = trimEdge(raw.replace(FORCE[i], ' '))
      break
    }
  }
  // 「使用高德地图」后面什么都没跟：拿原句当关键词，让地图去搜
  if (forced && !rest) rest = raw
  out.forced = forced

  // 2) 坐标串最先认：它最不含糊
  const cm = COORD.exec(rest)
  if (cm) {
    out.kind = 'regeo'
    out.location = cm[1] + ',' + cm[2]
    out.query = out.location
    return out
  }

  // 3) 路线
  if (ROUTE.test(rest)) {
    const r = pickRoute(rest)
    if (r) {
      out.kind = 'route'
      out.origin = r.origin
      out.destination = r.destination
      out.query = r.origin ? r.origin + ' → ' + r.destination : '到 ' + r.destination
      return out
    }
    // 说了"怎么走"却没给出起终点：强制触发时才勉强当地点搜，否则放弃
    if (!forced) return out
  }

  // 4) 天气
  if (WEATHER.test(rest)) {
    // 「最近天气不错」是在感慨，不是要数据。带明确问法/时间范围时才查
    const evalWord = /不错|很好|真好|不好|一般|舒服|糟糕|变冷|变热|转凉|好热|好冷/.test(rest)
    const asking = /怎么样|如何|多少度|冷不冷|热不热|穿什么|带伞|吗|呢|？|\?/.test(rest)
    if (forced || !evalWord || asking || FORECAST.test(rest)) {
      out.kind = 'weather'
      out.city = pickCity(rest, true)
      out.forecast = FORECAST.test(rest)
      out.query = (out.city || '本地') + (out.forecast ? ' 天气预报' : ' 天气')
      return out
    }
    return out
  }

  // 5) 经纬度
  if (GEO.test(rest)) {
    out.kind = 'geocode'
    out.address = pickAddress(rest)
    out.query = out.address || rest
    return out
  }

  // 6) 地点：只有明确的"找地方"信号才自动触发，
  //    否则「北京」这种孤零零的词会把每句话都送去搜地点
  if (AROUND.test(rest) || PLACE.test(rest)) {
    const kw = pickPlace(rest)
    out.kind = 'place'
    out.keywords = kw || rest
    out.city = pickCity(rest, false)
    out.query = out.keywords
    return out
  }

  // 7) 强制触发但认不出意图：整句当关键词搜（先剥掉「查一下」这类动词）
  if (forced) {
    out.kind = 'place'
    out.keywords = pickPlace(rest) || rest
    out.city = pickCity(rest, false)
    out.query = out.keywords
    return out
  }

  return out
}

// ---------- 结果 → 给模型看的上下文 ----------

// 注入给模型的 system 块。要求模型"只用这份真实数据回答"，避免它凭记忆编天气。
// opts.brief = true 时不带"回答要求"那段 —— 给界面展开看数据用
export function formatMapContext(kind, data, opts) {
  const brief = !!(opts && opts.brief)
  const lines = []
  const d = data || {}
  if (kind === 'weather') {
    if (d.forecast && d.forecast.length) {
      lines.push('【高德地图 · 天气预报】以下是刚查到的真实预报数据：')
      for (let i = 0; i < d.forecast.length; i++) {
        const f = d.forecast[i]
        lines.push(f.date + ' 白天' + f.dayWeather + '，夜间' + f.nightWeather
          + '，' + f.nightTemp + '~' + f.dayTemp + '°C，' + f.dayWind + f.dayPower + '级')
      }
    } else if (d.now) {
      const w = d.now
      lines.push('【高德地图 · 实时天气】以下是刚查到的真实数据：')
      lines.push((w.city || w.province || '') + '：' + w.weather + '，' + w.temperature + '°C'
        + (w.windDirection ? '，' + w.windDirection + w.windPower + '级' : '')
        + (w.humidity ? '，湿度' + w.humidity + '%' : '')
        + (w.reportTime ? '（更新于 ' + w.reportTime + '）' : ''))
    }
  } else if (kind === 'place') {
    const items = d.items || []
    lines.push('【高德地图 · 地点搜索】以下是刚搜到的真实结果，共 ' + items.length + ' 条：')
    for (let i = 0; i < items.length && i < 8; i++) {
      const p = items[i]
      const meta = []
      if (p.district) meta.push(p.district)
      if (p.address) meta.push(p.address)
      if (p.tel) meta.push('电话 ' + p.tel)
      if (p.lng && p.lat) meta.push(p.lng + ',' + p.lat)
      lines.push((i + 1) + '. ' + p.name + (p.type ? '（' + p.type + '）' : '')
        + (meta.length ? '\n   ' + meta.join(' · ') : ''))
    }
  } else if (kind === 'route') {
    const r = d.route || {}
    lines.push('【高德地图 · 驾车路线】以下是刚算出的真实结果：')
    if (d.originText) lines.push('起点：' + d.originText)
    if (d.destText) lines.push('终点：' + d.destText)
    lines.push('全程 ' + d.distanceText + '，预计 ' + d.durationText)
    for (let i = 0; i < (r.steps || []).length; i++) {
      const s = r.steps[i]
      lines.push((i + 1) + '. ' + s.instruction + (s.road ? '（' + s.road + '）' : ''))
    }
    if (r.stepCount > (r.steps || []).length) {
      lines.push('（共 ' + r.stepCount + ' 段，这里只列前 ' + (r.steps || []).length + ' 段）')
    }
  } else if (kind === 'geocode') {
    const g = d.item || {}
    lines.push('【高德地图 · 地理编码】以下是刚查到的真实结果：')
    lines.push(g.address + '（' + [g.province, g.city, g.district].filter(Boolean).join('') + '）')
    lines.push('坐标：' + g.lng + ',' + g.lat + '（级别 ' + g.level + '）')
  } else if (kind === 'regeo') {
    const r = d.item || {}
    lines.push('【高德地图 · 逆地理编码】坐标 ' + (d.location || '') + ' 对应：')
    lines.push(r.address || [r.province, r.city, r.district, r.township].filter(Boolean).join(''))
  }

  if (lines.length <= 1) return ''
  if (brief) return lines.join('\n')
  lines.push('')
  lines.push('回答要求：直接依据上面这份数据回答，不要凭记忆补充或编造；')
  lines.push('数据里没有的信息就直说"没有查到"，不要猜。地名、温度、距离、时间必须与数据一致。')
  return lines.join('\n')
}

// 界面上那行小标签：让用户知道这次确实查过高德，而不是模型瞎编
export function mapChipLabel(kind, data) {
  const d = data || {}
  if (kind === 'weather') {
    if (d.forecast && d.forecast.length) return '高德 · ' + (d.cityText || '') + ' 预报 ' + d.forecast.length + ' 天'
    if (d.now) return '高德 · ' + (d.now.city || d.cityText || '') + ' ' + d.now.weather + ' ' + d.now.temperature + '°C'
    return '高德 · 天气'
  }
  if (kind === 'place') return '高德 · 地点 ' + ((d.items || []).length) + ' 条'
  if (kind === 'route') return '高德 · ' + (d.distanceText || '') + ' ' + (d.durationText || '')
  if (kind === 'geocode') return '高德 · 坐标'
  if (kind === 'regeo') return '高德 · 地址'
  return '高德地图'
}
