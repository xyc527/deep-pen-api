// 多分辨率自适应 —— 路线 A：宽度铺满 + 纵向重排（纯函数，零平台依赖，Node 可测）。
//
// 背景：本应用布局按 936×280（宽高比 3.343）设计。上架到全设备后，会遇到
// 960×266（更扁）、800×280（更窄）这类机型。框架的 setViewPort 只按「宽」定缩放比：
// setViewPort(936) 的语义是「1 逻辑 px = 实际宽 / 936 个真实像素」，高度也乘同一个比。
// 所以写死 height:280px 在 960×266 上会被放大到 287px，底部裁 21px；在 900×300 上
// 又缩成 270px，底部留白。
//
// 路线 A 的解法（skill `platform-facts.md` §6「确定的做法」）：
//   - 宽度继续交给 setViewPort(936)，让框架把 936 逻辑 px 等比铺满真实宽 W（无黑边）。
//   - 只有「整屏高度」按真实宽高比重算：stageH = 936 * H / W。
//     这样根容器注入 height:stageH 后，框架再按 k=W/936 放大回 H，正好铺满屏高。
//   - 内部凡是 flex:1 的容器自动跟着变，不用动；固定高度的列表项按 stageH 压缩。
//
// 数学自检：
//   936×280 → stageH = 936*280/936 = 280，k=1 → 零变化（设计稿原样）。
//   960×266 → stageH = 936*266/960 = 259.35，k=1.026 → 259.35*1.026 ≈ 266 铺满。
//   900×300 → stageH = 936*300/900 = 312，k=0.962 → 312*0.962 ≈ 300 铺满。
//
// 判据要点（踩过）：
//  1. deviceWidth/deviceHeight 是否颠倒没保证，用长边当宽归一。
//  2. 两数不同源 / 明显不是横屏笔的脏值要退回设计稿，别缩放。
//  3. 路线 A 只依赖 W、H 的比值，deviceWidth 报逻辑 936 还是物理 1080 都一样
//     （scale 按比值算，绝对值法才需要纠结逻辑/物理）。

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

// 核心计划：给定真实屏幕宽高，算出路线 A 需要的三个量。
//
//   viewPort = 936                     —— 交给 setViewPort，钉死宽度（铺满、无黑边）
//   scale    = W / 936                 —— 框架实际缩放比（k）
//   stageH   = 936 * H / W             —— 根容器/全屏浮层要注入的逻辑高（铺满屏高）
//
// 返回 { ok, apply, viewPort, scale, stageH, w, h, reason }；脏值返回 ok:false。
//
// apply 的语义 = 「是否与基准机 936×280 不同、需要动 stageH」。936×280 上 stageH=280，
// 与设计稿零差异 → apply=false（页面可跳过注入，沿用类名里的 280，行为不变）。
export function plan(env) {
  const e = env || {}
  const { w: W, h: H } = normalizeScreen(e.width, e.height)
  if (!isSaneScreen(W, H)) {
    return { ok: false, apply: false, viewPort: DESIGN_W, stageH: DESIGN_H, reason: 'screen-unknown' }
  }

  const scale = W / DESIGN_W
  const stageH = round1((DESIGN_W * H) / W)
  // 与基准机差异小于 0.5px 视为零变化（浮点抖动），页面沿用写死的 280。
  const apply = Math.abs(stageH - DESIGN_H) > 0.5

  return {
    ok: true,
    apply,
    viewPort: DESIGN_W,
    scale: round3(scale),
    stageH,
    w: W,
    h: H,
    reason: apply ? 'fit' : 'design'
  }
}

// 供页面注入的骨架尺寸。fit 是 plan() 的返回（或页面自己缓存的一份）。
//   rootW/rootH = 根容器逻辑宽高（rootW 恒 936，rootH=stageH）
//   factor      = 触摸位移换算比（触摸给真实像素，translate 吃设计 px）
export function layout(fit) {
  const f = fit || {}
  const stageH = f.stageH || DESIGN_H
  return {
    rootW: DESIGN_W,
    rootH: stageH,
    stageH,
    factor: f.scale || 1
  }
}

// 兼容旧导出：fitViewport 保留 letterbox 反解，供历史调用/测试参考。
// 路线 A 不再用它做整屏缩放，但保留以不破坏外部引用。
export function fitViewport(dw, dh) {
  const { w: W, h: H } = normalizeScreen(dw, dh)
  if (!isSaneScreen(W, H)) return null
  const scale = Math.min(W / DESIGN_W, H / DESIGN_H)
  const V = Math.ceil(W / scale)
  return {
    scale: round3(scale),
    viewPort: V,
    contentW: round1((DESIGN_W * W) / V),
    contentH: round1((DESIGN_H * W) / V),
    w: W,
    h: H
  }
}

// 运行时单例：app.js 在 onLaunch 里算好一次后存进来，页面 mounted 时读。
// 屏幕尺寸启动后不变，不需要订阅广播；这里只是跨模块传一份「算好的骨架」。
// 默认就是基准机 936×280 的骨架 —— 即使 app.js 的 fit 没跑起来（setViewPort
// 缺失 / env 读不到），页面读到这份默认值也和原来写死 936×280 完全一致，零风险。
let _fit = {
  ok: true,
  apply: false,
  viewPort: DESIGN_W,
  scale: 1,
  stageH: DESIGN_H,
  w: DESIGN_W,
  h: DESIGN_H,
  reason: 'default'
}

export function setFit(fit) {
  if (fit && fit.ok) _fit = fit
  return _fit
}

export function getFit() {
  return _fit
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

function round1(n) {
  return Math.round(n * 10) / 10
}
