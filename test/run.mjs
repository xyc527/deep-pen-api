// 纯函数回归入口（Node 直跑，不碰设备）
import { parseSse, readChunk } from '../src/lib/sse.js'
import { holdIncompleteTail, stripInternalTags } from '../src/lib/text.js'
import { splitMath, latexToUnicode, canTypeset, isBalanced, splitMathLines, estimateWidth, needsDisplayMath, looksLikeBareMath, tightenMathSpaces } from '../src/lib/latex.js'
import { inlineRuns, runsWithMath, parseBlocks, renderPlan, promoteInlineBlocks, needsPaperSheet } from '../src/lib/md.js'
import { defaultParams, buildBody, describeBody, scopeOf, clampNumber, parseStop, PARAM_MAP, modelOptions } from '../src/lib/params.js'
import { normalizeSettings, normalizeBaseUrl, maskKey, isReady, settingsSignature, saveButtonState } from '../src/lib/settings.js'
import { buildApiMessages, newMessage, titleFrom, ensureTitle, trimMessages, summarizeUsage, planRegenerate, planEdit, findMessageIndex } from '../src/lib/chat.js'
import { diffNewPhotos, addPhoto, removePhoto, sortByMtimeDesc, isImageName, formatSize } from '../src/lib/photos.js'
import { billingPeriod, isHoliday, formatRemain, describePeriod, holidayTableYears, setTimeSkew, nowMs, applyHolidayDays, isMakeupWorkday, holidayYearFrom } from '../src/lib/peak.js'
import { parseHolidayPayload, countHolidayDays, holidaySources } from '../src/lib/holiday.js'
import { moneyText, normalizeBalance, balanceLevel, balanceChipText, balanceSplitText, updatedAgo } from '../src/lib/balance.js'
import { getUiState, setUiState, subscribeUiState, publishSettings } from '../src/lib/uistate.js'
import { normalizeSearchMode, shouldSearch, buildSearchQuery, parseSearchResults, formatSearchContext, searchSources, hostOf, injectSearchContext, sourceLine } from '../src/lib/search.js'
import { logLine, setLogSink, logTail, logText, logStats, resetLog, seedLog, flushNow } from '../src/lib/logfile.js'
import { judgeReadback, readbackHint } from '../src/lib/savecheck.js'
import { normPath, mkdirChain } from '../src/lib/paths.js'
import { planWrites, describeWriteFail, WRITE_ORDER } from '../src/lib/writeplan.js'
import { APP_VERSION } from '../src/lib/appversion.js'
import { normalizeDoc, emptyDoc, pickProfile, writeProfile, profileKey, setMode, addPersona, removePersona, setActivePersona, renamePersona, setPersonaCard, cloneProfile, personasBrief, findPersona, MAX_PERSONAS, DOC_VERSION } from '../src/lib/profile.js'
import { normalizeCard, personaSystemPrompt, parsePersonaFile, nameFromFile, cardIsEmpty, greetingOf, CARD_ROWS } from '../src/lib/persona.js'
import { sectionsFor, sectionById, hasGroup, sectionStatus } from '../src/lib/sections.js'
import { normalizeMemory, memoryEntry, foldMessages, pruneNotes, memoryText, memorySummary, planCompression, notesAfter, MEMORY_DEFAULT } from '../src/lib/memory.js'
import { buildSettingsDoc, buildRecordsDoc, parseSettingsArchive, parseRecordsArchive, detectKind, archiveSummary, profileFolder, stampText, buildPersonaCardDoc, buildPersonaSampleDoc, personaFileName, ROOT_DIR, EXPORT_DIR, IMPORT_DIR, PERSONA_DIR } from '../src/lib/archive.js'
import { AMAP_BASE, AMAP_CODES, amapErrorText, amapReady, amapKeyOf, placeSearchUrl, placeAroundUrl, weatherUrl, geocodeUrl, regeoUrl, drivingUrl, parseAmap, poiList, weatherNow, weatherForecast, geocodeFirst, regeoText, routeBrief, fmtDistance, fmtDuration, poiSubtitle, weatherLine, weatherRows } from '../src/lib/amap.js'
import { parseMapIntent, pickCity, pickRoute, pickPlace, formatMapContext, mapChipLabel } from '../src/lib/mapintent.js'
import { plan, fitViewport, layout, getFit, setFit, isSaneScreen, normalizeScreen, DESIGN_W, DESIGN_H } from '../src/lib/fit.js'
import { readFileSync } from 'fs'

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

  // 联网搜索：请求体里**不能**再出现 web_search_options（那个字段官方未公开、
  // 收下也不检索，是上一版的假开关）
  b = buildBody(Object.assign({}, p, { searchMode: 'always' }), [{ role: 'user', content: 'hi' }])
  ok(b.body.web_search_options === undefined, '不再发送假的 web_search_options')
  ok(b.warnings.length === 0, '联网搜索不再产生实验性警告')

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

  // 开场白：扮演模式的对话是角色先开口的。assistant 打头原样发出去，
  // 有的模型会 400（要求 user 起头 / 严格交替），所以改成 system 说明。
  const greet = newMessage('assistant', '你回来啦')
  const gApi = buildApiMessages([greet, newMessage('user', '嗯')], { systemPrompt: '设定', maxMessages: 10 })
  eq(gApi[0].role, 'system', '第一条仍是系统提示词')
  eq(gApi[1].role, 'system', '开场白改写成 system 说明')
  ok(gApi[1].content.indexOf('你回来啦') >= 0, '说明里保留开场白原文')
  eq(gApi[2].role, 'user', '其后紧跟真实用户消息')
  eq(gApi.length, 3, '不会多出一条 assistant')
  const gOnly = buildApiMessages([greet], { maxMessages: 10 })
  ok(gOnly.every((m) => m.role === 'system'), '只有开场白时也不发 assistant 打头')

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

// ---------- 保存模式 / 设置指纹 / 跨页广播 ----------
function saveModeSuite() {
  // 保存方式：默认自动，只认 'manual'
  eq(normalizeSettings({}).saveMode, 'auto', '默认自动保存')
  eq(normalizeSettings({ saveMode: 'manual' }).saveMode, 'manual', 'manual 被保留')
  eq(normalizeSettings({ saveMode: 'auto' }).saveMode, 'auto', 'auto 被保留')
  eq(normalizeSettings({ saveMode: 'MANUAL' }).saveMode, 'auto', '大小写不匹配回落自动')
  eq(normalizeSettings({ saveMode: true }).saveMode, 'auto', '非字符串回落自动')
  eq(normalizeSettings({ saveMode: 1 }).saveMode, 'auto', '数字回落自动')

  // 指纹：updatedAt 不参与比较（否则每次保存都会"变脏"）
  const a = normalizeSettings({ apiKey: 'sk-aaaaaaaaaaaa', saveMode: 'manual' })
  const b = Object.assign({}, a, { updatedAt: 123456 })
  eq(settingsSignature(a), settingsSignature(b), 'updatedAt 不影响指纹')

  const c = Object.assign({}, a, { apiKey: 'sk-bbbbbbbbbbbb' })
  ok(settingsSignature(a) !== settingsSignature(c), 'Key 变了指纹就变')

  // 界面上的对象可能是"没归一化"的：带空格、baseUrl 没协议/带尾斜杠。
  // 指纹必须归一化后算，否则一进页面就显示"有未保存改动"
  const raw = { apiKey: '  sk-aaaaaaaaaaaa  ', baseUrl: 'api.deepseek.com/', saveMode: 'manual' }
  eq(settingsSignature(raw), settingsSignature(a), '未归一化的输入与归一化后指纹相同')

  eq(settingsSignature(null), '', '空设置指纹为空串')

  // 保存按钮状态
  eq(saveButtonState(true), { label: '保存', enabled: true }, '有改动 → 保存可点')
  eq(saveButtonState(false), { label: '已保存', enabled: false }, '无改动 → 显示已保存')

  // 跨页广播：设置页落盘后 publishSettings，首页据此换掉自己那份
  const rev0 = getUiState().settingsRev
  eq(publishSettings(null).settingsRev, rev0, '广播 null 不递增 rev')

  // 注意：回调拿到的是同一个 state 对象（实时引用），断言必须当场快照，
  // 否则"退订后不再收到"永远测不出来 —— 读的其实是最新的 state 本身
  let got = null
  const unsub = subscribeUiState((s) => {
    got = { rev: s.settingsRev, key: s.settings ? s.settings.apiKey : null }
  })
  const payload = normalizeSettings({ apiKey: 'sk-cccccccccccc', showBalance: false, saveMode: 'manual' })
  publishSettings(payload)
  eq(getUiState().settingsRev, rev0 + 1, '广播后 rev +1')
  ok(getUiState().settings === payload, 'state.settings 指向刚广播的对象')
  eq(getUiState().showBalance, false, 'showBalance 跟随 settings 一起广播')
  ok(got && got.key === 'sk-cccccccccccc', '订阅者收到新设置')

  const rev1 = getUiState().settingsRev
  publishSettings(normalizeSettings({ apiKey: 'sk-dddddddddddd' }))
  eq(getUiState().settingsRev, rev1 + 1, '再次广播继续递增 rev')
  eq(getUiState().showBalance, true, '第二次广播把 showBalance 带回 true')

  unsub()
  const rev2 = getUiState().settingsRev
  publishSettings(normalizeSettings({ apiKey: 'sk-eeeeeeeeeeee' }))
  eq(getUiState().settingsRev, rev2 + 1, '退订后 rev 照常递增')
  eq(got.key, 'sk-dddddddddddd', '退订后不再收到广播')
}

saveModeSuite()

// ---------- 联网搜索 ----------
function searchSuite() {
  // 档位归一化：只认三档，其它一律关（老配置里是 webSearch bool，落不到这里）
  eq(normalizeSearchMode('always'), 'always', 'searchMode always')
  eq(normalizeSearchMode('auto'), 'auto', 'searchMode auto')
  eq(normalizeSearchMode('on'), 'off', 'searchMode 未知值 → off')
  eq(normalizeSearchMode(true), 'off', 'searchMode 旧布尔值 → off')
  eq(normalizeSearchMode(undefined), 'off', 'searchMode 缺省 → off')

  // 关档永远不搜（包括"每问必搜"档以外的一切）
  eq(shouldSearch('今天北京的天气怎么样', 'off'), false, 'off 档不搜')

  // 自动档：明显有时效/外部信息需求 → 搜
  ok(shouldSearch('今天北京的天气怎么样', 'auto'), 'auto：天气要搜')
  ok(shouldSearch('DeepSeek 最新发布的是什么模型', 'auto'), 'auto：最新动态要搜')
  ok(shouldSearch('帮我查一下 iPhone 17 的价格', 'auto'), 'auto：明确要求查要搜')
  ok(shouldSearch('2026年春节放假安排', 'auto'), 'auto：带年份的提问要搜')
  ok(shouldSearch('https://example.com/a 这个页面讲了什么', 'auto'), 'auto：贴链接要搜')

  // 自动档：明显不需要外部信息 → 不搜（这几条是最容易误伤的场景）
  eq(shouldSearch('你好', 'auto'), false, 'auto：寒暄不搜')
  eq(shouldSearch('继续', 'auto'), false, 'auto：接话不搜')
  eq(shouldSearch('帮我写一个快速排序的函数', 'auto'), false, 'auto：写代码不搜')
  eq(shouldSearch('翻译：hello world', 'auto'), false, 'auto：翻译不搜')
  eq(shouldSearch('1+1 等于几', 'auto'), false, 'auto：算式不搜')
  eq(shouldSearch('把上面这段润色一下', 'auto'), false, 'auto：润色不搜')
  eq(shouldSearch('解释一下什么是递归', 'auto'), false, 'auto：概念解释不搜')

  // 长文多半是"让我处理这份材料"，不搜
  eq(shouldSearch('请总结以下内容：' + '这是一段很长的材料。'.repeat(40), 'auto'), false, 'auto：长材料不搜')

  // 常开档：除了空字符串之外的都搜
  ok(shouldSearch('你好', 'always'), 'always：寒暄也搜')
  ok(shouldSearch('随便什么', 'always'), 'always：必搜')

  // query 构建：短文本原样，长文本截到 128，markdown 结构被剥掉
  eq(buildSearchQuery('  今天  北京  天气  '), '今天 北京 天气', 'query 压空白')
  eq(buildSearchQuery('看这个 [链接](https://a.com) 说啥'), '看这个 链接 说啥', 'query 去 markdown 链接')
  ok(buildSearchQuery('啊'.repeat(300)).length === 128, 'query 截到 128 字符')
  eq(buildSearchQuery('```js\nvar a=1\n```\n这段代码有问题吗'), '这段代码有问题吗', 'query 去掉代码块')

  // 结果解析：过滤空项、按 rerank_score 降序
  const parsed = parseSearchResults({
    results: [
      { title: 'B', url: 'https://b.com/x', rerank_score: 1.2, summary: 's2', date: '2026-06-01T00:00:00+00:00', authority: 3 },
      { title: 'A', url: 'https://www.a.com/y', rerank_score: 2.6, summary: 's1', authority: 4 },
      { title: '', url: '' },
      null
    ]
  })
  eq(parsed.length, 2, '结果过滤空项')
  eq(parsed[0].title, 'A', '结果按分数降序')
  eq(parsed[0].score, 2.6, '保留 rerank_score')
  eq(parseSearchResults(null), [], '空响应 → 空数组')
  eq(parseSearchResults({ results: [] }), [], '无结果 → 空数组')

  // 上下文渲染
  const ctx = formatSearchContext(parsed, { max: 2, chunk: 10 })
  ok(/【联网搜索结果】/.test(ctx), '上下文带标题')
  ok(/\[1\] A/.test(ctx), '上下文编号从 1 开始')
  ok(ctx.indexOf('https://www.a.com/y') > 0, '上下文含 URL')
  ok(/发布 2026-06-01/.test(ctx), '上下文含发布日期')
  ok(/…/.test(formatSearchContext(parsed, { chunk: 1 })), '长摘要被截断')
  eq(formatSearchContext([]), '', '无结果不生成上下文')

  // 来源展示
  const srcs = searchSources(parsed, 4)
  eq(srcs.length, 2, '来源条数')
  eq(srcs[0].host, 'a.com', 'host 去掉 www.')
  eq(hostOf('https://sub.example.com/a/b?c=1'), 'sub.example.com', 'host 保留子域')
  eq(hostOf('not a url'), '', '非法 url → 空 host')

  // 注入位置：必须在最后一条 user 之前，否则 system 会变成末条
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'q2' }
  ]
  const injected = injectSearchContext(msgs, ctx)
  eq(injected.length, 5, '注入后多一条')
  eq(injected[3].role, 'system', '上下文插在最后一条 user 之前')
  eq(injected[4].content, 'q2', '最后一条仍是 user')
  eq(msgs.length, 4, '不改原数组')
  eq(injectSearchContext(msgs, ''), msgs, '空上下文原样返回')

  // describeBody 能反映"已注入"
  const b = buildBody(defaultParams(), injectSearchContext([{ role: 'user', content: 'q' }], ctx))
  ok(/联网搜索结果=已注入/.test(describeBody(b.body)), 'describeBody 标记已注入')

  // 设置归一化：searchMode 走 enum 分支，非法值回落到 off
  eq(normalizeSettings({ params: { searchMode: 'always' } }).params.searchMode, 'always', '设置保留 always')
  eq(normalizeSettings({ params: { searchMode: 'bogus' } }).params.searchMode, 'off', '设置非法值 → off')
  eq(normalizeSettings({ params: { webSearch: true } }).params.searchMode, 'off', '旧 webSearch 字段不再生效')
  eq(normalizeSettings({ params: { searchCount: 99 } }).params.searchCount, 10, 'searchCount 上限钳制')
  eq(normalizeSettings({ params: { searchCount: 0 } }).params.searchCount, 1, 'searchCount 下限钳制')

  // model 是动态字段：第三方供应商扫到的 id 必须能存住（否则切了又被弹回默认值）
  eq(normalizeSettings({ params: { model: 'deepseek-v4-pro' } }).params.model, 'deepseek-v4-pro', '内置模型 id 保留')
  eq(normalizeSettings({ params: { model: 'gpt-4o' } }).params.model, 'deepseek-flash', '未扫描的陌生 id 仍回落默认')
  eq(normalizeSettings({ models: [{ id: 'gpt-4o' }, { id: 'qwen-max' }], params: { model: 'qwen-max' } }).params.model, 'qwen-max', '扫描列表里的第三方 id 保留')
  eq(normalizeSettings({ models: [{ id: 'gpt-4o' }], params: { model: 'gpt-4o' } }).params.model, 'gpt-4o', '扫描列表里的 gpt-4o 保留')
  eq(normalizeSettings({ models: [{ id: 'gpt-4o' }], params: { model: 'qwen-max' } }).params.model, 'deepseek-flash', '不在扫描列表的 id 仍回落默认')

  // 搜索结果数在关档时置灰
  eq(scopeOf('searchCount', { searchMode: 'off' }).active, false, '关档时结果数不生效')
  eq(scopeOf('searchCount', { searchMode: 'auto' }).active, true, '自动档时结果数生效')

  // 展开后的来源行：编号从 1 起、标题太长截断、域名跟在后面
  eq(sourceLine({ title: '短标题', host: 'a.com' }, 0), '1. 短标题（a.com）', '来源行：编号+标题+域名')
  eq(sourceLine({ title: '短标题' }, 2), '3. 短标题', '来源行：没有域名就不加括号')
  eq(sourceLine({}, 0), '1. （无标题）', '来源行：无标题有兜底')
  const longT = '快讯：近期，国际金价大幅震荡。COMEX黄金上周跌幅达到4%'
  eq(sourceLine({ title: longT, host: 'x.com' }, 0).length <= 26 + 3 + 12, true, '来源行：长标题被截断')
  ok(sourceLine({ title: longT }, 0).indexOf('…') > 0, '来源行：截断处有省略号')
  eq(sourceLine({ title: '  多个   空格  ' }, 0), '1. 多个 空格', '来源行：空白折叠')

  // 设置里选「全部」→ 不截断，交给 <text> 自己折行
  eq(sourceLine({ title: longT, host: 'x.com' }, 0, true),
    '1. ' + longT + '（x.com）', '来源行：全部模式保留完整标题')
  ok(sourceLine({ title: longT }, 0, true).indexOf('…') < 0, '来源行：全部模式不加省略号')
  eq(sourceLine({ title: longT }, 0, false), sourceLine({ title: longT }, 0), '来源行：单行模式与默认一致')

  // 设置项：只认 full，其它一律单行（老配置没有这个字段）
  eq(normalizeSettings({}).sourceStyle, 'single', 'sourceStyle 缺省 → 单行')
  eq(normalizeSettings({ sourceStyle: 'full' }).sourceStyle, 'full', 'sourceStyle 保留 full')
  eq(normalizeSettings({ sourceStyle: 'bogus' }).sourceStyle, 'single', 'sourceStyle 非法值 → 单行')
}

// ---------- 应用日志 ----------
function logSuite() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

  // 版本号：日志里靠它区分用户装的是哪一版，bump 漏同步就会对不上
  eq(APP_VERSION, pkg.version, 'appversion.js 与 package.json 版本一致')
  ok(/^\d+\.\d+\.\d+$/.test(APP_VERSION), '版本号是三段式')

  resetLog()
  let got = ''
  setLogSink((t) => { got = t; return true })

  const L = logLine('E', 'saveSettings 写失败 :: ENOENT')
  ok(/^\d\d:\d\d:\d\d\.\d\d\d E /.test(L), '日志行带时间与级别', L)
  ok(L.indexOf('ENOENT') > 0, '日志行保留原因文本')
  // 错误级立即刷盘
  ok(got.indexOf('ENOENT') >= 0, '错误级日志立即写入 sink')

  // 普通级走攒批：不立刻刷，但 flushNow 能补上
  got = ''
  logLine('I', 'hello')
  eq(got, '', '普通日志不立即刷盘（攒批）')
  flushNow()
  ok(got.indexOf('hello') >= 0, 'flushNow 把攒的内容写出去')

  // 尾部读取
  resetLog()
  for (let i = 0; i < 15; i++) logLine('I', 'line-' + i)
  const tail = logTail(3)
  eq(tail.split('\n').length, 3, 'logTail 只返回指定行数')
  ok(tail.indexOf('line-14') > 0, 'logTail 结尾是最新一条')
  ok(tail.indexOf('line-11') < 0, 'logTail 不含更早的行')

  // 上限：超过 400 行丢最老的，而不是整份清空
  resetLog()
  for (let i = 0; i < 460; i++) logLine('I', 'n-' + i)
  eq(logStats().lines, 400, '超过上限后行数被压在 400')
  ok(logStats().dropped === 60, '丢弃计数正确')
  ok(logText().indexOf('n-459') > 0, '最新一条仍在缓冲里')
  ok(logText().indexOf('n-0\n') < 0, '最老的行已被丢弃')

  // 旧日志回灌要排在前面（本机没有 appendFile，只能读旧+写新）
  resetLog()
  seedLog('old-1\nold-2\n')
  logLine('I', 'new-1')
  const all = logText()
  ok(all.indexOf('old-1') === 0, 'seedLog 把旧日志放在最前')
  ok(all.indexOf('old-2') < all.indexOf('new-1'), '新日志排在旧日志之后')

  // 落盘内容超 24KB 时截断，只保留尾部
  resetLog()
  const big = 'x'.repeat(300)
  for (let i = 0; i < 200; i++) logLine('I', big)
  let written = ''
  setLogSink((t) => { written = t; return true })
  flushNow()
  ok(written.length <= 24 * 1024 + 1, '落盘文本被截到 24KB 以内', String(written.length))
  ok(written.indexOf('x'.repeat(300)) > 0, '截断后仍保留整行内容')

  // 没有 sink 时不能抛
  resetLog()
  setLogSink(null)
  eq(flushNow(), false, '无 sink 时 flushNow 返回 false 且不抛')
  logLine('E', 'no sink still ok')
  ok(logStats().hasSink === false, 'hasSink 反映真实状态')

  resetLog()
  eq(logText(), '', 'resetLog 清空缓冲')
}

logSuite()

// ---------- 写后读回判定 ----------
function saveCheckSuite() {
  const txt = '{"apiKey":"sk-xxxxxxxxxxxx"}'
  eq(judgeReadback(txt, { ok: true, text: txt }).ok, true, '读回一致即成功')

  // 本机 writeFile 会"不报错也不落盘"：读回为空必须判失败，不能因为写返回成功就放过
  const empty = judgeReadback(txt, { ok: true, text: '' })
  eq(empty.ok, false, '读回为空判失败')
  eq(empty.reason, '写后读回为空', '读回为空的原因明确')
  ok(readbackHint(empty).indexOf('没有落到磁盘') >= 0, '界面提示能说清是没落盘')

  const failedRead = judgeReadback(txt, { ok: false, text: null })
  eq(failedRead.ok, false, '读失败判失败')
  eq(failedRead.reason, '写后读回为空', '读失败与空文件同一类原因')

  const diff = judgeReadback(txt, { ok: true, text: txt.slice(0, 10) })
  eq(diff.ok, false, '读回内容不一致判失败')
  eq(diff.reason, '写后读回不一致', '不一致的原因明确')
  eq(diff.wantLen, txt.length, '带上期望长度便于对日志')
  eq(diff.gotLen, 10, '带上实际长度便于对日志')
  ok(readbackHint(diff).indexOf('不一致') >= 0, '不一致的提示文案')

  eq(judgeReadback('', { ok: true, text: '' }).ok, false, '空期望 + 空读回也视为失败')
  eq(readbackHint({ ok: true }), '', '成功时不显示提示')
  eq(readbackHint(null), '', '空结果不显示提示')
}

saveCheckSuite()

// ---------- 目录逐级创建规划 ----------
function dirChainSuite() {
  const base = '/userdisk/secondary/miniapp/data/mini_app/pkg/8000000000182399/data'

  eq(normPath('a//b///'), 'a/b', '归一化合并重复斜杠与尾斜杠')
  eq(normPath('/'), '/', '根目录不被归一化成空串')
  eq(normPath(''), '', '空路径保持空串')
  eq(normPath(null), '', 'null 归一化成空串')

  // 本机 fs.mkdir 只建最后一级，所以中间每一级都得在列表里，顺序由浅到深
  eq(mkdirChain(base, base + '/deepseek'),
    [base, base + '/deepseek'], '建 deepseek 要先建 dataDir 本身')
  eq(mkdirChain(base, base + '/deepseek/tmp'),
    [base, base + '/deepseek', base + '/deepseek/tmp'], '三级目录逐段建')
  eq(mkdirChain(base, base), [base], '目标就是 dataDir 时只建它自己')
  eq(mkdirChain(base, base + '//deepseek///'),
    [base, base + '/deepseek'], '目标带重复斜杠也能正确拆段')

  // 越权保护：不在 dataDir 之下就不逐段建，免得造出框架不认识的目录
  eq(mkdirChain(base, '/userdisk/Pictures'), ['/userdisk/Pictures'], 'dataDir 之外只建目标本身')
  eq(mkdirChain(base, ''), [], '空目标不建任何目录')
  eq(mkdirChain('', '/tmp/x'), ['/tmp/x'], 'base 为空时退回只建目标')

  // 前缀相同但不是子目录（data2 ≠ data 的子目录），不能误判成子路径
  eq(mkdirChain('/a/b', '/a/bc'), ['/a/bc'], '前缀相同但不是子目录不逐段建')
}

function writePlanSuite() {
  // 这条链的由来：fs.writeFile 并非所有固件都有（文档里的 fs 根本没写这个方法），
  // 缺了就是 "TypeError: not a function"，保存全挂、日志也写不进。所以按顺序兜底。

  eq(WRITE_ORDER, ['fs.writeFile', 'fs.writeFileSync', 'shell'], '候选顺序固定')

  // 三样都有 → 按优先级全排上
  eq(planWrites({ 'fs.writeFile': true, 'fs.writeFileSync': true, shell: true }, ''),
    ['fs.writeFile', 'fs.writeFileSync', 'shell'], '都有时按优先级排')

  // 目标机型：没有 writeFile / writeFileSync，只剩 shell
  eq(planWrites({ shell: true }, ''), ['shell'], '只有 execShell 时兜底到 shell')

  // 上一轮成功过的通道排最前（省掉每次重试失败的调用）
  eq(planWrites({ 'fs.writeFile': true, shell: true }, 'shell'),
    ['shell', 'fs.writeFile'], '上次成功的通道优先')

  // 缓存里记的通道这次不存在了 → 忽略，别把不存在的东西排进列表
  eq(planWrites({ shell: true }, 'fs.writeFile'), ['shell'], '缓存通道消失了就不排它')
  eq(planWrites({ 'fs.writeFile': true }, 'unix.write'), ['fs.writeFile'], '不认识的通道名被忽略')

  // 什么都不具备 → 空列表（调用方拿到空计划时直接判失败，不要再瞎调）
  eq(planWrites({}, ''), [], '没有任何通道时返回空计划')
  eq(planWrites(null, ''), [], 'available 为空也返回空计划')

  // 失败信息：一条也能读，多条用 | 拼
  ok(describeWriteFail([]).indexOf('没有可用') >= 0, '无失败记录时给出总括')
  eq(describeWriteFail([{ backend: 'fs.writeFile', error: 'not a function' }]),
    'fs.writeFile :: not a function', '单条失败信息带通道名')
  eq(describeWriteFail([{ backend: 'fs.writeFile', error: 'x' }, { backend: 'shell', error: 'y' }]),
    'fs.writeFile :: x | shell :: y', '多条失败信息按顺序拼接')
}

dirChainSuite()

writePlanSuite()

function msgSuite() {
  // 单句操作（重新生成 / 修改内容）的截断边界。
  // 这是"删错一格就丢用户数据"的地方，边界必须逐条钉死。

  const u1 = { id: 'u1', role: 'user', content: 'q1' }
  const a1 = { id: 'a1', role: 'assistant', content: 'r1' }
  const u2 = { id: 'u2', role: 'user', content: 'q2' }
  const a2 = { id: 'a2', role: 'assistant', content: 'r2' }
  const list = [u1, a1, u2, a2]

  eq(findMessageIndex(list, 'u2'), 2, '按 id 找下标')
  eq(findMessageIndex(list, 'nope'), -1, '找不到返回 -1')

  // 最后一条 assistant：keep = 它自己的下标（自己及之后全删），tail = 0（不弹确认）
  eq(planRegenerate(list, 'a2'), { index: 3, role: 'assistant', keep: 3, promptId: 'u2', tail: 0, tailForPrompt: 0 },
    '重抽最后一条回答：从它自己开始删、用上一条提问')
  // 中间那条 assistant：tail = 1，要确认
  eq(planRegenerate(list, 'a1').tail, 2, '重抽中间回答：后面还有 2 条（提问+回答），需要确认')
  eq(planRegenerate(list, 'a1').keep, 1, '重抽中间回答：保留前 1 条')
  eq(planRegenerate(list, 'a1').promptId, 'u1', '重抽中间回答：提问取前面最近的那句')

  // user 消息：保留自己（keep = i+1），后面全删
  eq(planRegenerate(list, 'u2'), { index: 2, role: 'user', keep: 3, promptId: 'u2', tail: 1, tailForPrompt: 1 },
    '重抽用户消息：保留提问本身、删掉后面的回答')
  eq(planRegenerate(list, 'u1').keep, 1, '重抽第一条提问：只保留它自己')

  // 第一条就是 assistant（前面没有提问）→ 不能操作
  eq(planRegenerate([a1, u1], 'a1'), null, '前面没有提问时返回 null')

  // 修改内容
  eq(planEdit(list, 'a2'), { index: 3, role: 'assistant', rerun: false, keep: 4, tail: 0 }, '改最后一条回答：只改文字不重跑')
  eq(planEdit(list, 'a1'), { index: 1, role: 'assistant', rerun: false, keep: 4, tail: 2 }, '改中间回答：后面内容保持不动')
  eq(planEdit(list, 'u2'), { index: 2, role: 'user', rerun: true, keep: 3, tail: 1 }, '改提问：清掉后面的回答并重跑')
  eq(planEdit(list, 'u1').keep, 1, '改第一条提问：keep 只留在它自己之后')
  eq(planEdit(list, 'nope'), null, '找不到消息时返回 null')

  // 空列表不该炸
  eq(planRegenerate([], 'x'), null, '空列表重抽返回 null')
  eq(planEdit([], 'x'), null, '空列表修改返回 null')
}

// ---------- 设置分类 ----------
function sectionsSuite() {
  eq(sectionsFor('chat').length, 7, '聊天模式 7 个分类页（含地图与天气）')
  eq(sectionsFor('role').length, 7, '扮演模式多一个人设页')
  eq(sectionsFor('role')[0].id, 'persona', '人设页排第一')
  // 地图只在聊天模式：扮演模式要专注角色对话，不放设备类功能
  ok(sectionsFor('chat').some((x) => x.id === 'tool'), '聊天模式有「地图与天气」页')
  ok(!sectionsFor('role').some((x) => x.id === 'tool'), '扮演模式没有「地图与天气」页')
  ok(hasGroup(sectionById('chat', 'tool'), 'tool'), '地图页含 tool 分组')
  eq(sectionStatus('tool', { hasAmapKey: false }), '未填高德 Key', '没配 Key 的地图卡片文案')
  ok(sectionStatus('tool', { hasAmapKey: true, amapKeyMask: '148c****021a' }).indexOf('148c****021a') >= 0, '配了 Key 显示掩码')
  eq(sectionById('role', 'nope').id, 'persona', '未知分类回落到第一个')
  ok(hasGroup(sectionById('chat', 'talk'), 'memory'), '对话页包含记忆分组')
  ok(!hasGroup(sectionById('chat', 'view'), 'memory'), '界面页不含记忆分组')

  // 连接卡片：直接报余额和峰谷剩余时间，不再用「有余额」这种看不出数的说法
  eq(sectionStatus('conn', { hasKey: false }), '未填 Key', '没 Key 就报没 Key')
  eq(sectionStatus('conn', { hasKey: true }), '已填 Key · 未查余额', '有 Key 没查到余额时的文案')
  eq(sectionStatus('conn', { hasKey: true, balanceText: '¥12.93', periodText: '距转谷 1 小时 20 分' }),
    '¥12.93 · 距转谷 1 小时 20 分', '有余额就报数字 + 峰谷剩余')
  ok(sectionStatus('conn', { hasKey: true, balanceText: '¥12.93' }).indexOf('有余额') < 0, '不再出现「有余额」')
  eq(sectionStatus('talk', { memoryOn: true, memoryCount: 3 }), '记忆已开 · 3 条', '记忆卡片状态')
  eq(sectionStatus('data', { convCount: 0 }), '还没有对话', '空对话状态')
}

// ---------- 设置档案（模式 / 人设）----------
function profileSuite() {
  // v1 老文件：整份就是聊天模式设置
  const v1 = { apiKey: 'sk-123456789012', baseUrl: 'https://api.deepseek.com/v1', params: { model: 'x' }, updatedAt: 5 }
  const d1 = normalizeDoc(v1)
  eq(d1.version, DOC_VERSION, 'v1 文件升级到 v2 结构')
  eq(d1.mode, 'chat', 'v1 文件默认聊天模式')
  eq(d1.chat.apiKey, 'sk-123456789012', 'v1 的 Key 落进 chat 槽')
  eq(d1.role.personas.length, 0, 'v1 文件没有预设人设')
  eq(profileKey(d1), 'chat', '聊天模式档案名')

  // 铺平：页面读到的就是 chat 那份
  eq(pickProfile(d1).apiKey, 'sk-123456789012', '铺平后拿得到 Key')
  eq(pickProfile(d1).mode, 'chat', '铺平后带模式标记')

  // 写回只动当前槽
  writeProfile(d1, Object.assign({}, pickProfile(d1), { apiKey: 'sk-new-key-000000' }))
  eq(d1.chat.apiKey, 'sk-new-key-000000', '写回落在 chat 槽')

  // 切到扮演模式：没有人设时自动建一个（否则界面会显示"没有 Key"，像坏了）
  setMode(d1, 'role')
  eq(d1.mode, 'role', '切到扮演模式')
  eq(d1.role.personas.length, 1, '第一次进扮演模式自动建人设')
  eq(d1.chat.apiKey, 'sk-new-key-000000', '建人设不影响聊天模式那份')

  const p1 = d1.role.personas[0]
  // 新建时只沿用"连接"这一段，参数 / 提示词仍是各自独立的默认值
  eq(p1.settings.apiKey, 'sk-new-key-000000', '新人设沿用连接信息（各存一份）')
  eq(p1.settings.params.model, 'deepseek-flash', '新人设的参数是默认值，不跟着聊天模式')
  eq(profileKey(d1), 'role_' + p1.id, '扮演模式档案名带人设 id')

  // 两个人设互不干扰
  const id2 = addPersona(d1, { name: '小美' })
  ok(!!id2, '新增人设返回 id')
  eq(d1.role.personas.length, 2, '两个人设')
  setActivePersona(d1, id2)
  writeProfile(d1, Object.assign({}, pickProfile(d1), { apiKey: 'sk-mei-0000000000' }))
  eq(findPersona(d1, id2).settings.apiKey, 'sk-mei-0000000000', '写入落在当前人设')
  eq(findPersona(d1, p1.id).settings.apiKey, 'sk-new-key-000000', '另一个人设不受影响')

  // 改名 / 改卡
  ok(renamePersona(d1, id2, '阿美'), '改名成功')
  eq(findPersona(d1, id2).name, '阿美', '名字已更新')
  ok(!renamePersona(d1, id2, '   '), '空名字不生效')
  ok(setPersonaCard(d1, id2, { name: '阿美', description: '温柔' }), '写角色卡')
  eq(findPersona(d1, id2).card.description, '温柔', '角色卡字段已存')

  // 「与 XX 一致」= 整包复制，之后各改各的
  cloneProfile(d1.chat, 'role', d1)
  eq(findPersona(d1, id2).settings.apiKey, 'sk-new-key-000000', '复制聊天模式设置到当前人设')
  writeProfile(d1, Object.assign({}, pickProfile(d1), { apiKey: 'only-me' }))
  eq(d1.chat.apiKey, 'sk-new-key-000000', '复制之后再改不会反向影响源')

  // 上限
  for (let i = 0; i < 20; i++) addPersona(d1, { name: 'p' + i })
  eq(d1.role.personas.length, MAX_PERSONAS, '人设有数量上限')

  // 删到最后一个人设时不允许（扮演模式没有"零人设"状态）
  const d2 = normalizeDoc({ version: 2, mode: 'role', chat: {}, role: { activeId: 'a', personas: [{ id: 'a', name: 'A' }] } })
  ok(!removePersona(d2, 'a'), '不能删掉最后一个人设')
  const d3 = normalizeDoc({ version: 2, mode: 'role', chat: {}, role: { activeId: 'a', personas: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } })
  ok(removePersona(d3, 'a'), '有人设可删')
  eq(d3.role.activeId, 'b', '删掉当前人设后自动指向剩下的')

  // 指向不存在的人设 → 回落到第一个
  const d4 = normalizeDoc({ version: 2, mode: 'role', chat: {}, role: { activeId: 'zzz', personas: [{ id: 'a', name: 'A' }] } })
  eq(d4.role.activeId, 'a', 'activeId 失效时回落')

  eq(personasBrief(d3).length, 1, '人设简介列表')
}

// ---------- 人设卡 ----------
function personaSuite() {
  const v2 = normalizeCard({
    spec: 'chara_card_v2', spec_version: '2.0',
    data: { name: '小美', description: '十七岁的邻居', personality: '害羞', scenario: '夏天的走廊', first_mes: '你回来啦', mes_example: 'U: 早\nA: 早呀', creator_notes: 'x', tags: ['日常'] }
  })
  eq(v2.name, '小美', 'v2 角色卡取到名字')
  eq(v2.description, '十七岁的邻居', 'v2 取到设定')
  eq(v2.firstMessage, '你回来啦', 'v2 取到开场白(first_mes)')
  eq(v2.exampleDialogue.indexOf('早呀') >= 0, true, 'v2 取到示例对话(mes_example)')

  const flat = normalizeCard({ name: '阿强', description: '程序员' })
  eq(flat.name, '阿强', '扁平角色卡也能读')
  ok(cardIsEmpty({}), '空卡判空')
  ok(!cardIsEmpty(flat), '有名字不算空')

  const sys = personaSystemPrompt(v2, '不要说教')
  ok(sys.indexOf('小美') >= 0, '系统提示词里有人名')
  ok(sys.indexOf('夏天的走廊') >= 0, '系统提示词带日常背景')
  ok(sys.indexOf('不要跳出角色') >= 0, '提示词保留不跳出角色')
  ok(sys.indexOf('【日常背景】') >= 0, '场景按“日常背景”注入')
  ok(sys.indexOf('【场景】') < 0, '不再用“场景”这个戏剧化说法')
  ok(sys.indexOf('不写旁白') >= 0 && sys.indexOf('不描写环境') >= 0, '提示词禁止旁白与环境描写')
  ok(sys.indexOf('不用描写') >= 0, '背景声明“不用描写”')
  ok(sys.indexOf('不要说教') >= 0, '补充要求接在后面')
  ok(sys.indexOf('好感度') < 0, '没写自定义规则时不会凭空出现好感度')

  // ---- 自定义字段：真实卡片的灵魂，以前被静默丢掉 ----
  const whale = parsePersonaFile(JSON.stringify({
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: '蓝鲸损友娘', description: '圆滚滚的蓝色小鲸鱼',
      personality: 'x'.repeat(1246),
      affection_rules: '初始 LV1（0/100），最高 LV5',
      tags: ['日常'], creator: '某人', character_version: '2.0'
    }
  }), 'whale.json')
  ok(whale.ok, '带自定义字段的卡能导入')
  eq(whale.card.personality.length, 1246, '1246 字的性格不再被 1200 截断')
  ok(whale.card.custom.indexOf('【好感度规则】') >= 0, 'affection_rules 用中文标题')
  ok(whale.card.custom.indexOf('最高 LV5') >= 0, '好感度规则内容保留')
  ok(whale.card.custom.indexOf('某人') < 0, 'creator 这类元数据不进提示词')
  eq(whale.card.customKeys.join(','), 'affection_rules', '记录自定义键名')
  const wsys = personaSystemPrompt(whale.card)
  ok(wsys.indexOf('最高 LV5') >= 0, '好感度规则进了系统提示词')
  ok(wsys.indexOf('不写旁白') >= 0, '陪伴约束仍在')

  const cat = normalizeCard({
    name: '魅魔猫娘',
    personality_tags: ['PLAYFUL', 'CATLIKE'],
    roleplay_rules: { identity: '成年魅魔猫娘', catlike_behavior: true, mandatory_suffix: '主人~' },
    timeout_signal: { trigger: 'TIMEOUT_SIGNAL', behavior: '立即暂停' }
  })
  ok(cat.custom.indexOf('PLAYFUL、CATLIKE') >= 0, '数组用顿号展开')
  ok(cat.custom.indexOf('identity：成年魅魔猫娘') >= 0, '对象拆成 子键：值')
  ok(cat.custom.indexOf('catlike_behavior：是') >= 0, '布尔转中文')
  ok(cat.custom.indexOf('【扮演规则】') >= 0, 'roleplay_rules 有中文标题')
  ok(cat.custom.indexOf('【暂停信号】') >= 0, 'timeout_signal 有中文标题')

  const twice = normalizeCard(cat)
  eq(twice.custom, cat.custom, '重复归一化不会把自定义块套两层')
  eq(twice.customKeys.join(','), cat.customKeys.join(','), '重复归一化保留键名清单')

  const outCard = buildPersonaCardDoc(whale.card)
  eq(outCard.data.custom_rules, whale.card.custom, '导出带 custom_rules')
  const backCard = parsePersonaFile(JSON.stringify(outCard), 'w.json')
  eq(backCard.card.custom, whale.card.custom, '导出再导入不丢自定义规则')

  eq(greetingOf(v2), '你回来啦', '开场白取得到')
  eq(greetingOf({}), '', '没填开场白就是空')
  eq(CARD_ROWS.filter((r) => r.key === 'scenario')[0].label, '日常背景', '编辑行叫“日常背景”')

  eq(nameFromFile('/userdisk/a/温柔学姐_v2.json'), '温柔学姐 v2', '文件名转名字')
  eq(nameFromFile('prompt.md'), 'prompt', '去掉扩展名')

  const p = parsePersonaFile('你是一个猫娘，说话带喵。', 'cat.txt')
  ok(p.ok, '文本提示词可解析')
  eq(p.kind, 'prompt', '识别为提示词')
  eq(p.card.name, 'cat', '名字取文件名')
  ok(p.card.description.indexOf('猫娘') >= 0, '正文进设定')

  const j = parsePersonaFile(JSON.stringify({ spec: 'chara_card_v2', data: { name: '阿花', description: '卖花' } }), 'a.json')
  ok(j.ok, 'JSON 角色卡可解析')
  eq(j.card.name, '阿花', 'JSON 角色卡名字')

  ok(!parsePersonaFile('not json', 'x.json').ok, '坏 JSON 报错')
  ok(!parsePersonaFile('x', 'x.png').ok, '不支持的扩展名报错')
}

// ---------- 上下文压缩与记忆 ----------
function memorySuite() {
  const m = normalizeMemory(null)
  eq(m.on, true, '记忆默认开启')
  eq(m.lines, MEMORY_DEFAULT.lines, '默认条数')
  eq(normalizeMemory({ on: false, lines: 999 }).lines, 60, '条数上限钳位')
  eq(normalizeMemory({ lines: 1 }).lines, 6, '条数下限钳位')
  eq(normalizeMemory({ on: false }).on, false, '显式关掉才关')

  const msgs = []
  for (let i = 0; i < 6; i++) {
    msgs.push({ id: 'u' + i, role: 'user', content: '问' + i + ' ' + 'x'.repeat(200), createdAt: i })
    msgs.push({ id: 'a' + i, role: 'assistant', content: '答' + i + ' ' + 'y'.repeat(300), createdAt: i })
  }
  const e = memoryEntry(msgs[0])
  eq(e.role, 'user', '摘要条目记角色')
  ok(e.text.length <= 61, '用户那句摘要截断到 60 字')
  eq(memoryEntry({ id: 'z', role: 'assistant', content: '', error: 'x' }), null, '报错/空消息不进记忆')

  const f1 = foldMessages([], msgs, { lines: 24 })
  eq(f1.added, 12, '一批消息全部折进记忆')
  eq(f1.notes.length, 12, '记忆条数')
  // 再折一次：按 id 去重，不会翻倍
  const f2 = foldMessages(f1.notes, msgs, { lines: 24 })
  eq(f2.added, 0, '同一条消息不会重复记忆')
  // 超上限丢最旧的
  const f3 = foldMessages(f1.notes, [{ id: 'new1', role: 'user', content: '新的话' }], { lines: 6 })
  eq(f3.notes.length, 6, '记忆条数被裁到上限')
  eq(f3.notes[5].id, 'new1', '保留的是最新那条')

  const text = memoryText(f1.notes)
  ok(text.indexOf('我：问0') >= 0, '记忆正文带"我："前缀')
  ok(text.indexOf('AI：答0') >= 0, '记忆正文带"AI："前缀')
  eq(memoryText([]), '', '没有记忆时返回空串')

  const sum = memorySummary(f1.notes)
  eq(sum.count, 12, '统计条数')
  ok(sum.chars > 0, '统计字数')

  // 压缩计划：超出窗口的部分才是要折叠的
  const plan = planCompression(msgs, 4, true)
  eq(plan.keep.length, 4, '保留窗口内的消息')
  eq(plan.drop.length, 8, '窗口外的消息进折叠')
  const off = planCompression(msgs, 4, false)
  eq(off.drop.length, 0, '记忆关掉时不产生折叠')
  eq(off.keep.length, 4, '记忆关掉时仍然按窗口截断')
  // pending / 报错消息不参与
  const withBad = msgs.slice(0, 3).concat([{ id: 'p', role: 'assistant', content: '', pending: true }])
  eq(planCompression(withBad, 10, true).keep.length, 3, 'pending 消息不计入')
  // maxHistory=0 是合法设置：一条历史都不带，全部折叠
  const zero = planCompression(msgs, 0, true)
  eq(zero.keep.length, 0, 'maxHistory=0 时不带任何历史')
  eq(zero.drop.length, 12, 'maxHistory=0 时全部进折叠')
  eq(pruneNotes([{ id: 'a', text: 'x' }, { text: 'no id' }], 10).length, 1, '没有 id 的条目被丢掉')

  // 清空记忆的水位：更早的消息不再折回来
  const timed = [{ id: 'o1', createdAt: 100 }, { id: 'o2', createdAt: 200 }, { id: 'n1', createdAt: 300 }]
  eq(notesAfter(timed, 0).length, 3, '没清空过（floor=0）时全部参与折叠')
  eq(notesAfter(timed, 200).length, 1, '水位当刻及更早的消息被挡掉')
  eq(notesAfter(timed, 200)[0].id, 'n1', '只留下水位之后的消息')
  eq(notesAfter(null, 200).length, 0, '空列表不炸')
  eq(notesAfter([{ id: 'x' }], 200).length, 0, '没有 createdAt 的当作最旧')
}

// ---------- 存档导出 / 导入 ----------
function archiveSuite() {
  const settings = {
    apiKey: 'sk-archive-000000', baseUrl: 'https://api.deepseek.com/v1', systemPrompt: '你是助手',
    maxHistory: 8, saveMode: 'auto', showBalance: false, sourceStyle: 'full',
    memory: { on: true, lines: 30 }, params: { model: 'deepseek-flash', thinking: true }
  }
  const convs = [{
    id: 'c1', title: '你好', createdAt: 1000, updatedAt: 2000,
    messages: [
      { id: 'u1', role: 'user', content: '在吗', createdAt: 1001 },
      { id: 'a1', role: 'assistant', content: '在', reasoning: '思考', createdAt: 1002 },
      { id: 'a2', role: 'assistant', content: '', pending: true, createdAt: 1003 }
    ]
  }]
  const notes = [{ id: 'u0', at: 900, role: 'user', text: '更早的话' }]

  const sd = buildSettingsDoc({ at: 1761000000000, mode: 'role', personaId: 'p_a', personaName: '小美', card: { name: '小美' }, settings: settings })
  eq(sd.version, 1, '存档带版本号')
  ok(!!sd.exportDate, '存档带 exportDate')
  eq(detectKind(sd), 'settings', '设置档可被识别')
  const sp = parseSettingsArchive(JSON.stringify(sd))
  ok(sp.ok, '设置档可解析')
  eq(sp.settings.apiKey, 'sk-archive-000000', 'Key 往返一致（备份就是要能恢复）')
  eq(sp.settings.maxHistory, 8, '数值字段往返')
  eq(sp.settings.memory.lines, 30, '记忆设置往返')
  eq(sp.settings.params.model, 'deepseek-flash', '参数往返')
  eq(sp.name, '小美', '人设名往返')

  const rd = buildRecordsDoc({
    at: 1761000000000, mode: 'role', personaId: 'p_a', personaName: '小美',
    card: { name: '小美' }, settings: settings, personaPrompt: '扮演小美', convs: convs, notes: notes
  })
  eq(detectKind(rd), 'records', '记录档可被识别')
  eq(rd.data.gameData.playerProgress.conversationCount, 1, '记录档统计对话数')
  eq(rd.data.gameData.playerProgress.messageCount, 2, '记录档统计消息数（跳过 pending）')
  ok(rd.data.gameData.timeSystem.updatedAt > 0, '记录档带时间系统')
  ok(rd.data.gameData.prompts.persona.indexOf('扮演') >= 0, '记录档带人设提示词')
  // 需求明确：不要人物数值类字段
  ok(!rd.data.gameData.characterStats, '记录档没有 characterStats')
  ok(JSON.stringify(rd.data.gameData).indexOf('favorability') < 0, '记录档没有好感度')
  ok(JSON.stringify(rd.data).indexOf('inventory') < 0, '记录档没有背包/商店')

  const rp = parseRecordsArchive(JSON.stringify(rd))
  ok(rp.ok, '记录档可解析')
  eq(rp.convs.length, 1, '记录档对话数往返')
  eq(rp.convs[0].messages.length, 2, '记录档消息数往返')
  eq(rp.convs[0].messages[1].reasoning, '思考', '思考过程往返')
  eq(rp.notes.length, 1, '记忆往返')
  eq(rp.card.name, '小美', '记录档里也带角色卡')

  const info = archiveSummary(rd)
  eq(info.kind, 'records', '简介识别类型')
  eq(info.sessions, 1, '简介带对话数')
  eq(info.messages, 2, '简介带消息数')

  eq(profileFolder('chat'), 'chat', '聊天模式导出目录名')
  ok(profileFolder('role_p_abc123', '小美').indexOf('小美') === 0, '人设目录名带人设名')
  ok(stampText(1761000000000).length >= 16, '时间戳可读')

  // 人设卡导出：能拷走、能导回来
  const cd = buildPersonaCardDoc({ name: '小美', description: '隔壁的猫', personality: '懒', firstMessage: '喵', exampleDialogue: 'u:hi' })
  eq(cd.spec, 'chara_card_v2', '人设卡用社区通用格式')
  eq(cd.data.first_mes, '喵', '开场白写成 first_mes')
  eq(cd.data.mes_example, 'u:hi', '对话示例写成 mes_example')
  ok(cd.data.creator_notes.length > 0, '导出时补一条来源说明')
  const back = parsePersonaFile(JSON.stringify(cd), '小美.json')
  ok(back.ok, '导出的文件能被导入解析')
  eq(back.name, '小美', '导出→导入名字不变')
  eq(back.card.description, '隔壁的猫', '导出→导入设定不变')
  eq(back.card.firstMessage, '喵', '导出→导入开场白不变')

  eq(personaFileName('小 美/1'), '小_美_1.json', '文件名去掉路径符号、保留中文')
  eq(personaFileName(''), 'persona.json', '空名字有兜底')
  const sample = buildPersonaSampleDoc(1761000000000)
  ok(parsePersonaFile(JSON.stringify(sample), 'sample_card.json').ok, '示例文件本身就能被导入')
  ok(sample.data.creator_notes.indexOf('import') >= 0, '示例里写了导入路径')

  // 导出根目录必须在 Favorite 下：这是连电脑后用户唯一不用记应用名就能找到的地方
  // （注意设备上是首字母大写的 Favorite，路径大小写敏感）；
  // 外面还要套一层应用名，三个子目录别直接铺在系统的 Favorite 根上
  eq(ROOT_DIR, '/userdisk/Favorite/deepseek-pen', '导出根目录是 Favorite/deepseek-pen')
  eq(EXPORT_DIR, '/userdisk/Favorite/deepseek-pen/export', '存档目录在应用目录/export')
  eq(IMPORT_DIR, '/userdisk/Favorite/deepseek-pen/import', '导入目录在应用目录/import')
  eq(PERSONA_DIR, '/userdisk/Favorite/deepseek-pen/persona', '人设目录在应用目录/persona')
  ok(sample.data.creator_notes.indexOf('/userdisk/Favorite/deepseek-pen/import/') >= 0, '示例里的导入路径与常量一致')

  // 垃圾输入不能抛
  ok(!parseSettingsArchive('not json').ok, '坏 JSON 报错')
  ok(!parseSettingsArchive(JSON.stringify({ a: 1 })).ok, '不认识的 JSON 报错')
  ok(!parseRecordsArchive(JSON.stringify(sd)).ok, '把设置档当记录档导入会报错')
}

profileSuite()
personaSuite()
memorySuite()
archiveSuite()
sectionsSuite()

msgSuite()

searchSuite()

// ---------- 高德地图 ----------
function amapSuite() {
  eq(AMAP_BASE, 'https://restapi.amap.com/v3', '高德 base')

  // Key 就绪判断
  ok(amapReady('0123456789abcdef0123456789abcdef'), '32位Key判为就绪')
  ok(!amapReady('abc'), '短Key判为没填')
  ok(!amapReady(''), '空串判为没填')
  ok(!amapReady(null), 'null 不抛')
  eq(amapKeyOf('  kk  '), 'kk', 'Key 去空格')

  // URL 拼接：空参数不带出去，中文要编码
  const u1 = placeSearchUrl({ key: 'K', keywords: '天安门', city: '北京', offset: 5 })
  ok(u1.indexOf('/place/text?') > 0, '地点搜索走 place/text')
  ok(u1.indexOf('keywords=%E5%A4%A9%E5%AE%89%E9%97%A8') > 0, '中文关键词被编码')
  ok(u1.indexOf('city=%E5%8C%97%E4%BA%AC') > 0, '城市被编码')
  ok(u1.indexOf('offset=5') > 0, 'offset 透传')
  ok(u1.indexOf('key=K') > 0, 'key 透传')
  ok(u1.indexOf('extensions=base') > 0, '默认只要 base 扩展')

  const u2 = placeSearchUrl({ key: 'K', keywords: 'x' })
  ok(u2.indexOf('city=') < 0, '没传 city 就不带空参')
  ok(u2.indexOf('offset=10') > 0, 'offset 默认 10')
  ok(u2.indexOf('page=1') > 0, 'page 默认 1')

  // 越界值要夹住，不把错误参数发给服务端
  const u3 = placeSearchUrl({ key: 'K', keywords: 'x', offset: 999, page: 0 })
  ok(u3.indexOf('offset=25') > 0, 'offset 上限 25')
  ok(u3.indexOf('page=1') > 0, 'page 下限 1')

  // 周边搜索必须有 location，radius 有默认
  const u4 = placeAroundUrl({ key: 'K', location: '116.3,39.9', keywords: '咖啡' })
  ok(u4.indexOf('/place/around') > 0, '周边搜索走 place/around')
  ok(u4.indexOf('location=116.3%2C39.9') > 0, '坐标逗号被编码')
  ok(u4.indexOf('radius=3000') > 0, 'radius 默认 3000')

  // 天气：实时 vs 预报是同一个接口不同 extensions
  const uw = weatherUrl({ key: 'K', city: '110000' })
  ok(uw.indexOf('/weather/weatherInfo') > 0, '天气接口路径')
  ok(uw.indexOf('extensions=base') > 0, '实时天气用 base')
  const uwf = weatherUrl({ key: 'K', city: '110000', forecast: true })
  ok(uwf.indexOf('extensions=all') > 0, '预报用 all')

  // 地理编码 / 逆地理 / 驾车
  ok(geocodeUrl({ key: 'K', address: '中关村' }).indexOf('/geocode/geo') > 0, '地理编码路径')
  ok(regeoUrl({ key: 'K', location: '116.3,39.9' }).indexOf('/geocode/regeo') > 0, '逆地理路径')
  ok(drivingUrl({ key: 'K', origin: 'a', destination: 'b' }).indexOf('/direction/driving') > 0, '驾车路径')

  // 解析：成功
  const okBody = JSON.stringify({
    status: '1', count: '2', info: 'OK', infocode: '10000',
    pois: [
      { id: 'B1', name: '天安门', address: '长安街北侧', type: '风景名胜;风景名胜;国家级景点', tel: '010-1', cityname: '北京市', adname: '东城区', location: '116.397463,39.909187' },
      { id: 'B2', name: '天安门广场', address: '东长安街', type: '风景名胜;公园广场;城市广场', location: '116.397755,39.903182', distance: '320' }
    ]
  })
  const r1 = parseAmap(okBody)
  ok(r1.ok, 'status:"1" 判成功')
  eq(r1.error, '', '成功时无错误文案')
  // 契约：成功时解析结果在 obj 里（不是 data）。services 层把 data 当解析结果用过一次，
  // 症状是"Key 能用但没数据"，查了半天 —— 这条断言就是为了钉住这个字段名
  ok(!!r1.obj && Array.isArray(r1.obj.pois), 'parseAmap 成功时结果在 obj 字段')
  eq(r1.data, undefined, 'parseAmap 没有 data 字段（别记错名字）')
  const pois = poiList(r1.obj)
  eq(pois.length, 2, '解析出两个 POI')
  eq(pois[0].name, '天安门', 'POI 名称')
  eq(pois[0].lng, '116.397463', '经度拆出来（lng 在前）')
  eq(pois[0].lat, '39.909187', '纬度拆出来')
  eq(pois[0].type, '国家级景点', 'type 取最后一级')
  eq(pois[1].distance, '320', '周边搜索的 distance 保留')
  eq(pois[0].distance, '', '没有 distance 时给空串')
  eq(pois[0].city, '北京市', '城市名')

  // 解析：失败（HTTP 200 + status 0，这是高德最容易踩的坑）
  const badBody = JSON.stringify({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' })
  const r2 = parseAmap(badBody)
  ok(!r2.ok, 'status:"0" 判失败')
  ok(r2.error.indexOf('Key 无效') >= 0, '10001 转成人话')
  eq(amapErrorText('10003'), '今日配额已用完，明天 0 点恢复（个人开发者额度较小）', '10003 配额文案')
  ok(amapErrorText('10009').indexOf('Web服务') >= 0, '10009 提示要用 Web服务 Key')
  ok(amapErrorText('99999', 'WHATEVER').indexOf('WHATEVER') >= 0, '未知码带上原文')
  ok(amapErrorText('', '').indexOf('未知') >= 0, '全空也不崩')
  ok(!!AMAP_CODES['10002'], '错误码表有 10002')

  // 解析：脏输入
  ok(!parseAmap('').ok, '空 body 报错')
  ok(!parseAmap('not json').ok, '非 JSON 报错')
  ok(!parseAmap('<html>502</html>').ok, 'HTML 网关页识别出来')
  ok(parseAmap('<html>502</html>').error.indexOf('网关') >= 0, 'HTML 给网关提示')
  ok(!parseAmap('null').ok, 'null 报错')
  ok(!parseAmap('[1,2]').ok, '数组当响应报错')

  // 天气解析
  const wBody = JSON.stringify({
    status: '1', count: '1', info: 'OK', infocode: '10000',
    lives: [{ province: '北京', city: '北京市', adcode: '110000', weather: '晴', temperature: '13', winddirection: '北', windpower: '≤3', humidity: '24', reporttime: '2026-10-30 22:39:20' }]
  })
  const w = weatherNow(parseAmap(wBody).obj)
  eq(w.city, '北京市', '天气城市')
  eq(w.weather, '晴', '天气现象')
  eq(w.temperature, '13', '温度是字符串（高德全是字符串）')
  eq(weatherLine(w), '北京市 晴 13°C', '天气一句话')
  const wrows = weatherRows(w)
  ok(wrows.length >= 4, '天气详情行数')
  eq(wrows[0].label, '天气', '第一行是天气')
  ok(wrows[1].value.indexOf('级') > 0, '风力带"级"')
  ok(wrows[2].value.indexOf('%') > 0, '湿度带百分号')
  eq(weatherNow({ status: '1' }), null, '没有 lives 返回 null')
  eq(weatherNow(null), null, 'null 不抛')

  // 预报解析
  const fBody = JSON.stringify({
    status: '1', forecasts: [{ city: '北京市', casts: [
      { date: '2026-10-31', dayweather: '晴', nightweather: '多云', daytemp: '18', nighttemp: '6', daywind: '北风', daypower: '3' },
      { date: '2026-11-01', dayweather: '阴', nightweather: '小雨', daytemp: '15', nighttemp: '8', daywind: '东风', daypower: '2' }
    ] }]
  })
  const fc = weatherForecast(parseAmap(fBody).obj)
  eq(fc.length, 2, '两天预报')
  eq(fc[0].dayWeather, '晴', '白天天气')
  eq(fc[0].nightTemp, '6', '夜间温度')

  // 地理编码 / 逆地理 / 路线
  const g = geocodeFirst(parseAmap(JSON.stringify({ status: '1', geocodes: [{ formatted_address: '北京市海淀区中关村', province: '北京市', city: '北京市', district: '海淀区', level: '兴趣点', location: '116.31,39.98' }] })).obj)
  eq(g.address, '北京市海淀区中关村', '地理编码地址')
  eq(g.lat, '39.98', '地理编码纬度')
  eq(geocodeFirst({ status: '1', geocodes: [] }), null, '没有结果返回 null')

  const rg = regeoText(parseAmap(JSON.stringify({ status: '1', regeocode: { formatted_address: '北京市海淀区xx路1号', addressComponent: { province: '北京市', city: '北京市', district: '海淀区', township: '中关村街道' } } })).obj)
  eq(rg.district, '海淀区', '逆地理区县')
  eq(regeoText({ status: '1' }), null, '没有 regeocode 返回 null')

  const rt = routeBrief(parseAmap(JSON.stringify({ status: '1', route: { paths: [{ distance: '12000', duration: '1800', steps: [{ instruction: '向东行驶', road: '长安街', distance: '500' }, { instruction: '右转', road: 'x路', distance: '300' }, { instruction: '到达', road: '', distance: '0' }, { instruction: '第四步', road: '', distance: '0' }] }] } })).obj, 3)
  eq(rt.distance, '12000', '路线总距离')
  eq(rt.steps.length, 3, '只留三步（屏幕放不下更多）')
  eq(rt.stepCount, 4, '但记录总步数')
  eq(routeBrief({ status: '1', route: { paths: [] } }), null, '没路线返回 null')

  // 格式化
  eq(fmtDistance('800'), '800m', '米级距离')
  eq(fmtDistance('1500'), '1.5km', '公里级距离')
  eq(fmtDistance('0'), '', '0 距离不显示')
  eq(fmtDistance(''), '', '空距离不显示')
  eq(fmtDistance('abc'), '', '非法距离不显示')
  eq(fmtDuration('1300'), '22分钟', '分钟级时长')
  eq(fmtDuration('4500'), '1小时15分钟', '小时级时长')
  eq(fmtDuration('3600'), '1小时', '整小时不带分钟')
  eq(fmtDuration('0'), '', '0 时长不显示')

  // 副标题：距离优先
  eq(poiSubtitle({ distance: '320', address: '东长安街' }), '320m · 东长安街', '有距离有地址')
  eq(poiSubtitle({ distance: '320' }), '320m', '只有距离')
  eq(poiSubtitle({ address: '东长安街' }), '东长安街', '只有地址')
  eq(poiSubtitle({ district: '东城区', type: '景点' }), '东城区 · 景点', '都没有就用区县+类型')
  eq(poiSubtitle({}), '', '空对象给空串')
}


// ---------- 聊天里的地图意图（lib/mapintent.js）----------
function mapIntentSuite() {
  // 强制触发：用户明确说「使用高德地图」时必须查
  const f1 = parseMapIntent('使用高德地图 北京天气')
  ok(f1.forced, '「使用高德地图」判为强制')
  eq(f1.kind, 'weather', '强制 + 北京天气 → 天气意图')
  eq(f1.city, '北京', '强制语句里认出城市')
  const f2 = parseMapIntent('高德地图 上海天气')
  ok(f2.forced, '句首「高德地图」也判为强制')
  eq(f2.city, '上海', '句首式强制也认城市')
  const f3 = parseMapIntent('用高德地图查一下天安门')
  ok(f3.forced, '「用高德地图」判为强制')
  eq(f3.kind, 'place', '强制但无明确意图 → 地点搜索')
  eq(f3.keywords, '天安门', '强制语句剥掉「查一下」再当关键词')

  // 不能误触发：「高德地图和百度地图哪个好」是在提问，不是指令
  eq(parseMapIntent('高德地图和百度地图哪个好').kind, 'none', '比较类提问不触发地图')
  ok(!parseMapIntent('高德地图和百度地图哪个好').forced, '比较类提问不算强制')

  // 天气
  const w1 = parseMapIntent('北京天气怎么样')
  eq(w1.kind, 'weather', '「北京天气怎么样」→ 天气')
  eq(w1.city, '北京', '认出北京')
  ok(!w1.forecast, '没提时间 → 实时天气')
  const w2 = parseMapIntent('上海明天会下雨吗')
  eq(w2.kind, 'weather', '「明天会下雨吗」→ 天气')
  ok(w2.forecast, '提到明天 → 预报')
  const w3 = parseMapIntent('杭州未来一周天气')
  eq(w3.city, '杭州', '认出杭州')
  ok(w3.forecast, '「未来一周」→ 预报')
  const w4 = parseMapIntent('今天天气怎么样')
  eq(w4.kind, 'weather', '没城市也判天气（靠 IP 兜底）')
  eq(w4.city, '', '没城市时 city 留空')
  eq(parseMapIntent('最近天气不错').kind, 'none', '「天气不错」是感慨，不查')

  // 路线
  const r1 = parseMapIntent('从北京到上海怎么走')
  eq(r1.kind, 'route', '「从A到B怎么走」→ 路线')
  eq(r1.origin, '北京', '路线起点')
  eq(r1.destination, '上海', '路线终点')
  const r2 = parseMapIntent('北京到上海开车要多久')
  eq(r2.kind, 'route', '「A到B开车要多久」→ 路线')
  eq(r2.origin, '北京', '起点不带「从」也能拆')
  eq(r2.destination, '上海', '终点不带「怎么走」也能拆')
  const r3 = parseMapIntent('我想从杭州到南京开车要多久')
  eq(r3.origin, '杭州', '长句里拆起点')
  eq(r3.destination, '南京', '长句里拆终点，不把「开车」吃进地名')
  const r4 = parseMapIntent('去杭州怎么走')
  eq(r4.kind, 'route', '只有终点也算路线意图')
  eq(r4.destination, '杭州', '只有终点时 destination 有值')
  eq(r4.origin, '', '只有终点时 origin 为空（服务层会提示）')

  // 地点
  const p1 = parseMapIntent('附近的咖啡店')
  eq(p1.kind, 'place', '「附近的X」→ 地点')
  eq(p1.keywords, '咖啡店', '剥掉「附近的」')
  const p2 = parseMapIntent('天安门在哪')
  eq(p2.kind, 'place', '「X在哪」→ 地点')
  eq(p2.keywords, '天安门', '地点关键词')
  eq(p2.city, '', '「天安门在哪」不能把整句当城市（否则搜不到）')
  const p3 = parseMapIntent('哪里有加油站')
  eq(p3.keywords, '加油站', '「哪里有X」剥前缀')

  // 坐标 / 经纬度
  const g1 = parseMapIntent('116.397,39.908 这里是哪')
  eq(g1.kind, 'regeo', '纯坐标 → 逆地理')
  eq(g1.location, '116.397,39.908', '坐标原样取出')
  const g2 = parseMapIntent('天安门的经纬度')
  eq(g2.kind, 'geocode', '「X的经纬度」→ 地理编码')
  eq(g2.address, '天安门', '剥掉「的经纬度」')

  // 不该触发的日常对话
  eq(parseMapIntent('你好').kind, 'none', '寒暄不触发')
  eq(parseMapIntent('帮我翻译这段话').kind, 'none', '翻译请求不触发')
  eq(parseMapIntent('北京').kind, 'none', '孤零零的地名不触发（太容易误判）')
  eq(parseMapIntent('').kind, 'none', '空串不触发')
  eq(parseMapIntent(null).kind, 'none', 'null 不抛')

  // pickCity 的两种模式
  eq(pickCity('北京天气', true), '北京', 'loose 认出城市表里的城市')
  eq(pickCity('乌鲁木齐天气', true), '乌鲁木齐', 'loose 认后缀表')
  eq(pickCity('天安门在哪', false), '', 'strict 不把疑问句当城市')
  eq(pickCity('哈尔滨气温', true), '哈尔滨', 'loose 认前缀城市')

  // 上下文格式：必须带上真实数据，且明确要求模型别编
  const ctx = formatMapContext('weather', {
    now: { city: '北京市', weather: '晴', temperature: '13', windDirection: '东南', windPower: '2', humidity: '24', reportTime: '2026-10-30 23:00' },
    forecast: [],
    cityText: '北京'
  })
  ok(ctx.indexOf('北京市') >= 0, '天气上下文含城市')
  ok(ctx.indexOf('13') >= 0, '天气上下文含温度')
  ok(ctx.indexOf('不要凭记忆') >= 0, '上下文里有"别编"的要求')
  const fcCtx = formatMapContext('weather', { forecast: [{ date: '2026-10-31', dayWeather: '多云', nightWeather: '晴', dayTemp: '18', nightTemp: '8', dayWind: '东', dayPower: '3' }] })
  ok(fcCtx.indexOf('2026-10-31') >= 0, '预报上下文含日期')
  const placeCtx = formatMapContext('place', { items: [{ name: '天安门', type: '景点', district: '东城区', address: '东长安街', tel: '', lng: '116.39', lat: '39.90' }] })
  ok(placeCtx.indexOf('天安门') >= 0, '地点上下文含名称')
  ok(placeCtx.indexOf('东长安街') >= 0, '地点上下文含地址')
  const routeCtx = formatMapContext('route', {
    route: { distance: '1200', duration: '4800', steps: [{ instruction: '向东行驶', road: '长安街', distance: '300' }], stepCount: 1 },
    originText: '北京市', destText: '上海市', distanceText: '1.2km', durationText: '1小时20分钟'
  })
  ok(routeCtx.indexOf('1.2km') >= 0, '路线上下文含距离')
  ok(routeCtx.indexOf('向东行驶') >= 0, '路线上下文含第一步')
  // brief：界面展开用，不带「回答要求」
  const brief = formatMapContext('place', { items: [{ name: '天安门' }] }, { brief: true })
  ok(brief.indexOf('天安门') >= 0, 'brief 仍含数据')
  eq(brief.indexOf('回答要求'), -1, 'brief 不带回答要求')
  // 空数据返回空串（调用方据此判断"没查到"
  eq(formatMapContext('weather', { now: null, forecast: [] }), '', '没数据时上下文为空')
  eq(formatMapContext('none', null), '', '未知类型为空')

  // 界面标签
  eq(mapChipLabel('weather', { now: { city: '北京市', weather: '晴', temperature: '13' } }), '高德 · 北京市 晴 13°C', '天气标签带城市/天气/温度')
  eq(mapChipLabel('weather', { forecast: [{}, {}], cityText: '北京' }), '高德 · 北京 预报 2 天', '预报标签带天数')
  eq(mapChipLabel('place', { items: [1, 2, 3] }), '高德 · 地点 3 条', '地点标签带条数')
  eq(mapChipLabel('route', { distanceText: '1.2km', durationText: '20分钟' }), '高德 · 1.2km 20分钟', '路线标签带距离时长')
  eq(mapChipLabel('geocode', {}), '高德 · 坐标', '地理编码标签')
  eq(mapChipLabel('regeo', {}), '高德 · 地址', '逆地理标签')
}

amapSuite()

mapIntentSuite()

// ---------- 多分辨率自适应（fit，路线 A：宽度铺满 + 纵向重排） ----------
{
  // 基准机：stageH=280 → 零变化，apply=false
  {
    const p = plan({ width: 936, height: 280 })
    eq(p.ok, true, 'fit 基准机 ok')
    eq(p.apply, false, 'fit 基准机不注入 stageH')
    eq(p.viewPort, 936, 'fit 基准机 viewPort=936（钉死宽度）')
    eq(p.scale, 1, 'fit 基准机 scale=1')
    eq(p.stageH, 280, 'fit 基准机 stageH=280')
  }

  // 更扁的机型 960×266（PStore 明确点名）：stageH 重算，铺满不裁切
  {
    const p = plan({ width: 960, height: 266 })
    eq(p.ok, true, 'fit 960×266 ok')
    eq(p.apply, true, 'fit 960×266 要注入 stageH')
    eq(p.viewPort, 936, 'fit 960×266 viewPort 仍钉死 936（宽度铺满）')
    // stageH = 936*266/960 = 259.35
    ok(Math.abs(p.stageH - 259.35) < 0.1, 'fit 960×266 stageH≈259.35 (' + p.stageH + ')')
    // 框架放大 k=960/936=1.026 后铺满屏高：stageH * scale ≈ H
    ok(Math.abs(p.stageH * p.scale - 266) < 0.5, 'fit 960×266 stageH*scale≈屏高 (' + (p.stageH * p.scale) + ')')
  }

  // 更高的机型 900×300：stageH 变大，铺满不落底留白
  {
    const p = plan({ width: 900, height: 300 })
    eq(p.ok, true, 'fit 900×300 ok')
    eq(p.apply, true, 'fit 900×300 要注入 stageH')
    // stageH = 936*300/900 = 312
    ok(Math.abs(p.stageH - 312) < 0.1, 'fit 900×300 stageH≈312 (' + p.stageH + ')')
    ok(Math.abs(p.stageH * p.scale - 300) < 0.5, 'fit 900×300 stageH*scale≈屏高 (' + (p.stageH * p.scale) + ')')
  }

  // 长边归一：宽高颠倒也能算对
  {
    const a = plan({ width: 280, height: 936 })
    const b = plan({ width: 936, height: 280 })
    eq(a.viewPort, b.viewPort, 'fit 宽高颠倒 viewPort 一致')
    eq(a.stageH, b.stageH, 'fit 宽高颠倒 stageH 一致')
    eq(a.scale, b.scale, 'fit 宽高颠倒 scale 一致')
  }

  // 归一化函数本身
  {
    eq(normalizeScreen(936, 280).w, 936, 'normalizeScreen 长边当宽 1')
    eq(normalizeScreen(280, 936).w, 936, 'normalizeScreen 长边当宽 2')
    eq(normalizeScreen(280, 936).h, 280, 'normalizeScreen 短边当高')
  }

  // 守卫：脏值退回
  {
    eq(isSaneScreen(0, 0), false, 'fit 0×0 脏值')
    eq(isSaneScreen(100, 30), false, 'fit 过小脏值')
    eq(isSaneScreen(2000, 100), false, 'fit 比例过扁脏值 (>6.7)')
    eq(isSaneScreen(936, 280), true, 'fit 基准机合法')
    eq(plan({ width: 0, height: 0 }).ok, false, 'fit 未知屏 not-ok')
    eq(plan({}).ok, false, 'fit 空 env 返回 not-ok')
    eq(plan(null).ok, false, 'fit null env 返回 not-ok')
    eq(fitViewport(0, 0), null, 'fitViewport 脏值返回 null')
  }

  // 机型矩阵：每一条断言「stageH 重算后，框架放大 scale 倍正好铺满屏高（宽恒钉死 936）」
  {
    const matrix = [
      [936, 280], [960, 266], [1024, 300], [960, 280], [800, 280],
      [800, 480], [640, 480], [400, 300]
    ]
    for (const [w, h] of matrix) {
      const p = plan({ width: w, height: h })
      const label = 'fit 矩阵 ' + w + '×' + h
      eq(p.ok, true, label + ' ok')
      const W = p.w
      const H = p.h
      // ① viewPort 恒钉死设计宽（宽度交给框架铺满，无黑边）
      eq(p.viewPort, DESIGN_W, label + ' viewPort=936')
      // ② stageH 重算后，框架放大 scale 倍 ≈ 屏高（铺满，不裁切不留白）
      ok(Math.abs(p.stageH * p.scale - H) < 0.5,
        label + ' stageH*scale≈屏高 (' + r2(p.stageH * p.scale) + ' vs ' + H + ')')
      // ③ stageH 应等于 936*H/W（公式自洽）
      ok(Math.abs(p.stageH - (DESIGN_W * H) / W) < 0.1, label + ' stageH=936*H/W')
    }
  }

  // layout() 骨架 + 运行时单例
  {
    const p = plan({ width: 960, height: 266 })
    const l = layout(p)
    eq(l.rootW, 936, 'layout rootW=936')
    eq(l.rootH, p.stageH, 'layout rootH=stageH')
    ok(l.factor > 1, 'layout factor=scale>1 (' + l.factor + ')')

    // setFit/getFit：默认基准机骨架，页面在 fit 未跑起来时读到零变化
    const d = getFit()
    eq(d.apply, false, 'getFit 默认 apply=false')
    eq(d.stageH, 280, 'getFit 默认 stageH=280')
    setFit(p)
    eq(getFit().stageH, p.stageH, 'setFit 后 getFit 读到新 stageH')
    setFit(null)
    eq(getFit().stageH, p.stageH, 'setFit(null) 不清空已有 fit')
  }
}

function r2(n) {
  return Math.round(n * 100) / 100
}


console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败') + '：' + pass + ' 项断言，' + fail + ' 项失败')
if (fail) {
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
