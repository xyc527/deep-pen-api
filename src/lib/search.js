// 联网搜索：意图判断、查询构建、结果渲染（纯函数，可在 Node 里断言）
//
// 官方 Search 接口（POST /v1/tools/search）是**被动检索**：给 query 就返回结果，
// 没有任何"你自己判断要不要搜"的参数。ori_question 只是帮它理解意图，
// 不传该搜也照搜。所以"自动判断"这件事只能在客户端做 —— 这里就是那层判断。
//
// 判断策略：宁保守不激进。
//   - 'off'    完全不搜
//   - 'auto'   只对"明显有时效/外部信息需求"的问题搜
//   - 'always' 每问必搜
// 保守的理由：一次搜索 0.005 元是小事，1–3 秒延迟是大事，而这个固件在等网络时
// 屏幕上什么都不会动，用户很容易以为卡死了。

export const SEARCH_MODES = ['off', 'auto', 'always']

export function normalizeSearchMode(v) {
  const s = String(v == null ? '' : v)
  if (s === 'always') return 'always'
  if (s === 'auto') return 'auto'
  return 'off'
}

// 明确的"要查外部资料"信号
const WANT = [
  /\b(search|google|look ?up|browse)\b/i,
  /搜索|搜一下|搜下|搜搜|查一下|查一查|查查|上网|联网|网上查|帮我查|帮我找|找一下资料/,
  /最新|最近|近期|实时|今天的?|今日|昨日|昨天|本周|这周|本月|这个月|今年|去年|刚才|刚刚/,
  /新闻|资讯|动态|发布会|预告|路线图|价格|报价|售价|股价|汇率|天气|气温|比分|赛程|票房|油价|金价|房价|利率|汇率|排名|榜单|政策|法规|通知|公告/,
  /多少钱|什么价|几比几|谁赢|涨了|跌了|降了|上市了吗/
]

// 明确的"不需要外部信息"信号：凡是命中就不再搜
const DONT = [
  // 寒暄、指令式的接话
  /^(你好|您好|hi|hello|嗨|在吗|谢谢|多谢|好的|好吧|ok|嗯+|继续|接着说|接着|再来|重试|停|停止|算了|不用了)[\s!！?？。.~]*$/i,
  // 让我对已有文本做处理
  /^(请|帮我)?(翻译|改写|润色|续写|缩写|扩写|总结|概括|归纳|提炼|校对|订正)/,
  // 让我写代码 / 命令 / 正则
  /^(请|帮我)?(写|实现|生成|给出|补全|重构|优化)(一|个|段|份|下|一下)?[^，。？?]{0,20}(代码|函数|脚本|正则|sql|命令|接口|组件)/i,
  // 纯算式
  /^[\d\s+\-*/().=%<>!&|^,]+$/
]

export function shouldSearch(text, mode) {
  const m = normalizeSearchMode(mode)
  if (m === 'off') return false
  if (m === 'always') return true

  const t = String(text == null ? '' : text).trim()
  // 太短的多半是"嗯""继续"，太长的是让我处理一段材料
  if (t.length < 4 || t.length > 400) return false
  for (let i = 0; i < DONT.length; i++) if (DONT[i].test(t)) return false
  for (let i = 0; i < WANT.length; i++) if (WANT[i].test(t)) return true

  // 带年份的提问通常是"某年发生了什么 / 现在进展如何"
  if (/(19|20)\d{2}\s*年?/.test(t)) return true
  // 贴了链接，八成本意就是让我看那个页面
  if (/https?:\/\/|www\./i.test(t)) return true
  return false
}

// 从用户原话里压出一个 query。
// 官方限制 1–128 个 Unicode 字符，多于这个长度直接截断即可 ——
// 搜索引擎对长句的容忍度不高，截前 128 字反而更准。
export function buildSearchQuery(text) {
  let s = String(text == null ? '' : text)
  // markdown 结构对检索没用，反而会污染 query
  s = s.replace(/```[\s\S]*?```/g, ' ')
  s = s.replace(/`([^`]*)`/g, '$1')
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/^[>#*\-\s]+/gm, '')
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length > 128) s = s.slice(0, 128).trim()
  return s
}

// 官方响应 → 归一化数组。
// 顺手把 score 高的排前面：官方保证是按 rerank_score 排的，但空字段/异常值
// 会让顺序不可靠，排序成本几乎为零。
export function parseSearchResults(obj) {
  const arr = obj && Array.isArray(obj.results) ? obj.results : []
  const out = []
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i]
    if (!r) continue
    const title = String(r.title || '')
    const url = String(r.url || '')
    if (!title && !url) continue
    const score = Number(r.rerank_score)
    const auth = Number(r.authority)
    out.push({
      title: title,
      url: url,
      snippet: String(r.snippet || ''),
      summary: String(r.summary || ''),
      content: String(r.content || ''),
      date: String(r.date || ''),
      score: isFinite(score) ? score : 0,
      authority: isFinite(auth) ? auth : -1
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

// 注入给模型的上下文块。
// 长度预算很关键：这台机器上下文窗口够大，但 token 是钱，
// 而且长上下文会明显拖慢首包。默认 6 条 × 240 字 ≈ 1500 字，够用又不贵。
export function formatSearchContext(results, opts) {
  const o = opts || {}
  const max = typeof o.max === 'number' ? o.max : 6
  const chunk = typeof o.chunk === 'number' ? o.chunk : 240
  const list = (results || []).slice(0, max)
  if (!list.length) return ''

  const lines = []
  lines.push('【联网搜索结果】以下是刚刚实时检索到的网页资料，共 ' + list.length + ' 条，按相关度排序。')
  lines.push('要求：优先依据这些资料回答；引用具体事实时在句末标注来源编号，如 [1]。')
  lines.push('这些资料可能过时或与问题无关。若不足以回答，请直说"没有找到可靠的最新信息"，不要编造。')
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    lines.push('')
    lines.push('[' + (i + 1) + '] ' + (r.title || '（无标题）'))
    const meta = []
    if (r.url) meta.push(r.url)
    if (r.date) meta.push('发布 ' + String(r.date).slice(0, 10))
    if (meta.length) lines.push(meta.join('   '))
    const body = String(r.summary || r.snippet || '').replace(/\s+/g, ' ').trim()
    if (body) lines.push(body.length > chunk ? body.slice(0, chunk) + '…' : body)
  }
  return lines.join('\n')
}

// 界面上只展示标题和站点，够用户判断"它到底查了什么"
export function searchSources(results, max) {
  const list = (results || []).slice(0, typeof max === 'number' ? max : 6)
  return list.map((r) => ({
    title: String(r.title || r.url || '（无标题）'),
    host: hostOf(r.url)
  }))
}

export function hostOf(url) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''))
  if (!m) return ''
  return m[1].replace(/^www\./i, '')
}

// 把搜索上下文插到「最后一条 user 消息」之前。
// 为什么不追加到末尾：末尾已是 user，塞到它后面格式就不对了（system 不能收尾）；
// 为什么不用 system 拼在开头：老对话里塞太多 system 会让模型把旧资料当当前事实。
export function injectSearchContext(messages, context) {
  const list = Array.isArray(messages) ? messages.slice() : []
  if (!context) return list
  let at = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] && list[i].role === 'user') { at = i; break }
  }
  if (at < 0) return list.concat([{ role: 'system', content: context }])
  list.splice(at, 0, { role: 'system', content: context })
  return list
}
