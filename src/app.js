import { createApp } from './lib/app.js'
import { log } from './services/platform.js'

export default createApp({
  // 逻辑坐标已是 936×280（面板 280×936 + direction 90），不需要再缩放
  setViewPort: 0,
  onLaunch(options) {
    log('app launch', JSON.stringify(options || {}))
  },
  onShow() {
    log('app show')
  },
  onHide() {
    log('app hide')
  }
})
