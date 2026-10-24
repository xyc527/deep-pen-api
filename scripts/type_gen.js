#!/usr/bin/env node
// 把一串 ASCII 文本翻译成「系统输入法」上的点击序列（供 send_event 注入）。
//
// 为什么需要：设备上没法直接把文本塞进输入法（injectKey 打不进 IME），
// 只能一个键一个键点。而触摸坐标是 **面板坐标系**，与逻辑坐标互为转置加镜像：
//     panel_x = logical_y,  panel_y = 936 - logical_x
// 手算 30 多个键必然出错，所以在这里用一张键位表自动生成。
//
// 用法：
//   node scripts/type_gen.js "sk-abc123"          # 打印 shell 命令
//   CMD=$(node scripts/type_gen.js "sk-abc"); bash scripts/dev.sh shell "$CMD"

const LOGICAL_W = 936

// 字母键盘（ABC 布局）
const L = {
  q: [45, 110], w: [130, 110], e: [215, 110], r: [300, 110], t: [385, 110],
  y: [470, 110], u: [555, 110], i: [640, 110], o: [725, 110], p: [810, 110],
  a: [130, 180], s: [210, 180], d: [295, 180], f: [380, 180], g: [465, 180],
  h: [550, 180], j: [635, 180], k: [720, 180], l: [805, 180],
  z: [135, 235], x: [220, 235], c: [305, 235], v: [390, 235], b: [475, 235],
  n: [560, 235], m: [645, 235],
  ' ': [770, 235],
  // 功能键
  BACKSPACE: [890, 110],
  TO_NUM: [890, 180],
  TO_ABC: [890, 180],
  CONFIRM: [877, 232],
}

// 数字/符号键盘
const N = {
  1: [45, 110], 2: [130, 110], 3: [215, 110], 4: [300, 110], 5: [385, 110],
  6: [470, 110], 7: [555, 110], 8: [640, 110], 9: [725, 110], 0: [810, 110],
  ',': [105, 180], '.': [190, 180], '?': [275, 180], '!': [360, 180],
  '@': [445, 180], ':': [530, 180], ';': [615, 180], '/': [700, 180],
  "'": [785, 180],
  '#': [55, 235], '&': [140, 235], '~': [225, 235], '%': [310, 235],
  '+': [395, 235], '-': [480, 235], '*': [565, 235], '÷': [650, 235],
  ' ': [770, 235],
}
// 数字键盘里 '-' 的键位与字母键盘 '+' 相近，直接用 N['-']

function tapCmd(lx, ly, gap) {
  const px = ly
  const py = LOGICAL_W - lx
  return `send_event touch press ${px} ${py} >/dev/null; ` +
         `send_event touch release ${px} ${py} >/dev/null; ` +
         `sleep ${gap}; `
}

function build(text, opts) {
  opts = opts || {}
  const gap = opts.gap || 0.18
  let layout = opts.layout || 'letters'   // 输入法当前布局
  let out = ''
  for (const ch of text) {
    // 空格在两种布局下位置相同，不需要切布局
    if (ch === ' ') {
      out += tapCmd(770, 235, gap)
      continue
    }
    let need
    if (Object.prototype.hasOwnProperty.call(N, ch)) {
      need = 'numbers'
    } else if (Object.prototype.hasOwnProperty.call(L, ch)) {
      need = 'letters'
    } else {
      throw new Error('键位表里没有字符: ' + JSON.stringify(ch))
    }
    if (need !== layout) {
      // 字母↔数字 切换键在两种布局下位置相同（右下角）
      out += tapCmd(890, 180, gap)
      layout = need
    }
    const pos = (need === 'letters' ? L : N)[ch]
    out += tapCmd(pos[0], pos[1], gap)
  }
  return out
}

const text = process.argv[2]
if (!text) {
  console.error('用法: node scripts/type_gen.js "要输入的文本" [起始布局 letters|numbers]')
  process.exit(2)
}
const startLayout = process.argv[3] || 'letters'
process.stdout.write(build(text, { layout: startLayout }))
