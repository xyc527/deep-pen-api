import { createApp } from './lib/app.js'
import { log, initLog } from './services/platform.js'
import { APP_VERSION } from './lib/appversion.js'

export default createApp({
  // 逻辑坐标已是 936×280（面板 280×936 + direction 90），不需要再缩放
  setViewPort: 0,
  onLaunch(options) {
    // 日志初始化放最前面：后面每个页面出问题都要靠这份日志定位。
    // 不 await —— 首帧不该等文件 IO，sink 是同步设好的，await 之后的只有回灌旧日志。
    initLog(APP_VERSION)
    log('app launch', JSON.stringify(options || {}))
  },
  onShow() {
    log('app show')
  },
  onHide() {
    log('app hide')
  }
})
