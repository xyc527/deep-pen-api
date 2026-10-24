<template>
    <div class="lb-page">
        <div class="lb-top">
            <text class="lb-title">LaTeX 诊断 {{ page + 1 }}/{{ pages }}</text>
            <div class="lb-chip" @click="prev"><text class="lb-chiptxt">上一页</text></div>
            <div class="lb-chip" @click="next"><text class="lb-chiptxt">下一页</text></div>
            <text class="lb-hint">上=原生排版　下=Unicode 回退</text>
        </div>
        <div class="lb-grid">
            <div v-for="(c, ci) in cells" :key="ci" class="lb-cell">
                <text class="lb-label">{{ c.no }} {{ c.note }}</text>
                <richtext class="lb-native" :style="c.size ? { fontSize: c.size } : {}"><latex :value="c.src"></latex></richtext>
                <text v-if="c.uni" class="lb-uni">{{ c.uni }}</text>
            </div>
        </div>
    </div>
</template>

<script>
import { latexToUnicode, isBalanced } from '../../lib/latex.js'

// 诊断语料：覆盖模型实际会写出来的各类 LaTeX 构造。
// 每页 6 条（3 列 × 2 行），目的是肉眼比对"原生排版"能否出图、
// 以及"Unicode 回退"是否可读 —— 决定 canTypeset 的白名单该怎么写。
const CORPUS = [
  { src: 'E=mc^2', note: '基本' },
  { src: '\\frac{a}{b}', note: '分式' },
  { src: '\\frac{\\partial^2 u}{\\partial x^2}', note: '偏导' },
  { src: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}', note: '求根' },
  { src: '\\int_0^1 x^2\\,dx=\\frac{1}{3}', note: '积分' },
  { src: '\\sum_{i=1}^{n} i=\\frac{n(n+1)}{2}', note: '求和' },
  { src: '\\lim_{x\\to 0}\\frac{\\sin x}{x}=1', note: '极限' },
  { src: '\\sqrt[3]{x+1}', note: 'n次根' },
  { src: '\\left(\\frac{a}{b}\\right)^2', note: 'left/right' },
  { src: '\\vec{F}=m\\vec{a}', note: '向量' },
  { src: '\\hat{y}=\\sigma(Wx+b)', note: 'hat' },
  { src: '\\bar{x}=\\frac{1}{n}\\sum x_i', note: 'bar' },
  { src: '\\alpha\\beta\\gamma\\Delta\\Omega', note: '希腊' },
  { src: '\\mathbb{R}^n', note: 'mathbb' },
  { src: '\\mathcal{L}', note: 'mathcal' },
  { src: '\\text{速度}=\\frac{s}{t}', note: '中文text' },
  { src: '\\begin{cases}x=1\\\\y=2\\end{cases}', note: 'cases' },
  { src: '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', note: '矩阵' },
  { src: 'P(A|B)=\\frac{P(B|A)P(A)}{P(B)}', note: '贝叶斯' },
  { src: '\\nabla\\cdot\\mathbf{E}=\\frac{\\rho}{\\varepsilon_0}', note: 'nabla' },
  { src: 'e^{i\\pi}+1=0', note: '欧拉' },
  { src: '\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^n=e', note: '重要极限' },
  { src: '\\binom{n}{k}', note: '组合数' },
  { src: '\\overline{AB}', note: '上划线' },
  { src: '\\underbrace{a+b}_{n}', note: 'underbrace' },
  { src: '\\sqrt{\\frac{a}{b}}', note: '根号分式' },
  { src: '\\sin^2\\theta+\\cos^2\\theta=1', note: '三角' },
  { src: '\\log_2 n', note: '对数' },
  { src: 'a\\ne 0,\\;a\\ge b', note: '关系符' },
  { src: '\\Delta S=nC_V\\ln\\frac{T_2}{T_1}+nR\\ln\\frac{V_2}{V_1}', note: '长公式A' },
  { src: 'H(X)=-\\sum_{i}p_i\\log p_i', note: '信息熵' },
  { src: '\\frac{\\partial}{\\partial t}\\int_{\\Omega}\\rho\\,dV+\\oint_{\\partial\\Omega}\\rho\\vec{v}\\cdot d\\vec{A}=0', note: '超长' },
  { src: '\\Theta(n\\log n)', note: '复杂度' },
  { src: 'x_{i}^{2}', note: '上下标' },
  { src: 'S=k_B\\ln\\Omega', note: '玻尔兹曼' },
  { src: '\\int_{-\\infty}^{\\infty}e^{-x^2}dx=\\sqrt{\\pi}', note: '高斯积分' }
]

// 字号实验：同一个公式放进不同 font-size 的 richtext 里，
// 看原生 LaTeX 是否跟随容器字号缩放（决定要不要用"缩小字号"解决溢出）。
const SIZE_TEST = [12, 15, 18, 22, 26, 30]

const PER_PAGE = 6

export default {
    name: 'latexlab',
    data() {
        return { page: 0, auto: true, timer: null }
    },
    computed: {
        pages() {
            return Math.ceil(CORPUS.length / PER_PAGE) + 1
        },
        isSizePage() {
            return this.page >= Math.ceil(CORPUS.length / PER_PAGE)
        },
        cells() {
            const out = []
            if (this.isSizePage) {
                for (let i = 0; i < SIZE_TEST.length; i++) {
                    out.push({
                        no: i + 1,
                        src: 'E=mc^2+\\frac{a}{b}',
                        note: 'font-size ' + SIZE_TEST[i] + 'px',
                        size: SIZE_TEST[i] + 'px',
                        uni: ''
                    })
                }
                return out
            }
            const start = this.page * PER_PAGE
            for (let i = start; i < start + PER_PAGE && i < CORPUS.length; i++) {
                const c = CORPUS[i]
                out.push({
                    no: i + 1,
                    src: c.src,
                    note: c.note + (isBalanced(c.src) ? '' : ' [不配平]'),
                    uni: latexToUnicode(c.src)
                })
            }
            return out
        }
    },
    mounted() {
        // 本机触摸注入在这种"公式铺满屏"的页面上会被原生 latex 的热区吃掉，
        // 所以不依赖点击翻页：定时自动翻，验收脚本按固定间隔截图即可。
        const self = this
        this.timer = setInterval(function () {
            if (!self.auto) return
            self.page = (self.page + 1) % self.pages
        }, 4000)
    },
    unmounted() {
        if (this.timer) clearInterval(this.timer)
        this.timer = null
    },
    methods: {
        prev() {
            if (this.page > 0) this.page--
        },
        next() {
            if (this.page < this.pages - 1) this.page++
        }
    }
}
</script>

<style>
.lb-page {
    width: 936px;
    height: 280px;
    flex-direction: column;
    background-color: #101014;
}

.lb-top {
    height: 32px;
    flex-direction: row;
    align-items: center;
    padding-left: 10px;
    padding-right: 10px;
    background-color: #1e1e24;
}

.lb-title {
    font-size: 13px;
    color: #e8e8ee;
    margin-right: 10px;
}

.lb-chip {
    flex-direction: row;
    align-items: center;
    height: 22px;
    padding-left: 8px;
    padding-right: 8px;
    border-radius: 5px;
    background-color: #2a2a33;
    margin-right: 6px;
}

.lb-chiptxt {
    font-size: 11px;
    color: #b8b8c6;
}

.lb-hint {
    font-size: 10px;
    color: #6d6d7c;
    flex: 1;
    text-align: right;
}

.lb-grid {
    height: 248px;
    flex-direction: row;
    flex-wrap: wrap;
    align-content: flex-start;
}

.lb-cell {
    width: 312px;
    height: 82px;
    flex-direction: column;
    padding: 2px;
    border-width: 1px;
    border-color: #24242c;
}

.lb-label {
    font-size: 10px;
    color: #7cc4ff;
}

.lb-native {
    height: 40px;
    color: #ffffff;
}

.lb-uni {
    font-size: 11px;
    color: #9fe1cb;
    lines: 2;
    text-overflow: ellipsis;
}
</style>
