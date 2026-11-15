import { createApp } from './lib/app.js'
import { log, initLog } from './services/platform.js'
import { APP_VERSION } from './lib/appversion.js'
import { plan, DESIGN_W } from './lib/fit.js'

export default createApp({
  // 逻辑坐标已是 936×280（面板 280×936 + direction 90），不需要再缩放
  setViewPort: 0,
  onLaunch(options) {
    // 日志初始化放最前面：后面每个页面出问题都要靠这份日志定位。
    // 不 await —— 首帧不该等文件 IO，sink 是同步设好的，await 之后的只有回灌旧日志。
    initLog(APP_VERSION)
    log('app launch', JSON.stringify(options || {}))

    // 多分辨率自适应（letterbox 等比缩放）。上架到全设备后，960×266 这类更扁的机型
    // 会把写死的高度 280px 按宽放大到底部被裁。这里按真实屏幕宽高反解 viewport，
    // 让设计稿整体等比缩进屏幕，内容不变形、不裁切。
    // 936×280 基准机 scale=1 → viewPort=936，等于不缩放，一个像素都不变。
    // 注意：必须在 onLaunch 里同步完成，框架在 onLaunch 返回后才读 this.viewPort。
    try {
      const env = ($falcon && $falcon.env) || {}
      const p = plan({ width: env.deviceWidth, height: env.deviceHeight })
      if (p.ok) {
        if (p.apply) {
          this.setViewPort(p.viewPort)
          log('fit', 'scale=' + p.scale + ' viewPort=' + p.viewPort +
            ' screen=' + p.w + 'x' + p.h + ' content=' + p.contentW + 'x' + p.contentH)
        }
        // scale=1 不调 setViewPort，保持默认 0（=不缩放），与旧行为完全一致。
      } else {
        log('fit', 'screen-unknown, keep design ' + DESIGN_W)
      }
    } catch (e) {
      // 任何异常都不该影响启动，退回设计稿不缩放。
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
