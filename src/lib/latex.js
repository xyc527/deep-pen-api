// LaTeX 处理（纯函数）
//
// 真机实测结论（详见 pages/latexlab 诊断页，36 条语料 × 7 屏截图）：
//   1) 固件内置 LaTeX 引擎确实能排：分式/根式/积分/求和/极限/希腊字母/上下标/
//      \mathbb{R}/\mathcal{L}/\text{中文}/\begin{cases}/\begin{pmatrix} 全部出图；
//   2) **字号固定、不可缩放**：给 <richtext> 或 <latex> 加 font-size（12/15/18/22/26/30px）
//      六档渲染结果完全一致，约 34px。所以行内公式一旦走原生，就会比正文大一倍多、
//      并把整行撑断 —— 行内一律走 Unicode 近似，原生只用于独立成行的公式；
//   3) **不会自动换行也不会缩放**：超宽直接在容器里被裁掉（右侧半截消失），
//      所以必须按"估算像素宽度"提前判断，放不下就按顶层运算符断成多行；
//   4) 花括号不配平 → 渲染成 0×0 空白（流式中间态必须挡住）。
//
// 于是输出三条路：
//   A. 原生单行排版：估算宽度放得下 + 括号配平 + 环境在白名单里
//   B. 原生多行排版：放不下但能在顶层运算符处断成几行，每行都放得下
//   C. Unicode 近似：行内公式、以及 A/B 都不成立时。宁可朴素，也不要空白或半截公式。

const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', T: 'ᵀ', A: 'ᴬ', B: 'ᴮ', D: 'ᴰ', E: 'ᴱ', G: 'ᴳ', H: 'ᴴ', I: 'ᴵ', J: 'ᴶ', K: 'ᴷ', L: 'ᴸ', M: 'ᴹ', N: 'ᴺ', O: 'ᴼ', P: 'ᴾ', R: 'ᴿ', U: 'ᵁ', V: 'ⱽ', W: 'ᵂ' }
const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ' }

const SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', equiv: '≡', approx: '≈', sim: '∼', simeq: '≃',
  propto: '∝', ll: '≪', gg: '≫', in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
  cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  mapsto: '↦', uparrow: '↑', downarrow: '↓', partial: '∂', nabla: '∇', infty: '∞', angle: '∠', perp: '⊥', parallel: '∥',
  sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', sqrt: '√', prime: '′', degree: '°',
  ldots: '…', cdots: '⋯', dots: '…', therefore: '∴', because: '∵', square: '□', triangle: '△',
  // 集合论里高频、上面漏掉的两个：\mathbb R\setminus\{0\} 会退化成字面量 "setminus"
  setminus: '\\', complement: '∁', nmid: '∤', hslash: 'ℏ', wp: '℘',
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ',
  left: '', right: '', big: '', Big: '', bigg: '', Bigg: '', displaystyle: '', textstyle: '', limits: '', nonumber: '',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  odot: '⊙', otimes: '⊗', oplus: '⊕', wedge: '∧', vee: '∨', mid: '|', vert: '|', Vert: '‖',
  approxeq: '≊', cong: '≅', asymp: '≍', subsetneq: '⊊', supsetneq: '⊋', varnothing: '∅', hbar: 'ℏ', ell: 'ℓ'
}

// 黑板体 / 花体字母（Unicode 里有对应码位，回退时比原样输出 \mathbb{R} 可读得多）
const BLACKBOARD = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', E: '𝔼', F: '𝔽' }
const SCRIPT = { L: 'ℒ', M: 'ℳ', N: '𝒩', P: '𝒫', R: 'ℛ', B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', O: '𝒪', S: '𝒮', T: '𝒯' }

// 组合用变音符：\hat{x} → x̂
const ACCENT = { hat: '\u0302', bar: '\u0304', vec: '\u20d7', tilde: '\u0303', dot: '\u0307', ddot: '\u0308', acute: '\u0301', grave: '\u0300' }

const ENV_OK = { cases: 1, pmatrix: 1, bmatrix: 1, matrix: 1, aligned: 1, split: 1 }
const ENV_MATRIX = { pmatrix: '(', bmatrix: '[', matrix: '', Bmatrix: '[', vmatrix: '|' }

function fmtMatrix(env, body) {
  const rows = String(body).split('\\\\')
  const lines = []
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].split('&').map((c) => c.trim()).filter((c) => c !== '')
    if (cells.length) lines.push(cells.join('  '))
  }
  const open = ENV_MATRIX[env] || ''
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '|' ? '|' : ''
  return open + lines.join('; ') + close
}

// 简单上下标：\alpha、\le、\frac{a}{b}、\sqrt{x}、x^{2}、a_{i}
export function latexToUnicode(src) {
  let s = String(src == null ? '' : src)

  // `\\[4pt]`（矩阵里的行距）先清掉。它是 `\\` + 可选长度，不先处理会在降级文本里
  // 留下 "[4pt]" 这种原文，读者以为是公式的一部分。
  s = s.replace(/\\\\\s*\[[^\]]{0,12}\]/g, ' ')

  // 矩阵/分段函数：先把环境抽出来单独处理，否则会退化成 "beginpmatrix1&2..."
  for (let guard = 0; guard < 6; guard++) {
    const before = s
    s = s.replace(/\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/g, (m, env, body) => {
      if (ENV_MATRIX[env]) return fmtMatrix(env, body)
      if (env === 'cases') {
        return '{ ' + String(body).split('\\\\').map((r) => r.split('&').map((c) => c.trim()).join(' , ')).join(' ; ') + ' }'
      }
      return String(body).replace(/&/g, ' ').replace(/\\\\/g, ' ; ')
    })
    if (s === before) break
  }

  // 环境**没配平**时的兜底：上面那条正则要求 \begin 与 \end 成对且同名，
  // 流式截断、或 `\begin{pmatrix}` 和 `\end{pmatrix}` 落在不同块里就匹配不上。
  // 那时 \begin / \end 会一路走到"未知命令"分支，原样输出 "begin"/"end" 两个词 ——
  // 真机截图里就是公式后面跟了个孤零零的 "end"（用户报的"end 渲染失败"）。
  // 这里直接把残留的环境标记剥掉，宁可少一层矩阵括号，也不要露出源码词。
  s = s.replace(/\\begin\s*\{[^{}]*\}/g, '').replace(/\\end\s*\{[^{}]*\}/g, ' ')
  s = s.replace(/\\begin\b/g, '').replace(/\\end\b/g, ' ')

  // \boxed{…} / \fbox{…}：外框不表达语义，保留内容即可（否则会输出字面量 "boxed"）
  for (let guard = 0; guard < 4; guard++) {
    const before = s
    s = s.replace(/\\(boxed|fbox|framebox)\{([^{}]*)\}/g, '$2')
    if (s === before) break
  }

  // \text{…} / \mathrm{…} 外壳去掉，保留内容（真机实测 \text 支持中文，这是降级路径）
  s = s.replace(/\\(text|mathrm|mathit|mathbf|mathsf|mathtt|mbox|operatorname|boldsymbol)\{([^{}]*)\}/g, '$2')
  // 黑板体 / 花体
  s = s.replace(/\\mathbb\{([^{}]*)\}/g, (m, x) => mapLetters(x, BLACKBOARD))
  s = s.replace(/\\mathcal\{([^{}]*)\}/g, (m, x) => mapLetters(x, SCRIPT))
  // 组合变音符
  s = s.replace(/\\(hat|bar|vec|tilde|dot|ddot|acute|grave)\{([^{}]*)\}/g, (m, name, x) => accent(x, ACCENT[name]))
  // \overline{AB} / \underline{x}
  s = s.replace(/\\overline\{([^{}]*)\}/g, '$1\u0305')
  s = s.replace(/\\underline\{([^{}]*)\}/g, '$1\u0332')
  // \binom{n}{k} → C(n,k)
  s = s.replace(/\\binom\{([^{}]*)\}\{([^{}]*)\}/g, 'C($1,$2)')
  // \underbrace{a+b}_{n} / \overbrace
  s = s.replace(/\\(underbrace|overbrace)\{([^{}]*)\}/g, '$2')

  // 分式 / 根式：**必须让 frac 与 sqrt 交替反复跑到稳定**。
  // 正则只吃「内部不再含花括号」的一层，这正好等于"最内层"：嵌套时内层先被替换，
  // 外层下一轮才配得上。早期版本是"先跑完 frac、再跑一次 sqrt"，于是
  //   \frac{\ln(S/K)+\left(r+\frac{1}{2}\sigma^2\right)(T-t)}{\sigma\sqrt{T-t}}
  // 这类**分母带根号**的外层分式永远匹配不上 —— \frac 落到"未知命令"分支输出
  // 字面量 "frac"，分子分母糊成一行（真机截图里就是
  // "d₁=fracln(S/K)+(r+1/2σ²)(T-t)σ√(T-t)"）。这是"部分公式渲染失败"的主因。
  const wrapArg = (x) => (/^[0-9A-Za-zα-ωΑ-Ω]$/.test(x) ? x : '(' + x + ')')
  for (let guard = 0; guard < 32; guard++) {
    const before = s
    // \sqrt[3]{x} / \sqrt{x} / \sqrt2
    s = s.replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, (m, n, x) => eqSup(n) + '√(' + x + ')')
    s = s.replace(/\\sqrt\{([^{}]*)\}/g, (m, x) => '√(' + x + ')')
    s = s.replace(/\\sqrt\s?([0-9A-Za-z])/g, (m, x) => '√' + x)
    // \frac{a}{b} / \dfrac / \tfrac；a、b 是单字符时省括号
    s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (m, a, b) => wrapArg(a) + '/' + wrapArg(b))
    // 简写 \frac12 —— 模型很爱这么写，不带花括号
    s = s.replace(/\\[dt]?frac\s?([0-9A-Za-z])\s?([0-9A-Za-z])/g, (m, a, b) => a + '/' + b)
    if (s === before) break
  }

  // 上下标：^{...} / _{...} / ^x / _x
  s = s.replace(/\^\{([^{}]*)\}/g, (m, x) => eqSup(x))
  s = s.replace(/_\{([^{}]*)\}/g, (m, x) => eqSub(x))
  s = s.replace(/\^([0-9A-Za-z]{2,})/g, (m, x) => eqSup(x))
  s = s.replace(/_([0-9A-Za-z]{2,})/g, (m, x) => eqSub(x))
  s = s.replace(/\^([0-9A-Za-z+\-=()])/g, (m, x) => eqSup(x))
  s = s.replace(/_([0-9A-Za-z+\-=()])/g, (m, x) => eqSub(x))

  // 细间距命令 \, \; \: \! 和 "\ "：不处理会在公式里留下 "S\,Φ" 这种反斜杠痕迹
  // （它们不带字母，走不到下面的 \命令 分支）
  s = s.replace(/\\[,;:]/g, ' ').replace(/\\!/g, '').replace(/\\ /g, ' ')

  // 命令 → 符号
  // 注意：**不能**用 \b 结尾。`\pm1`、`\le2` 这种"命令紧跟数字"的写法里，
  // m 和 1 都是单词字符，\b 不成立，于是 \pm 原样留在公式里（实测截图
  // "r\pm1/2σ²"）。LaTeX 的命令名就是最长的字母串，贪心匹配才是对的。
  s = s.replace(/\\([a-zA-Z]+)/g, (m, name) => {
    if (Object.prototype.hasOwnProperty.call(SYMBOLS, name)) return SYMBOLS[name]
    return name // 未知命令保留名字，至少可读
  })
  // 字面花括号（\{ \}）先换成占位符：下面会统一删掉"分组用"的 {}，
  // 不先保护的话 "A_1=\{1" 会变成 "A₁=1"，把用户写的花括号吃掉。
  s = s.replace(/\\\{/g, '\u0001').replace(/\\\}/g, '\u0002')
  // \\ 换行 → 空格；其它转义
  s = s.replace(/\\\\/g, ' ').replace(/\\([{}$%&#_])/g, '$1')
  s = s.replace(/[{}]/g, '')
  s = s.replace(/\u0001/g, '{').replace(/\u0002/g, '}')
  // 上下标放弃字形时留下的占位符还原成 ^ / _
  s = s.replace(/\u0003/g, '^').replace(/\u0004/g, '_')
  // 注意：不要试图把 \left(\frac{a}{b}\right) 降级出的 ((a)/(b)) 收成 (a)/(b)，
  // 那会把 ln((T₂)/(T₁)) 变成 ln(T₂)/(T₁)，语义从 "ln 的比值" 变成 "ln 再除以"。
  // 多一层括号只是不好看，收掉是算错。
  s = s.replace(/[ \t]{2,}/g, ' ')
  return s.trim()
}

function mapLetters(x, table) {
  let out = ''
  for (let i = 0; i < x.length; i++) out += table[x.charAt(i)] || x.charAt(i)
  return out
}

function accent(x, mark) {
  if (!x) return ''
  // 变音符要贴到最后一个字符上（\hat{AB} → A B̂ 不成立，退化为整体加符）
  return x + mark
}

function mapScript(x, table) {
  let out = ''
  for (let i = 0; i < x.length; i++) {
    const ch = x.charAt(i)
    if (!Object.prototype.hasOwnProperty.call(table, ch)) return null
    out += table[ch]
  }
  return out
}

// 上下标参数里可能还带着**命令**（`e^{i\pi}`），此时命令还没被换成符号
// （命令→符号在下面几百行之后才跑）。不先展开的话 `\pi` 里的反斜杠会原样留下，
// 真机上就是 `eⁱ\ᵖⁱ` 这种带反斜杠的怪字（截图确认过）。
function expandInScript(x) {
  return String(x).replace(/\\([a-zA-Z]+)/g, (m, name) => (
    Object.prototype.hasOwnProperty.call(SYMBOLS, name) ? SYMBOLS[name] : name
  ))
}

// 逐字符映射。只有**标点**允许映射不上（`d_{1,2}` → `d₁,₂` 里的逗号）；
// 字母/符号映射不上就整段放弃，返回 null —— 否则会出现 `eⁱπ` 这种
// "一半抬上去一半没抬"的写法，读者分不清 π 到底在不在指数上。
const SCRIPT_PUNCT = /^[,.;:'\s]$/

function mapScriptLoose(x, table) {
  let out = ''
  let any = false
  for (let i = 0; i < x.length; i++) {
    const ch = x.charAt(i)
    if (Object.prototype.hasOwnProperty.call(table, ch)) { out += table[ch]; any = true }
    else if (SCRIPT_PUNCT.test(ch)) out += ch
    else return null
  }
  return any ? out : null
}

// 放弃上标字形时的写法：单字符直接跟在 ^ 后，多字符加括号。
// 用占位符\u0003/\u0004 代替 ^/_，否则后面的"单字符上标"规则会把 `^(iπ)` 里的
// `^(` 再吃一遍，输出 `e⁽iπ)`（真机验证时踩到）。
function wrapScript(x) {
  const s = String(x)
  return /^[0-9A-Za-zα-ωΑ-Ω]$/.test(s) ? s : '(' + s + ')'
}

function eqSup(x) {
  const arg = expandInScript(x)
  const s = mapScriptLoose(arg, SUP)
  return s === null ? '\u0003' + wrapScript(arg) : s
}

function eqSub(x) {
  const arg = expandInScript(x)
  const s = mapScriptLoose(arg, SUB)
  return s === null ? '\u0004' + wrapScript(arg) : s
}

// 括号/花括号是否配平（真机：不配平的公式渲染成 0×0 空白，必须提前拦下）
export function isBalanced(src) {
  const s = String(src || '')
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (c === '\\') { i++; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth < 0) return false }
  }
  const begins = (s.match(/\\begin\{/g) || []).length
  const ends = (s.match(/\\end\{/g) || []).length
  return depth === 0 && begins === ends
}

// 单行原生排版的宽度上限：936 宽减去左右各 12px padding → 912，留一点余量。
// 实测参考（34px 引擎）：`\sin^2\theta+\cos^2\theta=1` 约 250px；
// `x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}` 约 330px。下面的估算据此标定。
export const MATH_WIDTH_MAX = 860
export const MATH_TYPESET_MAX = 120 // 单行字符硬上限，防病态输入

// 行内公式"就地原生渲染"的宽度上限。
//
// 原生引擎字号锁死约 34px，塞进 15px 正文里比正文高一倍多。实验过：只要同一 flex 行
// 设 `align-items: center`，36px 高的公式和 15px 的文字并排并不难看（汉字在公式的
// 上下留白里居中），比"公式被抽出去独占一行、引导语孤零零留在上一行"好得多。
// 但整行只能容纳一行文字，公式一长就会把正文挤到下一行、反而更碎 —— 所以只放行短的：
// 200px 大约是 10~12 个字符，`E=mc^2`、`\frac{1}{2}`、`x^2+y^2=1` 都在里面。
export const INLINE_MATH_MAX = 200

// ---------- 宽度估算 ----------
//
// 旧实现把公式当线性字符串：每个非命令字符 17px、命令 34px、**每个 \frac 再加 60px**。
// 这等于把分式的分子和分母当作左右拼接，而它们其实是**上下叠放**：
//   d_1=\frac{\ln(S/K)+(r+\frac12\sigma^2)(T-t)}{\sigma\sqrt{T-t}}
// 真实宽度 ≈ max(分子, 分母) + 前缀 ≈ 600px（放得下），旧估算却算出 2131px，
// 于是被判"超宽"→ 断行 → 大分式断不动 → 掉进 Unicode 近似。
// 这就是"明明放得下却退化成纯文本"的根因，也是用户说的"长公式应尽量留在一行"。
//
// 现在的模型：递归下降，分式取两侧较大者，上下标按 0.62 折算，多行环境取最宽的那行。
// 标定系数 1.3 让估算**略偏保守**（宁可多留余量，也别被裁掉右边缘）。
const CHAR_W = 16
const CMD_W = {
  sum: 26, prod: 26, int: 24, iint: 26, oint: 26, coprod: 26,
  cdot: 20, times: 20, pm: 20, mp: 20, ast: 18, star: 18,
  le: 20, leq: 20, ge: 20, geq: 20, ne: 20, neq: 20, approx: 22, equiv: 22,
  to: 24, rightarrow: 26, leftarrow: 26, Rightarrow: 26, Leftrightarrow: 28,
  in: 20, notin: 22, forall: 20, exists: 20, partial: 18, nabla: 20, infty: 22,
  ldots: 24, cdots: 24, quad: 17, qquad: 34, left: 0, right: 0, big: 0, Big: 0,
  mathbf: 0, mathrm: 0, mathbb: 0, mathcal: 0, text: 0, operatorname: 0,
  langle: 12, rangle: 12, lfloor: 12, rfloor: 12, lceil: 12, rceil: 12
}
const CMD_FUNC = { sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1, ln: 1, log: 1, lg: 1, exp: 1, lim: 1, max: 1, min: 1, sup: 1, inf: 1, det: 1, sgn: 1, arg: 1, dim: 1, gcd: 1 }

// 取出从 i 开始的 { … } 组（平衡匹配）；没有花括号时按"下一个 token"处理
function takeGroup(s, i) {
  if (s.charAt(i) !== '{') {
    if (i >= s.length) return null
    if (s.charAt(i) === '\\') {
      const m = /^\\[a-zA-Z]+/.exec(s.slice(i))
      return m ? { body: m[0], next: i + m[0].length } : { body: s.charAt(i), next: i + 1 }
    }
    return { body: s.charAt(i), next: i + 1 }
  }
  let depth = 0
  for (let j = i; j < s.length; j++) {
    const c = s.charAt(j)
    if (c === '\\') { j++; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return { body: s.slice(i + 1, j), next: j + 1 } }
  }
  return { body: s.slice(i + 1), next: s.length } // 不配平：按剩余部分算
}

function widthOf(s) {
  let i = 0
  let total = 0
  while (i < s.length) {
    const c = s.charAt(i)
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i))
      if (!m) { i++; continue }
      const tok = m[0]
      const name = tok.slice(1)
      i += tok.length
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const a = takeGroup(s, i)
        if (a) i = a.next
        const b = takeGroup(s, i)
        if (b) i = b.next
        // 上下叠放：宽度取分子分母的较大者，只多一个分数线的内边距
        total += Math.max(widthOf(a ? a.body : ''), widthOf(b ? b.body : '')) + 14
        continue
      }
      if (name === 'sqrt') {
        if (s.charAt(i) === '[') { // 根指数
          const close = s.indexOf(']', i)
          if (close > 0) i = close + 1
        }
        const a = takeGroup(s, i)
        if (a) i = a.next
        total += widthOf(a ? a.body : '') + 24
        continue
      }
      if (name === 'begin') {
        const g = takeGroup(s, i)
        if (g) i = g.next
        const envName = g ? g.body.trim() : ''
        const endTok = '\\end{' + envName + '}'
        const endIdx = s.indexOf(endTok, i)
        const inner = endIdx >= 0 ? s.slice(i, endIdx) : s.slice(i)
        i = endIdx >= 0 ? endIdx + endTok.length : s.length
        // 环境内：\\ 分行（取最宽行），& 分列（同行相加）
        const rows = inner.split(/\\\\/)
        let w = 0
        for (let r = 0; r < rows.length; r++) {
          const cells = rows[r].split('&')
          let rw = 0
          for (let k = 0; k < cells.length; k++) {
            rw += widthOf(cells[k])
            if (k) rw += 14
          }
          if (rw > w) w = rw
        }
        // 矩阵/分段还有括号与列间距，实测比纯字宽多出两三成
        total += Math.round(w * 1.25) + 16
        continue
      }
      if (name === 'end') {
        const g = takeGroup(s, i)
        if (g) i = g.next
        continue
      }
      if (CMD_FUNC[name]) { total += name.length * 15; continue }
      if (name === 'mathbf' || name === 'mathrm' || name === 'text' || name === 'mathit' ||
          name === 'mathbb' || name === 'mathcal' || name === 'mathsf' || name === 'mathtt' ||
          name === 'operatorname' || name === 'boldsymbol' || name === 'mbox') {
        const a = takeGroup(s, i)
        if (a) { total += widthOf(a.body); i = a.next }
        continue
      }
      total += CMD_W[name] !== undefined ? CMD_W[name] : 18
      continue
    }
    if (c === '^' || c === '_') {
      i++
      const a = takeGroup(s, i)
      if (a) {
        total += Math.round(widthOf(a.body) * 0.62) + 2
        i = a.next
      }
      continue
    }
    if (c === '{' || c === '}') { i++; continue }
    if (c === '&') { total += 16; i++; continue }
    if (c === ' ') { total += 8; i++; continue }
    if ('()[]|'.indexOf(c) >= 0) { total += 10; i++; continue }
    if (c === '=' || c === '+' || c === '-' || c === '<' || c === '>' || c === '±') { total += 20; i++; continue }
    if (c === ',' || c === ';' || c === ':' || c === '.') { total += 8; i++; continue }
    total += CHAR_W
    i++
  }
  return total
}

// 估算原生排版后的像素宽度。
// 多行环境（aligned / cases / matrix）各行的排版宽度取**最宽的那行**，
// 而不是把 \\ 两侧当成两行字符串累加 —— 这也是"4 行 Maxwell 方程被判超宽"的原因。
//
// 标定：拿真机截图量墨迹宽度反推。三角恒等式 250px、求根公式 330px、
// 2×2 矩阵 + det 展开 895px。模型对复杂式子偏窄，所以乘 1.55 作为安全系数
// （偏保守一点点，远好过把右边裁掉）。
const WIDTH_SAFETY = 1.55

export function estimateWidth(src) {
  const s = String(src || '')
  if (!s) return 0
  const rows = splitTopRows(s)
  let max = 0
  for (let i = 0; i < rows.length; i++) {
    const w = widthOf(rows[i])
    if (w > max) max = w
  }
  return Math.round(max * WIDTH_SAFETY)
}

// 只在**环境之外**按 \\ 分行：aligned/matrix 内部的 \\ 是换行符，属于它们自己
function splitTopRows(s) {
  const out = []
  let cur = ''
  let env = 0
  let i = 0
  while (i < s.length) {
    const c = s.charAt(i)
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i))
      const tok = m ? m[0] : c
      if (tok === '\\\\') {
        if (env > 0) { cur += ' \\\\ '; i += 2; continue }
        out.push(cur)
        cur = ''
        i += 2
        continue
      }
      const name = tok.slice(1)
      if (name === 'begin') env++
      else if (name === 'end') env = Math.max(0, env - 1)
      cur += tok
      i += tok.length
      continue
    }
    cur += c
    i++
  }
  if (cur) out.push(cur)
  return out
}

// 这条公式是否**必须竖排**（分式叠放、根号、求和号、矩阵……）。
//
// 用于行内公式的提升判定：行内公式默认走 Unicode 近似（原生字号固定 34px，
// 塞进 15px 正文会把整行撑断）。但像
//   \(x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}\)
// 这种一旦压成一行就变成 "x=(-b±√(b²-4ac))/(2a)" —— 分式结构是数学语义的
// 一部分，压平后读者要自己在脑子里还原分数线。这类**提升为独立公式行**用原生
// 排版；`\(E=mc^2\)` 这种本来就该横向写的，继续留在正文里，不占格子。
const NEED_DISPLAY = /\\[dt]?frac|\\binom|\\begin\{|\\sum|\\prod|\\int|\\oint|\\iint|\\overbrace|\\underbrace|\\lim|\\stackr?el|\\overset|\\underset/

export function needsDisplayMath(src) {
  return NEED_DISPLAY.test(String(src || ''))
}

// 这一行是不是"没写定界符的裸 LaTeX"。
//
// 模型（尤其被要求"直接写题、别解释格式"时）经常整行甩出 `I=\int_0^1 \frac{..}{..}\,dx`
// 而不包 `$` 或 `\[ \]`。这类行以前会被当普通文字，屏幕上就是一片反斜杠源码。
// 判定刻意保守 —— 误判的代价（把一句英文当公式排出来）比漏判更大：
//   · 不含汉字（有汉字就一定夹着说明文字）
//   · 不是列表/标题/引用/表格/围栏/网址
//   · 至少含一个"只可能来自 LaTeX"的命令（\frac \int \theta …）
//   · 去掉命令之后，剩下的多字母英文单词少于 2 个（"the integral of x" 会被这条挡住）
//   · 花括号/环境配平（不配平的原生会画成 0×0 空白）
const BARE_CMD = /\\(frac|dfrac|tfrac|sqrt|int|iint|iiint|oint|sum|prod|coprod|lim|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega|infty|partial|nabla|cdot|times|div|pm|mp|le|leq|ge|geq|ne|neq|approx|equiv|sim|propto|to|rightarrow|leftarrow|Leftrightarrow|Rightarrow|in|notin|subset|subseteq|cup|cap|setminus|mathbb|mathcal|mathbf|mathrm|text|operatorname|boxed|begin|left|right|sin|cos|tan|cot|sec|csc|ln|log|exp|det|max|min|quad|qquad|cdots|ldots|dots|overline|underline|vec|hat|bar|tilde|binom)/
const BARE_BLOCK_START = /^(\s*[-*+]\s|\s*\d+[.)]\s|\s*#{1,6}\s|\s*>|\s*\||\s*```|\s*https?:\/\/)/

export function looksLikeBareMath(line) {
  const s = String(line == null ? '' : line).trim()
  if (!s || s.length < 4 || s.length > 2000) return false
  if (/[\u4e00-\u9fa5\u3040-\u30ff]/.test(s)) return false
  if (BARE_BLOCK_START.test(s)) return false
  if (!BARE_CMD.test(s)) return false
  // 去掉命令后还剩 ≥2 个多字母英文单词 → 是句子，不是公式
  const plain = s.replace(/\\[a-zA-Z]+/g, ' ')
  const words = plain.match(/[A-Za-z]{3,}/g) || []
  if (words.length >= 2) return false
  if (!isBalanced(s)) return false
  // 纯 `\alpha \beta` 这种没有关系的也不算（多半是行文里的符号罗列）
  return /[=<>]|\\frac|\\sqrt|\\int|\\sum|\\prod|\\lim|_|\^/.test(s)
}

// `\\[4pt]` 是 amsmath 给矩阵行加间距的可选参数，固件引擎**不认**：
// 它把 `\\` 当普通换行、把 "[4pt]" 当公式内容原样画出来，于是矩阵变成
//   ( 1  1/2
//   [4pt] √2  e^(iπ) )
// 行距不表达任何数学含义，交给原生前统一还原成普通换行。
export function stripRowSpacing(src) {
  return String(src == null ? '' : src).replace(/\\\\\s*\[[^\]]{0,12}\]/g, '\\\\')
}

// `\qquad` 是 2em 的空白，34px 字号下约 68px。模型爱用它把「两个独立的值」或
// 「公式 + 成立条件」并排写：
//     0,\qquad -\frac1{4\sqrt3}=-\frac{\sqrt3}{12}
// 在 936px 宽的屏上，这 68px 的空洞会把 `0,` 和后面的等式彻底切开 —— 实测
// 逗号到减号之间空了 77px，读起来像两段互不相干的内容（还以为是排版错乱）。
// 处理成：逗号/分号后面的（列表分隔）收成 `\;`；其余顶层的收成 `\quad`。
// 多行环境（aligned/matrix）里的间距参与对齐，一律不动。
export function tightenMathSpaces(src) {
  const s = String(src == null ? '' : src)
  if (!/\\(qquad|quad)/.test(s)) return s
  if (/\\begin\s*\{/.test(s)) return s
  let out = ''
  let depth = 0
  let lastSig = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (c === '\\') {
      const m = /^\\(qquad|quad)(?![a-zA-Z])/.exec(s.slice(i))
      if (m) {
        if (depth === 0) {
          const isList = lastSig === ',' || lastSig === ';'
          out += isList ? '\\;' : '\\quad'
        } else {
          out += m[0]
        }
        i += m[0].length - 1
        lastSig = 'c'
        continue
      }
      out += c
      let j = i + 1
      while (j < s.length && /[a-zA-Z]/.test(s.charAt(j))) j++
      if (j > i + 1) { out += s.slice(i + 1, j); i = j - 1 }
      lastSig = 'c'
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth = Math.max(0, depth - 1)
    out += c
    if (!/\s/.test(c)) lastSig = c
  }
  return out
}

// 能否交给原生 LaTeX 排版
export function canTypeset(src, maxWidth) {
  const limit = maxWidth || MATH_WIDTH_MAX
  const s = String(src || '').trim()
  if (!s) return false
  // 长度按**最长一行**判，而不是整段：aligned 环境本来就有 5 行
  const rows = s.split(/\\\\/)
  for (let i = 0; i < rows.length; i++) if (rows[i].length > MATH_TYPESET_MAX * 2) return false
  if (!isBalanced(s)) return false
  // 只放行实测能排的环境；其余（array/substack/…）走回退，避免渲染成 0×0 空白
  const envs = s.match(/\\begin\{([a-zA-Z*]+)\}/g) || []
  for (let i = 0; i < envs.length; i++) {
    const name = envs[i].replace(/\\begin\{|\}/g, '')
    if (!ENV_OK[name]) return false
  }
  // 纯数字的 "$100" 之类不是公式
  if (/^[\d.,\s]+$/.test(s)) return false
  if (estimateWidth(s) > limit) return false
  return true
}

// 关系运算符之后断行最自然（"a = b ≈ c" 拆成两行仍成立）。
// 这些命令各自成词，扫描到就能直接当断点。
const REL_BREAK = {
  le: 1, leq: 1, ge: 1, geq: 1, ne: 1, neq: 1, equiv: 1, approx: 1, sim: 1, simeq: 1, cong: 1,
  propto: 1, ll: 1, gg: 1, to: 1, rightarrow: 1, Rightarrow: 1, Leftrightarrow: 1, leftrightarrow: 1,
  subset: 1, subseteq: 1, supset: 1, supseteq: 1, in: 1, notin: 1
}

// 把超宽公式按顶层运算符切成几段（= + - , ; \\ 以及关系符、\quad），再贪心合并成多行。
// 切不动（某一段自己就超宽，典型例子是单个大分式）时返回 []，调用方退回 Unicode。
export function splitMathLines(src, maxWidth) {
  const limit = maxWidth || MATH_WIDTH_MAX
  const s = String(src || '').trim()
  if (!s) return []
  if (estimateWidth(s) <= limit) return [s]

  // 带 \begin{…} 的公式**一律不断行**。
  // 环境是靠 \begin/\end 配对的，在 `,` 或 `=` 处切开会让第一段缺 \end、
  // 第二段缺 \begin —— 真机上就是整块 0×0 空白（比右边被裁掉一点糟得多）。
  // 超宽就交给原生整块排，右边缘裁几个像素可以接受。
  if (/\\begin\s*\{/.test(s)) return []

  const segs = []
  let cur = ''
  let depth = 0   // 花括号层数
  let envDepth = 0 // \begin{…} 层数
  let i = 0
  while (i < s.length) {
    const c = s.charAt(i)
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i))
      const tok = m ? m[0] : c
      if (tok === '\\\\') {
        // 环境内部的 \\ 是**换行符**，不是可断点：拆开会让 \begin/\end 分家
        if (envDepth > 0) { cur += ' \\\\ '; i += 2; continue }
        segs.push(cur + ' ')
        cur = ''
        i += 2
        continue
      }
      const name = tok.slice(1)
      if (name === 'begin') envDepth++
      else if (name === 'end') envDepth = Math.max(0, envDepth - 1)
      // \quad / \qquad 本来就是视觉分隔符，断行时直接吃掉（环境内部不动它）
      if ((name === 'quad' || name === 'qquad') && envDepth === 0) {
        if (cur.trim()) { segs.push(cur); cur = '' }
        i += tok.length
        continue
      }
      cur += tok
      i += tok.length
      if (depth === 0 && envDepth === 0 && REL_BREAK[name]) { segs.push(cur); cur = '' }
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth = Math.max(0, depth - 1)
    // 减号断在**号前**：`A - B` 拆开时 '-' 要跟着后半段走，否则前半段以减号结尾
    if (depth === 0 && envDepth === 0 && c === '-' && cur.trim() !== '' && !/[+\-=,(]$/.test(cur.trim())) {
      segs.push(cur)
      cur = ''
    }
    cur += c
    i++
    // 断点放在运算符之后：`x = ` / `a + ` …… 视觉上更好读
    if (depth === 0 && envDepth === 0 && (c === '=' || c === '+' || c === ',' || c === ';')) {
      segs.push(cur)
      cur = ''
    }
  }
  if (cur.trim()) segs.push(cur)
  if (segs.length < 2) return []

  const lines = []
  let acc = ''
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k].trim()
    if (!seg) continue
    if (estimateWidth(seg) > limit) return [] // 单段就放不下，断行救不了
    const next = acc ? acc + ' ' + seg : seg
    if (acc && estimateWidth(next) > limit) {
      lines.push(acc)
      acc = seg
    } else {
      acc = next
    }
  }
  if (acc) lines.push(acc)
  return lines.length > 1 ? lines : []
}

// 把一段文本切成 text / math 片段。
// 支持 $$…$$（块级）、$…$、\[…\]（块级）、\(…\)
// 货币风格误判防护：$ 后紧跟空白、或配对内容两侧有空格、或内容是纯数字，都不当公式。
//
// 未闭合的处理很关键：流式输出时 `\(\Delta S = nC_V\ln` 这种半截公式很常见。
// 早期版本把落单的 `\(` 直接丢掉、后面按普通文本渲染，屏幕上就会出现
// "S=k_B\ln\Omega" 这种原始 LaTeX 源码。现在改成：把剩余部分当成公式片段，
// 交给 Unicode 近似显示 —— 半截也读得懂，且不会再漏源码。
export function splitMath(text) {
  const s = String(text == null ? '' : text)
  const out = []
  let buf = ''
  let i = 0

  // 纯文本段里的 LaTeX 转义（\{ \} \$ \% \& \# \_）要还原成原字符，
  // 否则截断的残句会留下 "A_1=\{1" 这种原文痕迹。
  const unescape = (t) => t.replace(/\\([{}$%&#_])/g, '$1')
  const pushText = () => {
    if (buf) { out.push({ type: 'text', value: unescape(buf) }); buf = '' }
  }
  const pushMath = (value, display) => {
    pushText()
    // 定界符内侧的空格没有意义（`\[ I=e-2 \]`），去掉后再交给排版，
    // 否则宽度估算和断行判断都会多算一截，公式还会左右各空一格。
    out.push({ type: 'math', value: stripRowSpacing(String(value == null ? '' : value).trim()), display: !!display })
  }

  while (i < s.length) {
    const rest = s.slice(i)

    if (rest.indexOf('$$') === 0) {
      const end = s.indexOf('$$', i + 2)
      if (end > i + 2) {
        pushMath(s.slice(i + 2, end), true)
        i = end + 2
        continue
      }
      // 未闭合：吃掉定界符，剩下全当公式（多半是被截断的流式中间态）
      pushMath(s.slice(i + 2), true)
      i = s.length
      continue
    }
    if (rest.indexOf('\\[') === 0) {
      const end = s.indexOf('\\]', i + 2)
      if (end > i + 2) {
        pushMath(s.slice(i + 2, end), true)
        i = end + 2
        continue
      }
      pushMath(s.slice(i + 2), true)
      i = s.length
      continue
    }
    if (rest.indexOf('\\(') === 0) {
      const end = s.indexOf('\\)', i + 2)
      if (end > i + 2) {
        pushMath(s.slice(i + 2, end), false)
        i = end + 2
        continue
      }
      pushMath(s.slice(i + 2), false)
      i = s.length
      continue
    }
    // 落单的 `\]` / `\)`：它一定是某个 `\[` / `\(` 的收尾，但开定界符可能在
    // 上一段甚至上一块里（模型断行、或历史上被段落吞并过）。留在文本里就是
    // 屏幕上一条孤零零的 "\]"（真机截图里就有）。这里直接吞掉。
    if (rest.indexOf('\\]') === 0 || rest.indexOf('\\)') === 0) {
      i += 2
      continue
    }
    const c = s.charAt(i)
    if (c === '\\') {
      // `\$` 是转义美元符，`\{` 是转义花括号；这两个别当命令吞掉
      const nxt = s.charAt(i + 1)
      if (nxt === '$' || nxt === '{' || nxt === '}' || nxt === '\\') { buf += s.substr(i, 2); i += 2; continue }
      buf += c
      i++
      continue
    }
    if (c === '$') {
      const end = findInlineDollarEnd(s, i + 1)
      if (end > i + 1) {
        pushMath(s.slice(i + 1, end), false)
        i = end + 1
        continue
      }
    }
    buf += c
    i++
  }
  pushText()
  return out
}

function findInlineDollarEnd(s, from) {
  if (from >= s.length) return -1
  if (/\s/.test(s.charAt(from))) return -1 // "$ 100" 不是公式
  for (let j = from; j < s.length; j++) {
    const c = s.charAt(j)
    if (c === '\\') { j++; continue }
    if (c === '$') {
      if (/\s/.test(s.charAt(j - 1))) return -1 // "$100 和 $" 这类货币写法
      const body = s.slice(from, j)
      if (!body.trim()) return -1
      if (/^[\d.,\s]+$/.test(body)) return -1
      return j
    }
  }
  return -1
}
