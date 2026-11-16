import { createApp } from './lib/app.js'
import { log, initLog } from './services/platform.js'
import { APP_VERSION } from './lib/appversion.js'
import { plan, setFit, DESIGN_W } from './lib/fit.js'

export default createApp({
  // 逻辑坐标已是 936×280（面板 280×936 + direction 90）。路线 A：宽度钉死交给
  // setViewPort(936) 铺满，整屏高度由页面按 stageH 内联注入。setViewPort 默认 0
  // 会在 onLaunch 里被覆盖成 plan() 的 viewPort（恒 936）。
  setViewPort: 0,
  onLaunch(options) {
    // 日志初始化放最前面：后面每个页面出问题都要靠这份日志定位。
    // 不 await —— 首帧不该等文件 IO，sink 是同步设好的，await 之后的只有回灌旧日志。
    initLog(APP_VERSION)
    log('app launch', JSON.stringify(options || {}))

    // 多分辨率自适应 —— 路线 A：宽度铺满 + 纵向重排。
    // 宽度交给 setViewPort(936)：框架把 936 逻辑 px 等比铺满真实宽 W（无黑边）。
    // 只有「整屏高度」按真实宽高比重算 stageH = 936*H/W，页面根容器/全屏浮层
    // 内联注入 height:stageH，框架再按 k=W/936 放大回 H，正好铺满屏高。
    // 936×280 基准机 stageH=280 → 零变化；960×266 → stageH=259.35 铺满；900×300 → 312。
    // 必须在 onLaunch 里同步完成：框架在 onLaunch 返回后才读 this.viewPort。
    try {
      const env = ($falcon && $falcon.env) || {}
      const p = plan({ width: env.deviceWidth, height: env.deviceHeight })
      if (p.ok) {
        // 路线 A 恒调 setViewPort(936)：936×280 上 k=1 天然等于不缩放，零风险。
        // 不调的话窄屏（800 宽）会把 936px 的根容器原样排进去，右侧裁 136px。
        this.setViewPort(p.viewPort)
        setFit(p)
        log('fit', 'stageH=' + p.stageH + ' scale=' + p.scale +
          ' screen=' + p.w + 'x' + p.h + (p.apply ? '' : ' (design, zero-change)'))
      } else {
        // env 脏值 / 读不到：保持默认骨架（setFit 里的 936×280），不缩放。
        setFit(null)
        log('fit', 'screen-unknown, keep design ' + DESIGN_W)
      }
    } catch (e) {
      // 任何异常都不该影响启动，退回设计稿。setViewPort 缺失/抛错时页面仍读默认骨架。
      setFit(null)
      log('fit', 'error ' + String(e && e.message ? e.message : e))
    }
  },
  onShow() {
    log('app show')
  },
  onHide() {
    log('app hide')
  }
})
