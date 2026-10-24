// Markdown → 可直接渲染的"扁平 run"列表（纯函数）
//
// 为什么是"扁平 run"：这台设备的 <text> 不能有任何元素子节点（带 measure 函数的节点
// 加子节点会让 libfalcon.so 断言失败并 abort 整个框架进程）。所以"父样式 + 子样式"
// 这种嵌套表达一律禁止，行内样式必须拍平成同级 <text>，由父级 flex-wrap 换行。
// 同理，公式用与 <text> 平级的 <richtext><latex/></richtext>，不能塞进 <text> 里。

import { splitMath, canTypeset, latexToUnicode, splitMathLines, estimateWidth, isBalanced, needsDisplayMath, looksLikeBareMath, stripRowSpacing, tightenMathSpaces, MATH_WIDTH_MAX, INLINE_MATH_MAX } from './latex.js'

const EMOJI_MAP = {
  '😀': '[笑]', '😄': '[开心]', '😁': '[呲牙]', '😊': '[微笑]', '🙂': '[微笑]', '😉': '[眨眼]',
  '😅': '[汗]', '😂': '[笑哭]', '🤣': '[笑哭]', '😭': '[大哭]', '😢': '[流泪]', '😡': '[生气]',
  '😱': '[惊恐]', '😴': '[睡]', '🤔': '[思考]', '😎': '[酷]', '🥳': '[庆祝]', '😮': '[惊讶]',
  '👍': '[赞]', '👎': '[踩]', '👏': '[鼓掌]', '🙏': '[合十]', '💪': '[加油]', '👌': '[OK]',
  '✌️': '[胜利]', '🤝': '[握手]', '❤️': '[爱心]', '💔': '[心碎]', '🔥': '[火]', '⭐': '[星]',
  '✅': '[完成]', '❌': '[错误]', '⚠️': '[警告]', '❓': '[问]', '❗': '[感叹]', '💡': '[想法]',
  '📌': '[图钉]', '📖': '[书]', '✏️': '[笔]', '🎉': '[庆祝]', '🚀': '[火箭]', '⏰': '[闹钟]'
}

// 设备没有彩色 emoji 字体，未映射的 emoji 会渲染成白块。这里统一兜底成 [emoji]。
export function substituteEmoji(text) {
  const s = String(text == null ? '' : text)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const pair = s.substr(i, 2)
      out += EMOJI_MAP[pair] || '[emoji]'
      i++
      continue
    }
    const ch = s.charAt(i)
    if (EMOJI_MAP[ch]) { out += EMOJI_MAP[ch]; continue }
    // 杂项符号区（☀✈♠ 等）直接吃掉，避免白块
    if (code >= 0x2600 && code <= 0x27bf) { out += ''; continue }
    out += ch
  }
  return out
}

// ---------- 行内 ----------

function isWordChar(c) {
  return /[A-Za-z0-9_\u4e00-\u9fa5]/.test(c || '')
}

// 行内 markdown → 扁平 runs
export function inlineRuns(text) {
  const s = String(text == null ? '' : text)
  const runs = []
  let buf = ''
  let i = 0

  const flush = () => {
    if (buf) {
      runs.push({ text: substituteEmoji(buf), bold: false, italic: false, code: false, strike: false })
      buf = ''
    }
  }

  while (i < s.length) {
    const c = s.charAt(i)

    // 行内代码 `x`
    if (c === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        runs.push({ text: s.slice(i + 1, end), bold: false, italic: false, code: true, strike: false })
        i = end + 1
        continue
      }
    }

    // 粗体 **x** / __x__
    if ((c === '*' || c === '_') && s.charAt(i + 1) === c) {
      const mark = c + c
      const end = s.indexOf(mark, i + 2)
      if (end > i + 2) {
        flush()
        runs.push({ text: substituteEmoji(s.slice(i + 2, end)), bold: true, italic: false, code: false, strike: false })
        i = end + 2
        continue
      }
    }

    // 删除线 ~~x~~
    if (c === '~' && s.charAt(i + 1) === '~') {
      const end = s.indexOf('~~', i + 2)
      if (end > i + 2) {
        flush()
        runs.push({ text: substituteEmoji(s.slice(i + 2, end)), bold: false, italic: false, code: false, strike: true })
        i = end + 2
        continue
      }
    }

    // 斜体 *x* / _x_（前后不能是字母，避免把 snake_case 吃掉）
    if (c === '*' || c === '_') {
      const prev = i > 0 ? s.charAt(i - 1) : ''
      if (!isWordChar(prev) || c === '*') {
        let end = -1
        for (let j = i + 1; j < s.length; j++) {
          if (s.charAt(j) === c && !/\s/.test(s.charAt(j - 1))) { end = j; break }
        }
        if (end > i + 1) {
          const body = s.slice(i + 1, end)
          if (!/[A-Za-z0-9_]{6,}/.test(body) || c === '*') {
            flush()
            runs.push({ text: substituteEmoji(body), bold: false, italic: true, code: false, strike: false })
            i = end + 1
            continue
          }
        }
      }
    }

    // 链接 [text](url) → 文本 + 灰括号
    if (c === '[') {
      const mid = s.indexOf('](', i + 1)
      if (mid > i + 1) {
        const close = s.indexOf(')', mid + 2)
        if (close > mid + 2) {
          flush()
          runs.push({ text: substituteEmoji(s.slice(i + 1, mid)), bold: false, italic: false, code: false, strike: false })
          buf += '(' + s.slice(mid + 2, close) + ')'
          flush()
          i = close + 1
          continue
        }
      }
    }

    buf += c
    i++
  }
  flush()
  return runs.length ? runs : [{ text: '', bold: false, italic: false, code: false, strike: false }]
}

// 公式排版决策（三条路，见 latex.js 顶部说明）。
//   style: 'native' 单行原生 | 'lines' 断成多行原生 | 'text' Unicode 近似
//
// 行内公式：**短的就地走原生**。原生引擎字号固定约 34px 且不可缩放，比正文大，
// 但配合 `align-items:center` 的 flex 行，汉字在公式的上下留白里居中，读起来
// 就是手写混排的样子；反过来把公式抽出去独占一行，引导语会孤零零留在上一行。
// 只有长的（> INLINE_MATH_MAX）才退回 Unicode 近似，免得把正文挤走。
export function planMath(value, display, opts) {
  const options = opts || {}
  const allow = options.typeset !== false
  // 块级公式里那些 2em 的空洞先收一收：见 tightenMathSpaces 的说明。
  // 行内公式不动 —— 它会挤占正文宽度，本来就该保持原样。
  const src = display ? tightenMathSpaces(String(value == null ? '' : value)) : String(value == null ? '' : value)
  const width = options.maxWidth
  if (!allow) return { style: 'text', value: src, uni: latexToUnicode(src), lines: null }
  if (!display) {
    if (options.inlineNative !== false) {
      const cap = options.inlineMax || INLINE_MATH_MAX
      if (canTypeset(src, cap)) return { style: 'native', value: src, uni: '', lines: null }
    }
    return { style: 'text', value: src, uni: latexToUnicode(src), lines: null }
  }
  if (canTypeset(src, width)) return { style: 'native', value: src, uni: '', lines: null }
  // 超宽但能按顶层运算符断开 → 原生排成多行（仍是正常排版，只是换行）
  const lines = splitMathLines(src, width)
  if (lines && lines.length > 1) return { style: 'lines', value: src, uni: '', lines: lines }
  // 断不动（单个大分式 / 多行环境）：**仍然交给原生**，宁可有几十像素的右边距裁切，
  // 也不要退化成纯文本近似 —— 公式的上下叠放结构是数学语义的一部分。
  // 估算本身留了余量并乘了 1.3，只有真正远超宽度（> 1.6 倍）才认输走 Unicode。
  const w = estimateWidth(src)
  const limit = width || MATH_WIDTH_MAX
  if (w <= limit * 1.6 && isBalanced(src)) return { style: 'native', value: src, uni: '', lines: null }
  return { style: 'text', value: src, uni: latexToUnicode(src), lines: null }
}

// 行内 + 公式 → 扁平 runs。公式 run 形如
//   { math:true, value, display, typeset:boolean, text }
// typeset=true 时用 <richtext><latex value=...>；否则直接渲染 text（Unicode 近似）。
export function runsWithMath(text, opts) {
  const options = opts || {}
  const segs = splitMath(text)
  const out = []

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    if (seg.type === 'text') {
      const rs = inlineRuns(seg.value)
      for (let k = 0; k < rs.length; k++) out.push(rs[k])
      continue
    }
    const d = planMath(seg.value, seg.display, options)
    const typeset = d.style === 'native'
    // d.value 可能是收紧过空白的源码（块级公式），渲染要用它，不是原始的 seg.value
    const val = d.value || seg.value
    out.push({
      math: true,
      value: val,
      display: !!seg.display,
      typeset: typeset,
      text: typeset ? val : (d.uni || latexToUnicode(val)),
      bold: false, italic: false, code: false, strike: false
    })
  }
  return out
}

// ---------- 块 ----------

const RE_FENCE = /^\s*```(.*)$/
const RE_HEADING = /^(#{1,6})\s+(.*)$/
const RE_UL = /^(\s*)([-*+])\s+(.*)$/
const RE_OL = /^(\s*)(\d+)[.)]\s+(.*)$/
const RE_QUOTE = /^\s*>\s?(.*)$/
const RE_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
// 块级公式里的软换行等于空格（LaTeX 语义如此）。
// 直接把 '\n' 喂给原生引擎不行：宽度估算会把换行当普通字符算，
// 引擎也可能因为不认识的字符整块排不出来。多行环境（aligned/matrix）的换行
// 是显式的 `\\`，不受这里影响；但 `\\[4pt]` 这一截可选行距必须剥掉。
function joinMathBody(lines) {
  return stripRowSpacing(String(lines.join(' ')).replace(/[ \t]{2,}/g, ' ')).trim()
}

// 块级公式的起始行：$$… / \[… / \begin{env}
const BLOCK_MATH_START = /^\s*(\$\$|\\\[|\\begin\s*\{)/

export function parseBlocks(markdown) {
  const src = String(markdown == null ? '' : markdown).replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i++; continue }

    const fence = line.match(RE_FENCE)
    if (fence) {
      const lang = (fence[1] || '').trim()
      const body = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i++ }
      i++ // 跳过结束围栏
      blocks.push({ type: 'code', lang: lang, text: body.join('\n') })
      continue
    }

    // 块级公式 $$ 独占若干行
    if (/^\s*\$\$\s*$/.test(line)) {
      const body = []
      i++
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) { body.push(lines[i]); i++ }
      i++
      blocks.push({ type: 'math', text: joinMathBody(body) })
      continue
    }

    // 块级公式 \[ 独占一行、\] 收尾。
    // 这是模型写行间公式最常见的姿势（DeepSeek 默认就用 \[ \]），
    // 早期只认 $$，于是这类公式整段被当普通文本，屏幕上是原始 LaTeX 源码。
    if (/^\s*\\\[\s*$/.test(line)) {
      const body = []
      i++
      while (i < lines.length && !/^\s*\\\]\s*$/.test(lines[i])) { body.push(lines[i]); i++ }
      i++
      blocks.push({ type: 'math', text: joinMathBody(body) })
      continue
    }

    // 多行环境（矩阵/分段函数）：\begin{env} 独占一行起，\end{env} 收尾
    const envOpen = line.match(/^\s*\\begin\{([a-zA-Z*]+)\}/)
    if (envOpen) {
      const env = envOpen[1]
      const body = [line]
      i++
      while (i < lines.length) {
        body.push(lines[i])
        const isEnd = new RegExp('\\\\end\\{' + env + '\\}').test(lines[i])
        i++
        if (isEnd) break
      }
      blocks.push({ type: 'math', text: joinMathBody(body) })
      continue
    }

    const h = line.match(RE_HEADING)
    if (h) {
      blocks.push({ type: 'h', level: h[1].length, text: h[2].trim() })
      i++
      continue
    }

    if (RE_HR.test(line)) { blocks.push({ type: 'hr' }); i++; continue }

    const q = line.match(RE_QUOTE)
    if (q) {
      const body = [q[1]]
      i++
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', text: body.join('\n') })
      continue
    }

    const ul = line.match(RE_UL)
    if (ul) {
      blocks.push({ type: 'li', ordered: false, level: Math.floor(ul[1].length / 2), marker: '•', text: ul[3] })
      i++
      continue
    }

    const ol = line.match(RE_OL)
    if (ol) {
      blocks.push({ type: 'li', ordered: true, level: Math.floor(ol[1].length / 2), marker: ol[2] + '.', text: ol[3] })
      i++
      continue
    }

    // 表格：按行收集，渲染成等宽文本行（不追求真表格，936 宽放不下多列）
    if (/^\s*\|/.test(line)) {
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) {
          rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
        }
        i++
      }
      blocks.push({ type: 'table', rows: rows })
      continue
    }

    // 普通段落：合并连续非空、非特殊行
    const para = [line]
    i++
    while (i < lines.length) {
      const nxt = lines[i]
      if (!nxt.trim()) break
      // 「块级公式起始行」必须在这里就断开。
      // 这是"公式全变源码"的真正根因：模型最常写的姿势是
      //     计算定积分
      //     \[
      //     I=\int_0^1 ...
      //     \]
      // 引导语和 `\[` 之间**没有空行**。早期 break 条件只认 `$$`，于是 `\[` 连同
      // 后面几行被并进"计算定积分"这一段；段落最后按行拆成一个个 p 块，`\[` 成了
      // 一个空 math run、公式正文成了普通文字、`\]` 原样显示 —— 一条回答里几十个
      // 公式集体失效。诊断页 36/36 全过而真实回答全崩，就是这个差别。
      if (RE_FENCE.test(nxt) || RE_HEADING.test(nxt) || RE_UL.test(nxt) || RE_OL.test(nxt) ||
          RE_QUOTE.test(nxt) || RE_HR.test(nxt) || /^\s*\|/.test(nxt) || BLOCK_MATH_START.test(nxt)) break
      para.push(nxt)
      i++
    }
    // 每行单独成块：模型经常用单个换行做断行，若把多行并成一个段落，
    // <text> 里的 \n 会被吃掉，几行内容会挤在同一行上（实机验到过）。
    // 标准 markdown 把软换行并成空格，但小屏上"照原文断行"更符合直觉。
    for (const ln of para) {
      // 整行只有一个"行间公式"（$$…$$ / \[…\] 写在同一行）→ 提升成块级公式，
      // 否则它会在段落里被当成行内元素，原生排版撑断整行。
      const segs = splitMath(ln)
      if (segs.length === 1 && segs[0].type === 'math' && segs[0].display) {
        blocks.push({ type: 'math', text: segs[0].value })
        continue
      }
      // 完全没写定界符的裸 LaTeX 整行 —— 交给原生排，别再当源码显示
      if (looksLikeBareMath(ln)) {
        blocks.push({ type: 'math', text: ln.trim() })
        continue
      }
      blocks.push({ type: 'p', text: ln })
    }
  }
  return blocks
}

// 行内公式里"太长、必须竖排"的那一类，提升为独立公式行。
//
// 短的行内公式（≤ INLINE_MATH_MAX）**不再提升**：它们就在正文里用原生排版，
// 与上下文同一行、垂直居中 —— `由 \(x=\frac{1}{2}\) 可得` 读起来就是一句话。
// 只有长的（一进来就把整行正文挤走）才单独成行，换取完整的竖式排版。
const LEAD_PUNCT = /^[\s，,、；;。.：:]+/

// 这一块文字允许的行内公式宽度上限。
//
// 只看公式自己的宽度是不够的：`由求根公式 x=\frac{-b\pm\sqrt{b^2-4ac}}{2a} 可得`
// 里公式 350px，单独看已经超了 200 的行内上限，但它和上下文加起来才 550px，
// 936 的屏放得下 —— 硬把它抽出去独占一行，句子就被切成三段，读起来是断的。
// 所以按"整行还剩多少地方"给它额度：上下文越短，公式能占的越宽。
export function blockInlineCap(text, opts) {
  const base = (opts && opts.inlineMax) || INLINE_MATH_MAX
  const segs = splitMath(String(text == null ? '' : text))
  let textW = 0
  for (let i = 0; i < segs.length; i++) if (segs[i].type === 'text') textW += textWidth(segs[i].value)
  if (!textW) return base
  return Math.max(base, MATH_WIDTH_MAX - textW)
}

function shouldPromote(src, cap) {
  if (!needsDisplayMath(src)) return false
  return !canTypeset(src, cap)
}

export function promoteInlineBlocks(blocks, opts) {
  const out = []
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k]
    if (b.type !== 'p' && b.type !== 'li') { out.push(b); continue }
    const cap = blockInlineCap(b.text, opts)
    const segs = splitMath(b.text || '')
    let promote = false
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      if (s.type === 'math' && !s.display && shouldPromote(s.value, cap)) { promote = true; break }
    }
    if (!promote) { out.push(b); continue }

    let buf = ''
    let started = false
    const flush = () => {
      let t = buf
      buf = ''
      t = started ? t.replace(LEAD_PUNCT, '') : t.replace(/^\s+/, '')
      if (!t.trim()) return
      // 列表项的第一段保留 bullet；公式之后续上的文字退化成普通段落，
      // 再补一个 bullet 会让人以为是另一个条目。
      if (!started && b.type === 'li') out.push({ type: 'li', marker: b.marker, text: t })
      else out.push({ type: 'p', text: t })
      started = true
    }

    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      if (s.type === 'text') { buf += s.value; continue }
      if (!s.display && shouldPromote(s.value, cap)) {
        flush()
        if (!started && b.type === 'li') {
          // 整条就是个公式：bullet 单独占一个记号位，别把列表项吞掉
          out.push({ type: 'li', marker: b.marker, text: '' })
          started = true
        }
        out.push({ type: 'math', text: s.value, display: true })
        started = true
        continue
      }
      // 不需要提升的公式原样放回文本（带定界符），后面 runsWithMath 会再解析
      buf += (s.display ? '$$' : '$') + s.value + (s.display ? '$$' : '$')
    }
    flush()
  }
  return out
}

// 这条回答是否要用"纸面"（浅底深字）。
//
// 原生 <latex> 只会画纯黑字形（引擎忽略 CSS color，真机取像素确认过），
// 所以**凡是会出现原生公式的回答**，整块底色必须是浅的，否则黑字落在近黑底上
// 对比度只有 1.1:1。与其让公式单独顶一块白条、在解题过程里割出一格一格的补丁，
// 不如把浅色铺满整条回答 —— 公式自然成为"纸面"的一部分。
export function needsPaperSheet(md) {
  const s = String(md || '')
  if (/\$\$|\\\[/.test(s)) return true
  if (needsDisplayMath(s)) return true
  // 裸 LaTeX（模型没写任何定界符）同样会走原生排版，也必须有浅底
  const lines = s.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) if (looksLikeBareMath(lines[i])) return true
  return false
}

// 把一个块转成"带 runs 的渲染计划"
export function planBlock(block, opts) {
  const out = Object.assign({}, block)
  if (block.type === 'code' || block.type === 'hr') return out
  if (block.type === 'math') {
    // 块级公式：独立成行，右侧留白足够，可以放心用原生排版。
    // 放不下时先试着按顶层运算符断成多行，再不行才退回 Unicode。
    const d = planMath(block.text, true, opts)
    out.style = d.style
    out.lines = d.lines
    out.native = d.style === 'native'
    out.uni = d.uni || ''
    // 页面渲染用的是 b.text，必须换成 planMath 处理后的源码，
    // 否则 tightenMathSpaces 只作用于宽度估算、屏幕上还是原来的大空洞。
    out.text = d.value
    return out
  }
  if (block.type === 'table') {
    // 保留二维结构，交给页面按「行 = flex 行、单元格 = flex:1」渲染。
    // 早期版本把所有单元格 join('  |  ') 压成一行文本，936 宽的屏上可读性很差；
    // 这里统一补齐列数，避免短行导致列错位。
    const rows = (block.rows || []).map((row) => row.slice())
    const cols = rows.reduce((n, r) => Math.max(n, r.length), 0)
    out.rows = rows.map((r) => {
      while (r.length < cols) r.push('')
      return r
    })
    out.cols = cols
    return out
  }
  // 行内公式的宽度额度按"这一行还剩多少地方"给，保证上下文短的公式能留在同一行
  const cap = blockInlineCap(block.text, opts)
  out.runs = runsWithMath(block.text, Object.assign({}, opts, { inlineMax: cap }))
  return out
}

// 短公式并回上一行。
//
// 936×280 的屏上一行只有 20px 高，而原生公式最矮也有 34px —— 一句"求导："
// 单独占一行、下面再放一条公式，等于白扔 20px（一屏能放 9 行）。所以当上一段
// 以「：」「=」「，」收尾、且公式本身很短（并进同一行放得下）时，把公式作为一个
// 行内 run 挂进那段，读起来就是手写时的「求导： d/dx x² = 2x」。
const SHORT_MATH_MAX = 380
const PROMPT_TAIL = /[：:＝=，,]\s*$/

// 粗略估文本宽度：中日韩全角 15px，其余 8px。只用来判断"并得进去没"
function textWidth(t) {
  let w = 0
  const s = String(t || '')
  for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 15 : 8
  return w
}

export function mergeShortMath(planned) {
  const out = []
  for (let i = 0; i < planned.length; i++) {
    const b = planned[i]
    const prev = out.length ? out[out.length - 1] : null
    if (
      b.type === 'math' && b.native && prev && prev.type === 'p' && prev.runs &&
      !/\\begin\{/.test(b.text) &&
      PROMPT_TAIL.test(prev.text || '') &&
      estimateWidth(b.text) <= SHORT_MATH_MAX &&
      estimateWidth(b.text) + textWidth(prev.text) <= MATH_WIDTH_MAX - 40
    ) {
      prev.runs = prev.runs.concat([{
        math: true,
        value: b.text,
        display: true,
        typeset: true,
        text: b.text,
        bold: false, italic: false, code: false, strike: false
      }])
      prev.merged = true
      continue
    }
    out.push(b)
  }
  return out
}

export function planBlocks(blocks, opts) {
    const planned = promoteInlineBlocks(blocks, opts).map((b) => planBlock(b, opts))
    return mergeShortMath(planned)
}

// 便捷入口：markdown 文本 → 渲染计划
export function renderPlan(markdown, opts) {
  return planBlocks(parseBlocks(markdown), opts)
}
