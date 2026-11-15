// 多分辨率自适应（letterbox 等比缩放）—— 纯函数，零平台依赖，Node 可测。
//
// 背景：本应用布局按 936×280（宽高比 3.343）设计，setViewPort 默认 0（不缩放）。
// 上架到全设备后，会遇到 960×266（比 3.61，更扁）这类机型：框架的 setViewPort 只按
// 「宽」定缩放比，写死的高度 280px 会被按宽放大到 287px，底部被裁 21px。
//
// 官方/PStore 常给的建议是「把写死的 px 换成 vw/vh」。字面照做会翻车：Weex 只认
// px/rpx/%/vw/vh，没有 calc()、没有 min()，「宽高两个方向都不溢出」要取
// min(W/936, H/280)，纯样式表表达不出来。只用 vw 会切底部，只用 vh 会切左右。
//
// 所以这里走「反解 viewport」路线：把设计稿整体等比缩进任意比例的屏（letterbox），
// 内容绝不变形。基准机 936×280 上 scale=1 → 不缩放，一个像素都不变。
//
// 数学：setViewPort(V) 语义是「1 逻辑 px = 真实宽/V 个真实像素」。
//   缩放后设计稿占真实宽 contentW = 936 * (W/V)，占真实高 contentH = 280 * (W/V)。
//   V = ceil(W / scale)，scale = min(W/936, H/280) —— 取较小者保证两个方向都放得下。
//   → V = ceil(max(936, 280*W/H))，恒 ≥ 936，宽恒装得下；高因 scale 取 min 也恒装得下。
//
// 判据要点（踩过）：
//  1. 「要不要调 setViewPort」的判据只能是 scale 是否等于 1，不能是 V 是否等于 936
//     —— 800×240 反解出的 V 恰好也是 936，但确实要缩放，跳过就会右侧裁 136px。
//  2. deviceWidth/deviceHeight 在部分固件上是否颠倒没有保证，用长边当宽归一。
//  3. 两数不同源 / 明显不是屏幕的脏值要退回设计稿，别缩放。

// 设计稿尺寸（宽高比 3.343，本机逻辑坐标）
export const DESIGN_W = 936
export const DESIGN_H = 280

// 守卫：明显不是一块横屏笔的取值（<200 宽、<60 高、比例 >6.7）视为脏数据
export function isSaneScreen(w, h) {
  if (!(w > 0 && h > 0)) return false
  if (w < 200 || h < 60) return false
  if (w / h > 6.7) return false
  return true
}

// 长边当宽归一：deviceWidth/Height 谁大谁当 W，横屏恒宽>高。
export function normalizeScreen(dw, dh) {
  const a = Number(dw) || 0
  const b = Number(dh) || 0
  const W = Math.max(a, b)
  const H = Math.min(a, b)
  return { w: W, h: H }
}

// 核心：给定真实屏幕宽高，算出反解的 viewport 值。
//
//   scale = min(W/936, H/280)      —— 两个方向都放得下，取较小的那个
//   V     = ceil(W/scale)          —— 反解设计宽，交给 setViewPort
//   contentW = 936 * W/V           —— 缩放后设计稿占真实宽（≤W）
//   contentH = 280 * W/V           —— 缩放后设计稿占真实高（≤H）
//
// 返回 { scale, viewPort, contentW, contentH, w, h }；脏值返回 null。
export function fitViewport(dw, dh) {
  const { w: W, h: H } = normalizeScreen(dw, dh)
  if (!isSaneScreen(W, H)) return null

  const scale = Math.min(W / DESIGN_W, H / DESIGN_H)
  const V = Math.ceil(W / scale)
  const contentW = (DESIGN_W * W) / V
  const contentH = (DESIGN_H * W) / V

  return {
    scale: round3(scale),
    viewPort: V,
    contentW: round1(contentW),
    contentH: round1(contentH),
    w: W,
    h: H
  }
}

// 一次算清「要不要缩放 + 怎么缩放」的完整计划，供 app.js 决策。
// env：{ width, height }（通常来自 $falcon.env，逻辑或物理像素都行——本函数只依赖比值）。
export function plan(env) {
  const e = env || {}
  const fit = fitViewport(e.width, e.height)
  if (!fit) {
    return { ok: false, apply: false, viewPort: DESIGN_W, reason: 'screen-unknown' }
  }
  const apply = Math.abs(fit.scale - 1) > 1e-3
  return {
    ok: true,
    apply,
    viewPort: fit.viewPort,
    ...fit,
    reason: apply ? 'scale' : 'design'
  }
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

function round1(n) {
  return Math.round(n * 10) / 10
}
