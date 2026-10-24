// 纯函数回归入口（Node 直跑，不碰设备）
import { parseSse, readChunk } from '../src/lib/sse.js'
import { holdIncompleteTail, stripInternalTags } from '../src/lib/text.js'
import { splitMath, latexToUnicode, canTypeset, isBalanced, splitMathLines, estimateWidth, needsDisplayMath, looksLikeBareMath, tightenMathSpaces } from '../src/lib/latex.js'
import { inlineRuns, runsWithMath, parseBlocks, renderPlan, promoteInlineBlocks, needsPaperSheet } from '../src/lib/md.js'
import { defaultParams, buildBody, describeBody, scopeOf, clampNumber, parseStop, PARAM_MAP, modelOptions } from '../src/lib/params.js'
import { normalizeSettings, normalizeBaseUrl, maskKey, isReady } from '../src/lib/settings.js'
import { buildApiMessages, newMessage, titleFrom, ensureTitle, trimMessages, summarizeUsage } from '../src/lib/chat.js'
import { diffNewPhotos, addPhoto, removePhoto, sortByMtimeDesc, isImageName, formatSize } from '../src/lib/photos.js'
import { billingPeriod, isHoliday, formatRemain, describePeriod, holidayTableYears, setTimeSkew, nowMs, applyHolidayDays, isMakeupWorkday, holidayYearFrom } from '../src/lib/peak.js'
import { parseHolidayPayload, countHolidayDays, holidaySources } from '../src/lib/holiday.js'
import { moneyText, normalizeBalance, balanceLevel, balanceChipText, balanceSplitText, updatedAgo } from '../src/lib/balance.js'
import { getUiState, setUiState, subscribeUiState } from '../src/lib/uistate.js'

let pass = 0
let fail = 0
const fails = []

function ok(cond, name, extra) {
  if (cond) { pass++; return }
  fail++
  fails.push(name + (extra ? '  → ' + extra : ''))
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, JSON.stringify(a) + ' !== ' + JSON.stringify(b))
}

// ---------- SSE ----------
{
  const r = parseSse('data: {"a":1}\n\ndata: [DONE]\n\n')
  eq(r.events.length, 2, 'SSE 解析出两个事件')
  eq(r.rest, '', 'SSE 无残留')

  const r2 = parseSse('data: {"a":1}\n\ndata: {"b"')
  eq(r2.events.length, 1, 'SSE 半个事件不吐出')
  ok(r2.rest.indexOf('{"b"') >= 0, 'SSE 残留保留半个事件')

  const r3 = parseSse(': keepalive\ndata: x\n\n')
  eq(r3.events, ['x'], 'SSE 忽略注释行')

  eq(readChunk('[DONE]').kind, 'done', 'chunk DONE')
  eq(readChunk('{"choices":[{"delta":{"content":"hi"}}]}').text, 'hi', 'chunk 正文')
  eq(readChunk('{"choices":[{"delta":{"reasoning_content":"hm"}}]}').kind, 'reasoning', 'chunk 思考')
  eq(readChunk('{"error":{"message":"bad"}}').kind, 'error', 'chunk 错误')
  eq(readChunk('{"usage":{"prompt_tokens":3},"choices":[]}').kind, 'meta', 'chunk 用量')
}

// ---------- 文本 ----------
{
  eq(stripInternalTags('a<|tool_calls_begin|>b'), 'ab', '清理尖括号协议标签')
  eq(stripInternalTags('x<ds_safety>内部判定</ds_safety>y'), 'xy', '清理 ds_safety 注解')
  eq(stripInternalTags('保留<invoke>中间</invoke>'), '保留中间', '清理 invoke')

  const held = holdIncompleteTail('abc\uFFFD\uFFFD')
  eq(held.complete, 'abc', '扣住末尾替换字符')
  eq(held.tail, '\uFFFD\uFFFD', '末尾替换字符留到下一轮')
  eq(holdIncompleteTail('abc').complete, 'abc', '完整文本不扣')
}

// ---------- LaTeX ----------
{
  const segs = splitMath('面积 $S=\\pi r^2$ 与 $100 和 $200')
  eq(segs.filter((s) => s.type === 'math').length, 1, '货币不误判为公式')

  // 截断容错：回复被 max_tokens 切断时 \( 没有闭合的 \)，
  // 旧实现会把 "\(" 原样当文本印出来。
  const cut = splitMath('如果 \\(A_1=\\{1')
  ok(!cut.some((x) => String(x.value || '').indexOf('\\(') >= 0), '落单的 \\( 不残留')
  ok(cut.map((x) => x.value).join('').indexOf('A_1=') >= 0, '截断后的残句仍保留')

  const cut2 = splitMath('推导 \\[x^2')
  ok(!cut2.some((x) => String(x.value || '').indexOf('\\[') >= 0), '落单的 \\[ 不残留')

  // 未闭合的 \( 之后整段当公式（Unicode 近似）：以前是把 \( 丢掉、后面按普通文本
  // 输出，屏幕上就会出现 "S=k_B\ln\Omega" 这种原始源码（流式时特别明显）。
  const un = splitMath('如果 \\(A_1=\\{1')
  eq(un[0].value, '如果 ', '未闭合 \\( 之前的文本段')
  eq(un[1].type, 'math', '未闭合 \\( 之后变成公式段')
  eq(latexToUnicode(un[1].value), 'A₁={1', '未闭合公式可读（不泄露源码）')
  eq(splitMath('如果 \\(A_1=1\\) 成立')[0].value, '如果 ', '闭合 \\( 正常分段')
  eq(splitMath('价格 \\$6 起').map((x) => x.value).join(''), '价格 $6 起', '转义美元符还原')

  eq(latexToUnicode('x^2'), 'x²', '上标')
  eq(latexToUnicode('a_{i}'), 'aᵢ', '下标')
  ok(latexToUnicode('\\frac{a}{b}').indexOf('a/b') >= 0, '分式降级')
  ok(latexToUnicode('\\sqrt{2}').indexOf('√') >= 0, '根式降级')
  ok(latexToUnicode('\\alpha \\le \\beta').indexOf('α') === 0, '希腊字母')

  // 回归：分母带根号的嵌套分式。旧实现先跑 frac 再跑 sqrt，外层 \frac 永远匹配
  // 不上，\frac 掉进"未知命令"分支输出字面量 "frac"，分子分母糊成一行。
  {
    const u = latexToUnicode('d_1=\\frac{\\ln(S/K)+\\frac{1}{2}\\sigma^2}{\\sigma\\sqrt{T-t}}')
    ok(u.indexOf('frac') < 0, '嵌套分式不再漏出 frac 字面量')
    ok(u.indexOf('/(') > 0, '嵌套分式降级成 (分子)/(分母)')
    ok(u.indexOf('ln((S/K)') >= 0 || u.indexOf('ln(') >= 0, '分子里的 \\ln 保留')
  }
  eq(latexToUnicode('S\\,\\Phi(d_1)'), 'S Φ(d₁)', '细间距 \\, 不留反斜杠')
  eq(latexToUnicode('r\\pm1/2'), 'r±1/2', '命令紧跟数字也要转换（\\pm1）')
  eq(latexToUnicode('d_{1,2}'), 'd₁,₂', '多字符下标逐字映射')
  eq(latexToUnicode('nC_V'), 'nC_V', '无对应码位的下标保留 _ 不吞掉')
  eq(latexToUnicode('\\frac12'), '1/2', '\\frac12 简写')
  ok(latexToUnicode('\\sqrt2').indexOf('√2') === 0, '\\sqrt2 简写')
  eq(latexToUnicode('\\Delta S = n R \\ln\\left(\\frac{V_2}{V_1}\\right)'), 'Δ S = n R ln((V₂)/(V₁))', '\\left( 包裹的分式保留括号层级')

  // 回归：断行要认关系符与 \quad，别把整条公式丢给 Unicode
  {
    const src = '\\Delta S = n C_V \\ln\\left(\\frac{T_2}{T_1}\\right) + n R \\ln\\left(\\frac{V_2}{V_1}\\right) \\approx 12.4\\ \\mathrm{J/K}'
    // 这里只验断点行为，故意把阈值压到 400 逼它断
    const lines = splitMathLines(src, 400)
    ok(lines.length > 1, '超宽公式在 + 处断成多行')
    ok(lines.every((l) => estimateWidth(l) <= 400), '断出的每行都放得下')
    // 阈值够宽时不该拆（用户要求：不超边框就同一行）
    const short = '\\Delta S=n C_V\\ln\\left(\\frac{T_2}{T_1}\\right)+n R\\ln\\left(\\frac{V_2}{V_1}\\right)'
    eq(splitMathLines(short, 860).length, 1, '放得下时就返回单行（不拆）')
    ok(splitMathLines('a = b \\quad c = d', 150).length > 1, '\\quad 也能当断点')
    eq(splitMathLines('\\frac{a}{b}', 20).length, 0, '单个大分式断不动时退回 Unicode')
  }

  ok(canTypeset('E=mc^2'), '短公式可排版')
  // 宽度估算必须按"上下叠放"理解分式：\frac{分子}{分母} 的宽度是两者较大者，
  // 不是相加。旧模型把分子分母当左右拼接，把放得下的长公式误判成超宽。
  ok(canTypeset('d_1=\\frac{\\ln(S/K)+\\left(r+\\frac{1}{2}\\sigma^2\\right)(T-t)}{\\sigma\\sqrt{T-t}}'),
    '嵌套大分式放得下 → 单行原生')
  ok(canTypeset('\\frac{\\partial}{\\partial t}\\int_{\\Omega}\\rho\\,dV+\\oint_{\\partial\\Omega}\\rho\\vec{v}\\cdot d\\vec{A}=0'),
    '长积分式放得下 → 单行原生')
  ok(canTypeset('\\begin{aligned}a&=1\\\\b&=2\\\\c&=3\\end{aligned}'), 'aligned 多行环境可排版')
  ok(estimateWidth('\\frac{a}{b}') < estimateWidth('a+b'), '分式宽度取 max 而不是相加')
  ok(!canTypeset('\\frac{a}{'), '括号不配平不可排版')
  ok(!canTypeset('x'.repeat(60)), '超长不可排版')
  ok(!canTypeset('\\begin{array}{cc}a\\end{array}'), '未验证的环境不排版')
  ok(canTypeset('\\begin{cases}x=1\\end{cases}'), 'cases 可排版（实测能出图）')
  ok(canTypeset('\\begin{pmatrix}1&2\\end{pmatrix}'), 'pmatrix 可排版（实测能出图）')
  ok(!canTypeset('100'), '纯数字不是公式')
  ok(isBalanced('\\frac{a}{b}'), '配平判定')
  ok(!isBalanced('\\frac{a}{'), '不配平判定')
}

// ---------- Markdown ----------
{
  const runs = inlineRuns('普通 **粗体** 与 *斜体* 和 `代码`')
  ok(runs.some((r) => r.bold && r.text === '粗体'), '粗体 run')
  ok(runs.some((r) => r.italic && r.text === '斜体'), '斜体 run')
  ok(runs.some((r) => r.code && r.text === '代码'), '行内代码 run')
  // 关键约束：run 是扁平的，绝不能有 children 字段（模板据此平铺 <text>）
  ok(runs.every((r) => r.children === undefined), 'run 扁平无嵌套')
  ok(inlineRuns('snake_case_name 不该变斜体').length === 1, '下划线标识符不误判斜体')
  ok(inlineRuns('👍 ok').some((r) => r.text.indexOf('[赞]') >= 0), 'emoji 替换为文字')

  const withMath = runsWithMath('公式 $a+b$ 结束')
  ok(withMath.some((r) => r.math), '行内公式切成 math run')
  const long = runsWithMath('$' + 'x'.repeat(60) + '$')
  ok(long.every((r) => !r.math || r.typeset === false), '超长公式不交原生排版')

  const blocks = parseBlocks('# 标题\n\n段落一\n\n- 项目1\n- 项目2\n\n```js\ncode\n```\n\n> 引用\n\n---')
  eq(blocks[0].type, 'h', '标题块')
  eq(blocks[1].type, 'p', '段落块')
  eq(blocks.filter((b) => b.type === 'li').length, 2, '列表两项')
  ok(blocks.some((b) => b.type === 'code' && b.lang === 'js'), '代码块带语言')
  ok(blocks.some((b) => b.type === 'quote'), '引用块')
  ok(blocks.some((b) => b.type === 'hr'), '分隔线块')

  const plan = renderPlan('**粗** $x^2$')
  ok(plan[0].runs && plan[0].runs.length >= 2, '渲染计划带 runs')

  // 段落内单换行必须断开（并成一段会让多行挤在同一行）
  const p2 = parseBlocks('第一行\n第二行')
  eq(p2.length, 2, '单换行拆成两个段落块')

  // 表格必须保留二维结构（曾把单元格 join 成一行文本，屏上几乎没法读）
  const t = renderPlan('| a | b |\n| --- | --- |\n| 1 | 2 |')
  const tbl = t[0]
  eq(tbl.type, 'table', '表格块类型')
  eq(tbl.cols, 2, '表格列数')
  eq(tbl.rows.length, 2, '表格行数（表头不计入分隔线）')
  ok(Array.isArray(tbl.rows[1]) && tbl.rows[1][0] === '1', '单元格保持二维')
  // 短行要补齐，否则列会错位
  const t2 = renderPlan('| a | b | c |\n| --- | --- |\n| 1 |')
  ok(t2[0].rows[1].length === 3, '短行补齐到列数')

  // ---- 行间公式的三种写法都必须变成块级公式（否则屏上是原始 LaTeX 源码）----
  const bBracket = parseBlocks('前文\n\n\\[\n\\Delta S=nR\\ln\\frac{V_2}{V_1}>0.\n\\]\n\n后文')
  eq(bBracket.length, 3, '\\[ \\] 独占行 → 三个块')
  eq(bBracket[1].type, 'math', '\\[ \\] 之间识别为公式块')
  ok(bBracket[1].text.indexOf('\\Delta S') === 0, '公式内容完整')

  const bSameLine = renderPlan('$$E=mc^2$$')
  eq(bSameLine[0].type, 'math', '$$…$$ 同行也提升为公式块')
  eq(bSameLine[0].style, 'native', '短公式走原生排版')

  const bEnv = parseBlocks('\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}')
  eq(bEnv[0].type, 'math', '多行环境识别为公式块')
  ok(bEnv[0].text.indexOf('\\end{pmatrix}') > 0, '环境体的结束标记一起收进块里')

  // 行内公式：短的交给原生（分式保持竖排，与文字同一行、垂直居中）；
  // 长的（估宽超过 INLINE_MATH_MAX）才降级成 Unicode，否则会把整行正文挤走。
  const shortRun = runsWithMath('质能方程 $E=mc^2$ 很简单').filter((r) => r.math)[0]
  ok(shortRun && shortRun.typeset === true, '短行内公式交原生排版')
  const longRun = runsWithMath('这段 $\\int_0^1 x^2\\,dx=\\frac13$ 很长').filter((r) => r.math)[0]
  ok(longRun && longRun.typeset === false, '长行内公式不交原生排版')
  ok(longRun && longRun.text.indexOf('∫') >= 0, '长行内公式降级成 Unicode')

  // 放得下的长公式**必须留在同一行**（用户明确要求：不要无谓地断行）
  const oneLine = '\\Delta S=n C_V\\ln\\left(\\frac{T_2}{T_1}\\right)+n R\\ln\\left(\\frac{V_2}{V_1}\\right)'
  const ob = renderPlan('\\[\n' + oneLine + '\n\\]')[0]
  eq(ob.type, 'math', '长公式仍是公式块')
  ok(ob.style === 'native' && !ob.lines, '估算放得下就排成一行原生')

  // 真正超宽的公式才断行，且每行都要比原公式短
  const wide = oneLine + '+\\int_0^1 x^2\\,dx+\\oint_{\\partial\\Omega}\\rho\\vec{v}\\cdot d\\vec{A}+\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^n'
  const wb = renderPlan('\\[\n' + wide + '\n\\]')[0]
  eq(wb.type, 'math', '超宽公式仍是公式块')
  ok(wb.style === 'lines' && wb.lines.length > 1, '真超宽才断成多行')
  ok(wb.lines.every((ln) => ln.length < wide.length), '每行都比原公式短')

  // 多行环境不能被按 \\ 拆开：拆开后每行都缺 \begin/\end，
  // 引擎会把 \end 当未知命令、在屏幕上印出红色的 "\endaligned"（真机踩过）。
  const em = '\\begin{aligned}\\nabla\\cdot\\mathbf{E}&=\\frac{\\rho}{\\varepsilon_0}\\\\\\nabla\\cdot\\mathbf{B}&=0\\\\\\nabla\\times\\mathbf{B}&=\\mu_0\\mathbf{J}+\\mu_0\\varepsilon_0\\frac{\\partial\\mathbf{E}}{\\partial t}\\end{aligned}'
  const eb = renderPlan('\\[\n' + em + '\n\\]')[0]
  ok(eb.style === 'native' && !eb.lines, 'aligned 整块交原生，不按 \\\\ 拆开')
  eq(splitMathLines(em, 100).length, 0, '断行器拒绝拆环境公式')

}

// ---------- 参数（对齐官方文档） ----------
{
  const p = defaultParams()
  eq(p.model, 'deepseek-flash', '默认模型')
  eq(p.thinking, true, '默认开深度思考')
  eq(p.reasoningEffort, 'high', '默认 effort=high')

  let b = buildBody(p, [{ role: 'user', content: 'hi' }])
  ok(b.ok, '默认参数可发')
  eq(b.body.thinking, { type: 'enabled' }, 'thinking.type=enabled')
  eq(b.body.reasoning_effort, 'high', '带 reasoning_effort')
  ok(b.body.temperature === undefined, '思考模式不发 temperature')
  ok(b.body.stream_options.include_usage === true, '流式带 include_usage')

  // 关思考：必须发 disabled + effort=none，并且这时才发 temperature
  const off = Object.assign({}, p, { thinking: false, temperature: 0.7 })
  b = buildBody(off, [{ role: 'user', content: 'hi' }])
  eq(b.body.thinking, { type: 'disabled' }, '关闭思考')
  eq(b.body.reasoning_effort, 'none', '关闭时 effort=none')
  eq(b.body.temperature, 0.7, '非思考模式发 temperature')

  // 非流式不能带 stream_options（真机实测会 400）
  b = buildBody(Object.assign({}, p, { stream: false }), [{ role: 'user', content: 'hi' }])
  ok(b.body.stream_options === undefined, '非流式不发 stream_options')

  // top_p 只在思考模式且下限 0.95
  b = buildBody(Object.assign({}, p, { topP: 0.5 }), [{ role: 'user', content: 'hi' }])
  eq(b.body.top_p, 0.95, 'top_p 钳到 0.95')
  ok(b.warnings.length > 0, 'top_p 越界给出提示')

  // max_tokens=0 表示不传
  b = buildBody(Object.assign({}, p, { maxTokens: 0 }), [{ role: 'user', content: 'hi' }])
  ok(b.body.max_tokens === undefined, 'max_tokens=0 不传')

  // logprobs 联动
  b = buildBody(Object.assign({}, p, { logprobs: true, topLogprobs: 5 }), [{ role: 'user', content: 'hi' }])
  eq(b.body.top_logprobs, 5, 'top_logprobs 跟随 logprobs')
  b = buildBody(Object.assign({}, p, { logprobs: false, topLogprobs: 5 }), [{ role: 'user', content: 'hi' }])
  ok(b.body.top_logprobs === undefined, '未开 logprobs 不传 top_logprobs')

  // stop 拆分
  eq(parseStop('a, b ,,c'), ['a', 'b', 'c'], 'stop 拆分')
  eq(parseStop(''), [], 'stop 空')
  b = buildBody(Object.assign({}, p, { stopText: 'END' }), [{ role: 'user', content: 'hi' }])
  eq(b.body.stop, 'END', '单个 stop 用字符串')

  // json 模式
  b = buildBody(Object.assign({}, p, { jsonMode: true }), [{ role: 'user', content: 'hi' }])
  eq(b.body.response_format, { type: 'json_object' }, 'JSON 模式')

  // userId 校验
  b = buildBody(Object.assign({}, p, { userId: 'bad id!' }), [{ role: 'user', content: 'hi' }])
  ok(!b.ok, '非法 user_id 拒绝')
  b = buildBody(Object.assign({}, p, { userId: 'ok-id_1' }), [{ role: 'user', content: 'hi' }])
  ok(b.ok && b.body.user_id === 'ok-id_1', '合法 user_id 通过')

  // 联网搜索预留
  b = buildBody(Object.assign({}, p, { webSearch: true }), [{ role: 'user', content: 'hi' }])
  ok(b.body.web_search_options, '联网搜索预留字段')
  ok(b.warnings.length > 0, '联网搜索给出实验提示')

  // 空消息拒绝
  b = buildBody(p, [])
  ok(!b.ok, '空消息拒绝')

  // 数值钳制
  eq(clampNumber(PARAM_MAP.temperature, 5), 2, 'temperature 上限')
  eq(clampNumber(PARAM_MAP.temperature, -1), 0, 'temperature 下限')
  eq(clampNumber(PARAM_MAP.temperature, 0.7), 0.7, 'temperature 步进对齐')
}

// ---------- 设置 ----------
{
  const s = normalizeSettings({ apiKey: ' sk-abcdefgh123 ', baseUrl: 'api.deepseek.com' })
  eq(s.apiKey, 'sk-abcdefgh123', 'API Key 去空格')
  eq(s.baseUrl, 'https://api.deepseek.com/v1', 'baseUrl 补全 /v1')
  ok(isReady(s), '填了 key 即就绪')
  eq(normalizeBaseUrl('https://api.deepseek.com/v1/chat/completions'), 'https://api.deepseek.com/v1', '去掉 chat/completions 后缀')
  eq(maskKey('sk-1234567890abcdef'), 'sk-1234****cdef', '掩码显示')
  ok(!normalizeSettings({}).params.thinking === false, '空设置补默认值')
  // 主页余额芯片开关：默认开；只有显式 false 才关（老配置没有这个字段）
  eq(normalizeSettings({}).showBalance, true, '余额芯片默认显示')
  eq(normalizeSettings({ showBalance: false }).showBalance, false, '显式关掉余额芯片')
  eq(normalizeSettings({ showBalance: 'false' }).showBalance, true, '字符串 false 不算关（只认布尔）')
}

// ---------- 跨页面 UI 状态 ----------
{
  const seen = []
  const off = subscribeUiState((s) => seen.push(s.showBalance))
  setUiState({ showBalance: false })
  eq(seen.length, 1, '改值广播一次')
  eq(seen[0], false, '广播的是新值')
  setUiState({ showBalance: false })
  eq(seen.length, 1, '值没变不重复广播（避免无谓重渲染）')
  setUiState({ showBalance: true })
  eq(seen.length, 2, '再改一次又广播')
  off()
  setUiState({ showBalance: false })
  eq(seen.length, 2, '退订后不再收到')
  eq(getUiState().showBalance, false, '状态本身仍然生效')
  // 订阅回调里退订不能把后面的订阅者漏掉
  const hits = []
  const a = subscribeUiState(() => { a(); hits.push('a') })
  subscribeUiState(() => hits.push('b'))
  setUiState({ showBalance: true })
  eq(hits.join(','), 'a,b', '回调里退订不影响其它订阅者')
  eq(getUiState().showBalance, true, '状态已更新')
}

// ---------- 会话 ----------
{
  const u = newMessage('user', '你好，帮我解释一下相对论')
  eq(titleFrom('你好，帮我解释一下相对论').length <= 15, true, '标题截断')
  const conv = { messages: [u] }
  ensureTitle(conv)
  ok(conv.title !== '新对话', '标题从首条用户消息生成')

  const bad = newMessage('assistant', '')
  bad.error = '失败'
  const msgs = [newMessage('user', 'a'), bad, newMessage('assistant', 'b')]
  eq(trimMessages(msgs, 10).length, 2, '跳过错误消息')

  const withImg = newMessage('user', '看图')
  withImg.images = [{ key: 'k1', path: '/p/1.jpg' }]
  const api = buildApiMessages([withImg], { imageUrlOf: () => 'data:image/jpeg;base64,AAA' })
  eq(api[0].content.length, 2, '图片消息拼成 text+image_url')
  eq(api[0].content[1].type, 'image_url', 'image_url 段')

  const noUrl = buildApiMessages([withImg], { imageUrlOf: () => null })
  eq(noUrl[0].content, '看图', '图读不到时退回纯文本')

  // 回归：纯图无文本 + 图解析失败时，旧实现会让 parts 为空 →
  // 整条 user 消息被 continue 丢掉，模型完全看不见这次输入。
  const imgOnly = newMessage('user', '')
  imgOnly.images = [{ key: 'k2', path: '/p/2.jpg' }]
  const dropped = buildApiMessages([imgOnly], { imageUrlOf: () => null })
  eq(dropped.length, 1, '纯图消息不因解析失败而消失')
  ok(typeof dropped[0].content === 'string' && dropped[0].content.indexOf('读取失败') >= 0, '降级为占位说明')

  const okImg = buildApiMessages([imgOnly], { imageUrlOf: () => 'data:image/png;base64,BBB' })
  eq(okImg[0].content.length, 1, '纯图消息只有 image_url 段')
  eq(okImg[0].content[0].type, 'image_url', '纯图走 image_url')

  ok(summarizeUsage({ prompt_tokens: 10, completion_tokens: 5 }).indexOf('入 10') === 0, '用量摘要')
}

// ---------- 图片列表 ----------
{
  ok(isImageName('a.JPG'), '扩展名大小写')
  ok(!isImageName('a.mp4'), '非图片过滤')
  ok(formatSize(2048) === '2K', '大小格式化')

  const list = sortByMtimeDesc([{ name: 'a', mtime: 1 }, { name: 'b', mtime: 3 }, { name: 'c', mtime: 2 }])
  eq(list.map((x) => x.name), ['b', 'c', 'a'], '按时间倒序')

  const before = [{ key: 'a' }, { key: 'b' }]
  const after = [{ key: 'a' }, { key: 'b' }, { key: 'c', mtime: 9 }]
  eq(diffNewPhotos(before, after).map((x) => x.key), ['c'], '拍照后只把新照片算进来')

  let sel = []
  sel = addPhoto(sel, { key: 'x' }, 2)
  sel = addPhoto(sel, { key: 'x' }, 2)
  eq(sel.length, 1, '同一张不重复加入')
  sel = addPhoto(sel, { key: 'y' }, 2)
  sel = addPhoto(sel, { key: 'z' }, 2)
  eq(sel.length, 2, '达到上限不再加')
  eq(removePhoto(sel, 'x').length, 1, '移除已选')
}


// ---------- 行内公式提升 / 纸面模式 ----------
{
  // 只有"压平就丢语义"的公式才提升；本来该横着写的留在正文里
  ok(needsDisplayMath('\\frac{a}{b}'), '分式需要竖排')
  ok(needsDisplayMath('\\begin{cases}x,y\\end{cases}'), '多行环境需要竖排')
  ok(needsDisplayMath('\\sum_{i=1}^n i'), '求和号需要竖排')
  ok(!needsDisplayMath('E=mc^2'), '简单公式不需要竖排')
  ok(!needsDisplayMath('c_p=c_V+R'), '上下标不需要竖排')

  // 行内**短**公式：不再抽出去，就地原生排版（分式仍竖排），与上下文同一行
  let bl = renderPlan('根据求根公式 $x=\\frac{-b}{2a}$ 可得结果。')
  eq(bl.length, 1, '短行内公式不拆段')
  eq(bl[0].type, 'p', '仍是普通段落')
  eq(bl[0].runs.filter((r) => r.math && r.typeset).length, 1, '短分式就地走原生（竖排）')

  // 上下文很短时，350px 的公式也能留在同一行（整行还放得下，句子不必被切断）
  bl = renderPlan('根据求根公式 $x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$ 可得结果。')
  eq(bl.length, 1, '上下文短时行内公式仍在同一行')
  ok(bl[0].runs.some((r) => r.math && r.typeset), '公式就地走原生竖排')

  // 整行真的放不下才提升为独立公式行
  const huge = '\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}+\\frac{-b-\\sqrt{b^2-4ac}}{2a}+\\frac{-b+\\sqrt{b^2-4ac}}{2a}'
  bl = renderPlan('根据求根公式 $' + huge + '$ 可得结果。')
  eq(bl.map((b) => b.type), ['p', 'math', 'p'], '整行放不下时提升为三段')
  ok(bl[1].style === 'native' || bl[1].style === 'lines', '提升后用原生竖排')
  ok(bl[2].text.indexOf('，') !== 0, '续接段落去掉了句首标点')

  // 短公式跟"求导："这类引导语能并进同一行时，就不要再单开一行
  bl = renderPlan('求导：\n$$\n\\frac{d}{dx}x^2=2x\n$$')
  eq(bl.length, 1, '短公式并回引导语所在行')
  eq(bl[0].runs.filter((r) => r.math && r.typeset).length, 1, '公式作为行内 run 挂上')

  // 引导语后面跟的是长公式 / 多行环境，就不并（并了会换行，反而更乱）
  bl = renderPlan('解得：\n$$\n\\begin{aligned}a&=1\\\\b&=2\\end{aligned}\n$$')
  eq(bl.length, 2, '多行环境不与引导语同行')

  // 行内简单公式不拆段
  bl = renderPlan('质能 $E=mc^2$ 与比热 $c_p=c_V+R$。')
  eq(bl.length, 1, '简单行内公式不拆段')
  eq(bl[0].type, 'p', '仍是普通段落')

  // 列表项里的短分式：就地原生，bullet 还在
  bl = renderPlan('- 动能 $\\frac{1}{2}mv^2$ 守恒')
  eq(bl.length, 1, '列表里的短分式不拆')
  eq(bl[0].type, 'li', '还是列表项')
  eq(bl[0].marker, '•', 'bullet 还在')

  // 列表里的较长分式：整行还放得下，就留在同一个列表项里
  bl = renderPlan('- 动能 $\\frac{1}{2}mv^2+\\frac{1}{2}kx^2=\\frac{1}{2}kA^2$ 守恒')
  eq(bl.length, 1, '列表里的长分式也在同一行')
  eq(bl[0].type, 'li', '还是列表项')
  eq(bl[0].marker, '•', 'bullet 还在')

  // 纸面判定
  ok(needsPaperSheet('$$\nE=mc^2\n$$'), '块级公式触发纸面')
  ok(needsPaperSheet('行内 $\\frac{a}{b}$ 也会触发'), '结构化行内公式触发纸面')
  ok(!needsPaperSheet('纯文字回答，一个公式都没有'), '纯文字不触发纸面')
}

// ---------- 真实回答的回归：引导语紧跟 \[ 没有空行 ----------
//
// 现场：一条微积分回答里几十个公式全变成源码，只因为模型写的是
//     计算定积分
//     \[
//     I=\int_0^1 ...
//     \]
// 中间没有空行。段落收集把 `\[` 吞进上一段，随后按行拆开成 p 块，
// 于是 `\[` 成了空 math run、公式成了普通文字、`\]` 原样上屏。
{
  const md = [
    '计算定积分',
    '\\[',
    'I=\\int_0^1 \\frac{\\ln(1+x)}{1+x^2}\\,dx',
    '\\]',
    '解答：',
    '令',
    '\\[',
    'x=\\tan\\theta.',
    '\\]'
  ].join('\n')
  const bl = renderPlan(md)
  eq(bl.map((b) => b.type), ['p', 'math', 'p', 'p', 'math'], '引导语紧接 \\[ 时公式仍成块')
  ok(bl[1].style === 'native' || bl[1].style === 'lines', '公式走了原生排版')
  ok(bl[1].text.indexOf('\\int') > 0, '公式正文整段进块，没被拆行')
  ok(!bl.some((b) => b.type === 'p' && /\\\]/.test(b.text || '')), '不再有裸露的 \\]')

  // `\[ I=... \]` 写在同一行也要被认出（不能靠独占行规则）
  const one = renderPlan('结果为\n\\[ I=e-2 \\]')
  eq(one.map((b) => b.type), ['p', 'math'], '同行 \\[ … \\] 也成块')
  eq(one[1].text, 'I=e-2', '同行公式内容完整')

  // 孤立 \] / \) 一律不进正文
  const lon = splitMath('答案是 42 \\] 结束 \\)')
  const txt = lon.filter((s) => s.type === 'text').map((s) => s.value).join('')
  ok(txt.indexOf('\\]') < 0 && txt.indexOf('\\)') < 0, '落单的收尾定界符被吞掉')
}

// ---------- 裸 LaTeX：模型不写任何定界符 ----------
{
  ok(looksLikeBareMath('I=\\int_0^1 \\frac{\\ln(1+x)}{1+x^2}\\,dx'), '整行裸公式能认出')
  ok(looksLikeBareMath('\\frac{\\pi}{8}\\ln2'), '只有分式也能认出')
  ok(!looksLikeBareMath('The value of x is 3'), '英文句子不当公式')
  ok(!looksLikeBareMath('这道题用分部积分法，设 u=x^2'), '含中文不当公式')
  ok(!looksLikeBareMath('- 列表项里的说明文字'), '列表项不当公式')
  ok(!looksLikeBareMath('https://api.deepseek.com/v1'), '网址不当公式')
  ok(!looksLikeBareMath('\\begin{pmatrix}1&2'), '不配平的环境不当公式')

  const bl = renderPlan('因此\nI=e-2\\cdot\\frac{\\pi}{8}\n成立')
  eq(bl.map((b) => b.type), ['p', 'math', 'p'], '裸公式行被提升成公式块')
  eq(bl[1].text, 'I=e-2\\cdot\\frac{\\pi}{8}', '裸公式内容原样进块')
}

// ---------- "end" 不再漏到屏幕上 ----------
{
  // 环境没配平（流式截断 / 跨块）时，\begin \end 不能被当成普通命令输出
  const cut = latexToUnicode('A=\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 ')
  ok(cut.indexOf('begin') < 0 && cut.indexOf('end') < 0, '截断的 \\begin 不留字面量', cut)
  ok(cut.indexOf('1') >= 0 && cut.indexOf('4') >= 0, '截断环境的内容保留', cut)
  const stray = latexToUnicode('x=1\\end{cases}')
  ok(stray.indexOf('end') < 0, '落单的 \\end 不留字面量', stray)
  // \\[4pt] 行距也不是公式内容
  const gap = latexToUnicode('1 & \\frac12 \\\\[4pt] 2 & 3')
  ok(gap.indexOf('4pt') < 0, '\\\\[4pt] 不残留', gap)
  // \boxed 保留内容、不输出 boxed
  eq(latexToUnicode('\\boxed{I=e-2}'), 'I=e-2', '\\boxed 只留内容')
  // \setminus 有对应符号
  ok(latexToUnicode('\\mathbb R\\setminus\\{0\\}').indexOf('setminus') < 0, '\\setminus 映射成符号')
}

// ---------- 块级公式里的 2em 空洞 ----------
//
// 现场：`0,\qquad -\frac1{4\sqrt3}=-\frac{\sqrt3}{12}.` 上屏后，逗号到减号之间
// 空了 77px，`0,` 像一段孤立内容挂在公式左边，整行读起来像"0 等于后面那串"。
{
  const list = tightenMathSpaces('0,\\qquad -\\frac1{4\\sqrt3}=-\\frac{\\sqrt3}{12}.')
  ok(list.indexOf('qquad') < 0, '逗号后的 \\qquad 被收窄')
  ok(list.indexOf('0,\\;') === 0, '列表分隔收成 \\;', list)
  const cond = tightenMathSpaces('y=\\frac{1}{x}\\qquad (x\\ne 0)')
  ok(cond.indexOf('\\quad (x') > 0 && cond.indexOf('qquad') < 0, '条件前的 \\qquad 降为 \\quad', cond)
  const env = '\\begin{aligned}a&=1\\qquad b&=2\\end{aligned}'
  eq(tightenMathSpaces(env), env, '多行环境里的间距不动')
  // 渲染计划里拿到的源码必须已经收窄（页面渲染用的是 b.text）
  const blk = renderPlan('\\[\\n0,\\qquad -\\frac1{4\\sqrt3}=-\\frac{\\sqrt3}{12}.\\n\\]')
  eq(blk.length, 1, '整块公式一个 math 块')
  ok(blk[0].text.indexOf('qquad') < 0, '块文本已收窄', blk[0].text)
}

// ---------- 上下标里的命令 / 半抬半不抬 ----------
{
  eq(latexToUnicode('e^{i\\pi}+1=0'), 'e^(iπ)+1=0', '上标里的 \\pi 不留下反斜杠')
  eq(latexToUnicode('x^{n+1}'), 'xⁿ⁺¹', '全可映射时用上标字形')
  eq(latexToUnicode('d_{1,2}'), 'd₁,₂', '标点允许映射不上')
  eq(latexToUnicode('nC_V'), 'nC_V', 'V 没有下标字形，保留 _V')
}

// ---------- 设置页模型选项：扫描前后要能看出区别 ----------
//
// 现场：点完「扫描模型」一切正常（落盘里有 2 个模型），但界面上那几个选项
// 一个字都没变 —— 因为扫描到的 id 正好命中内置清单，被换回了同样的中文长名。
{
  const dft = modelOptions(null)
  eq(dft.map((o) => o.value), ['deepseek-flash', 'deepseek-v4-pro'], '未扫描时用内置清单')
  eq(dft[0].label, 'DeepSeek V4.1 Flash', '未扫描时显示友好长名')

  const scanned = modelOptions([
    { id: 'deepseek-flash', label: 'deepseek-flash' },
    { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' }
  ])
  eq(scanned[0].label, 'deepseek-flash', '扫描后显示接口返回的 id')
  ok(scanned[0].label !== dft[0].label, '扫描前后选项文字必须有区别')

  const extra = modelOptions([{ id: 'deepseek-reasoner' }])
  eq(extra.map((o) => o.value), ['deepseek-reasoner'], '新模型也能选')
  eq(extra[0].label, 'deepseek-reasoner', '新模型用 id 显示')
}

// ---------- 峰谷时段：官方没有状态接口，规则只能本地算 ----------
//
// 规则（价格页脚注 2）：工作日 9:00-12:00、14:00-18:00 为峰价；其余时段、
// 周末、法定节假日全天按谷价（半价）。判定一律按 UTC+8，不看设备时区。
const bj = (y, m, d, h, mi) => Date.UTC(y, m - 1, d, h - 8, mi || 0)

{
  // 2026-10-23 是周五
  let p = billingPeriod(bj(2026, 10, 23, 10, 0))
  eq(p.peak, true, '工作日 10:00 是峰价')
  eq(p.label, '峰价', '峰价标签')
  eq(formatRemain(p.remainMs), '2 小时', '距转谷价 2 小时')

  p = billingPeriod(bj(2026, 10, 23, 9, 0))
  eq(p.peak, true, '9:00 整已进入峰价')

  p = billingPeriod(bj(2026, 10, 23, 8, 59))
  eq(p.peak, false, '8:59 仍是谷价')
  eq(formatRemain(p.remainMs), '1 分', '距转峰价 1 分')

  p = billingPeriod(bj(2026, 10, 23, 12, 0))
  eq(p.peak, false, '12:00 整转谷价（午休）')
  eq(billingPeriod(bj(2026, 10, 23, 12, 30)).reason, 'break', '午休归入 break')

  p = billingPeriod(bj(2026, 10, 23, 18, 0))
  eq(p.peak, false, '18:00 整转谷价')

  // 周五 18:00 之后一路到周一 9:00 —— 周末全天不计峰时
  p = billingPeriod(bj(2026, 10, 23, 18, 30))
  eq(p.until, bj(2026, 10, 26, 9, 0), '周五夜间直连周一 9:00')
  eq(p.reason, 'break', '周五夜间不是周末')

  p = billingPeriod(bj(2026, 10, 24, 10, 0))
  eq(p.peak, false, '周六 10:00 是谷价')
  eq(p.reason, 'weekend', '周末全天空闲')
  eq(p.until, bj(2026, 10, 26, 9, 0), '周末直到周一 9:00')

  p = billingPeriod(bj(2026, 10, 25, 22, 0))
  eq(p.peak, false, '周日深夜仍是谷价')

  // 法定节假日：2026 国庆 10/1-10/7
  ok(isHoliday(2026, 10, 1), '10-01 是法定节假日')
  ok(!isHoliday(2026, 10, 8), '10-08 不是节假日')
  p = billingPeriod(bj(2026, 10, 1, 10, 0))
  eq(p.peak, false, '国庆上午是谷价')
  eq(p.reason, 'holiday', '节假日原因')
  eq(p.until, bj(2026, 10, 8, 9, 0), '假期结束后的第一个 9:00')

  // 春节 2/15-2/23（跨 9 天，含周末）
  ok(isHoliday(2026, 2, 16), '春节 2-16 是节假日')
  ok(isHoliday(2026, 2, 23), '春节 2-23 是节假日')
  ok(!isHoliday(2026, 2, 24), '2-24 已收假')
  eq(billingPeriod(bj(2026, 2, 20, 10, 0)).peak, false, '春节里的周五也是谷价')

  // 时区无关：同一时刻换个系统时区也得出同样结论（这里靠 UTC+8 推算，不看本地时区）
  eq(billingPeriod(Date.UTC(2026, 9, 23, 2, 0)).peak, true, 'UTC 02:00 = 北京 10:00')

  ok(holidayTableYears().indexOf(2026) >= 0, '节假日表含 2026')
  const d = describePeriod(bj(2026, 10, 24, 10, 0))
  ok(d.detail.indexOf('距转峰价') === 0, 'describePeriod 给出倒计时文案')
  eq(d.reasonText, '周末全天空闲', '周末原因文案')
}

// 时钟偏差：设备没同步 NTP 时，用余额响应头的 Date 补偿
{
  setTimeSkew(0)
  const before = nowMs() - Date.now()
  ok(Math.abs(before) < 5, '默认无偏差')
  setTimeSkew(3600000)
  ok(Math.abs(nowMs() - Date.now() - 3600000) < 5, '补偿后 nowMs 前进 1 小时')
  setTimeSkew(0)
}

// ---------- 余额：官方金额是字符串，展示要固定两位 ----------
{
  eq(moneyText(12.3, 'CNY'), '¥12.30', '金额固定两位小数')
  eq(moneyText(110, 'USD'), '$110.00', '美元符号')
  eq(moneyText('7.5', 'CNY'), '¥7.50', '字符串金额也能格式化')

  const b = normalizeBalance({
    available: true, currency: 'CNY', total: '110.00',
    granted: '10.00', toppedUp: '100.00', at: 1700000000000, skew: 1200
  })
  eq(b.total, 110, '余额转成数字')
  eq(b.granted, 10, '赠金转成数字')
  eq(b.toppedUp, 100, '充值转成数字')
  eq(balanceSplitText(b), '充值 ¥100.00 · 赠送 ¥10.00', '充值/赠送拆分文案')

  eq(balanceLevel(110, true), 'ok', '余额充足')
  eq(balanceLevel(3, true), 'low', '余额偏低')
  eq(balanceLevel(0.5, true), 'critical', '余额告急')
  eq(balanceLevel(0, false), 'empty', '不可用')
  eq(normalizeBalance(null).at, 0, '空缓存 at 为 0')

  // 芯片文案：没查过只写「余额」，查过后带峰/谷标记
  eq(balanceChipText(null, { peak: false }), '余额·谷', '未查询时也显示时段')
  eq(balanceChipText(b, { peak: true }), '¥110.00·峰', '峰价芯片文案')
  eq(balanceChipText(b, { peak: false }), '¥110.00·谷', '谷价芯片文案')
  eq(balanceChipText(b, null), '¥110.00', '无时段信息时不带标记')

  eq(updatedAgo(1000, 1000 + 30000), '刚刚更新', '30 秒内算刚刚')
  eq(updatedAgo(1000, 1000 + 5 * 60000), '5 分钟前更新', '分钟级相对时间')
}

// ---- 节假日网络数据（lib/holiday.js 解析 + peak.js 生效）----
function holidaySuite() {
  // holiday-cn 格式：days[{name,date,isOffDay}]
  const cn = JSON.stringify({
    year: 2026,
    papers: ['https://www.gov.cn/xxx'],
    days: [
      { name: '元旦', date: '2026-01-01', isOffDay: true },
      { name: '元旦', date: '2026-01-02', isOffDay: true },
      { name: '元旦', date: '2026-01-03', isOffDay: true },
      { name: '春节', date: '2026-02-15', isOffDay: true },
      { name: '春节', date: '2026-02-16', isOffDay: true },
      { name: '春节', date: '2026-02-17', isOffDay: true },
      { name: '元旦后补班', date: '2026-01-04', isOffDay: false },
      { name: '春节前补班', date: '2026-02-14', isOffDay: false }
    ]
  })
  const d1 = parseHolidayPayload('holiday-cn', cn, 2026)
  ok(d1 && d1.length === 8, 'holiday-cn 解析出 8 天')
  eq(countHolidayDays(d1), { off: 6, work: 2 }, 'holiday-cn 休息/补班计数')
  eq(d1[0].date, '2026-01-01', 'holiday-cn 结果按日期排序')

  // timor 格式：holiday{'MM-DD':{holiday,name}}，只列特殊日
  const timor = JSON.stringify({
    code: 0,
    holiday: {
      '01-01': { holiday: true, name: '元旦', wage: 3 },
      '01-02': { holiday: true, name: '元旦', wage: 2 },
      '01-03': { holiday: true, name: '元旦', wage: 2 },
      '02-15': { holiday: true, name: '春节', wage: 2 },
      '02-16': { holiday: true, name: '除夕', wage: 3 },
      '02-17': { holiday: true, name: '初一', wage: 3 },
      '01-04': { holiday: false, name: '元旦后补班', wage: 1 },
      '02-14': { holiday: false, name: '春节前补班', wage: 1 }
    }
  })
  const d2 = parseHolidayPayload('timor', timor, 2026)
  ok(d2 && d2.length === 8, 'timor 解析出 8 天（MM-DD 自动补年份）')
  eq(d2.filter((x) => x.date.slice(0, 4) === '2026').length, 8, 'timor 日期都带上了年份')
  eq(countHolidayDays(d2), { off: 6, work: 2 }, 'timor 与 holiday-cn 计数一致')

  // 次年公告未发布：空数据必须当成"没拿到"，不能当成"全年无休"
  eq(parseHolidayPayload('holiday-cn', '{"year":2027,"days":[]}', 2027), null, '空 days 判为无效')
  eq(parseHolidayPayload('timor', '{"code":0,"holiday":{}}', 2027), null, '空 holiday 判为无效')
  eq(parseHolidayPayload('holiday-cn', '<html>challenge</html>', 2026), null, '非 JSON（Cloudflare 挑战页）判为无效')

  // 数据源顺序：jsDelivr 主、fastly 备、timor 兜底
  const src = holidaySources(2026)
  eq(src.length, 3, '三个数据源')
  eq(src[0].url.indexOf('2026.json') > 0, true, '主源 URL 带年份')
  ok(src[2].kind === 'timor', 'timor 作为最后的兜底')

  // 生效：网络数据覆盖内置表
  ok(applyHolidayDays(2030, d1, { at: 1000, source: 'holiday-cn' }), 'applyHolidayDays 接受有效数据')
  ok(isHoliday(2030, 1, 2) === true, '网络数据生效（2030-01-02 放假）')
  ok(isHoliday(2030, 1, 5) === false, '没列出的日子不算假')
  ok(isMakeupWorkday(2030, 1, 4) === true, '补班日可查（当前规则下不影响峰谷）')
  eq(holidayYearFrom(2030), 'net', '2030 标记为网络数据')
  eq(holidayYearFrom(2026), 'builtin', '2026 仍用内置表')
  // 2030-01-01 是周三，且被设为节假日 → 上午 10 点应为谷价
  eq(describePeriod(Date.UTC(2030, 0, 1, 2, 0)).peak, false, '网络数据参与峰谷判定')
  eq(applyHolidayDays(2031, [], {}), false, '空数组不覆盖')
}

holidaySuite()

console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败') + '：' + pass + ' 项断言，' + fail + ' 项失败')
if (fail) {
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
