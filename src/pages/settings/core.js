// 设置页的公共状态与保存逻辑
//
// 两个页面都要它有：外层导航页（settings）和分类页（settingsx）。
// 这里不用 Vue 的 mixins，而是导出 data / computed / methods 三个纯对象让页面
// 自己 Object.assign 合并 —— 不依赖框架对 mixins 的支持程度（本机运行时是定制版，
// 少一个特性就是"点了没反应"这种难查的问题），而且合并关系一眼看得见。
//
// 保存规则（沿用 0.1.x 的行为，不能变）：
//   自动模式：改一项存一项（apply 里直接 persist）
//   手动模式：只留在内存，点顶栏「保存」才落盘；离开时第一次点只警告
//   每次落盘都 publishSettings 广播给首页 —— 返回上一页不触发 onShow

import { loadSettings, saveSettings, getLastSaveInfo } from '../../services/store.js'
import { settingsSignature } from '../../lib/settings.js'
import { publishSettings, setUiState, subscribeUiState } from '../../lib/uistate.js'
import { appDir, log } from '../../services/platform.js'

export function baseData() {
  return {
    settings: null,
    saveMsg: '',
    savedSig: '',
    dirty: false,
    leaveWarn: false,
    settingsRev: 0,
    uiUnsub: null,
    // 返回时跳到哪一页：外层页回首页，分类页回外层设置页
    exitTarget: 'index'
  }
}

export const baseComputed = {
  isAutoSave() {
    return !this.settings || this.settings.saveMode !== 'manual'
  },
  saveBtnLabel() {
    return this.dirty ? '保存' : '已保存'
  },
  saveBtnClass() {
    return this.dirty ? 'st-save-on' : 'st-save-off'
  },
  saveBtnTxtClass() {
    return this.dirty ? 'st-savetxt-on' : 'st-savetxt-off'
  }
}

export const baseMethods = {
  // 读盘 + 记录指纹 + 广播一次。
  // 广播是必须的：首页可能拿着旧值（先开首页再进设置），而返回上一页时
  // 固件不触发首页 onShow，只能靠这条通道。
  async coreLoad() {
    this.settings = await loadSettings()
    this.savedSig = settingsSignature(this.settings)
    this.dirty = false
    this.settingsRev = 0
    setUiState({ showBalance: this.settings.showBalance !== false })
    publishSettings(this.settings)
    return this.settings
  },

  // 订阅别的页面发来的设置变更（分类页保存后外层页要跟着变）
  coreSubscribe() {
    if (this.uiUnsub) return
    this.uiUnsub = subscribeUiState((s) => {
      if (!s.settings || s.settingsRev <= this.settingsRev) return
      this.settingsRev = s.settingsRev
      // 复制成自己的一份：广播过来的是别的页面持有的对象
      this.settings = Object.assign({}, s.settings, {
        params: Object.assign({}, s.settings.params),
        memory: Object.assign({}, s.settings.memory)
      })
      this.savedSig = settingsSignature(this.settings)
      this.dirty = false
    })
  },

  coreUnsubscribe() {
    if (this.uiUnsub) {
      this.uiUnsub()
      this.uiUnsub = null
    }
  },

  // 所有改动都走这里：整体换对象（不就地改字段），再按保存模式决定落盘还是待存。
  // 就地改深层字段在 Weex 上不保证触发 computed 重算（0.1.29 的 bug 根因）。
  apply(patch) {
    if (!this.settings) return false
    this.settings = Object.assign({}, this.settings, patch || {})
    try {
      if (this.isAutoSave) {
        this.persist()
      } else {
        this.saveMsg = ''
        this.refreshDirty()
      }
    } catch (e) {
      log('apply ERR ' + ((e && e.message) || e))
      return false
    }
    return true
  },

  refreshDirty() {
    if (!this.savedSig) { this.dirty = false; return }
    this.dirty = settingsSignature(this.settings) !== this.savedSig
    if (this.dirty) this.leaveWarn = false
  },

  // 落盘 + 广播。saveSettings 返回 null 表示写失败 —— 以前这个返回值被丢掉，
  // 写失败时界面一切正常，重启后设置全没了。
  persist() {
    if (!this.settings) return false
    const saved = saveSettings(this.settings)
    if (!saved) {
      const info = getLastSaveInfo()
      this.saveMsg = '保存失败：写入被拒绝'
      if (this.diagMsg != null) this.diagMsg = '上次保存失败：' + (info.reason || 'unknown') + '\n目标 ' + info.path
      this.refreshDirty()
      log('saveSettings 返回 null :: ' + info.reason)
      return false
    }
    this.settings = Object.assign({}, saved, {
      params: Object.assign({}, saved.params),
      memory: Object.assign({}, saved.memory)
    })
    this.savedSig = settingsSignature(saved)
    this.dirty = false
    this.leaveWarn = false
    this.saveMsg = '已保存'
    setUiState({ showBalance: saved.showBalance !== false })
    publishSettings(saved)
    this.verifySavedSoon(saved)
    return true
  },

  // 写一次不算数：本机 writeFile 会"不报错也不落盘"，必须读回比对
  verifySavedSoon(expected) {
    const sig = settingsSignature(expected)
    setTimeout(async () => {
      const disk = await loadSettings()
      if (!disk) return
      if (settingsSignature(disk) === sig) return
      this.saveMsg = '保存失败：写后读回不一致'
      if (this.diagMsg != null) this.diagMsg = '写后读回不一致，已记入日志\n目标 ' + appDir() + '/settings.json'
      log('settings 写后读回不一致')
    }, 300)
  },

  saveNow() {
    if (this.isAutoSave) { this.saveMsg = '当前是自动保存，无需手动保存'; return }
    if (!this.dirty) { this.saveMsg = '没有需要保存的改动'; return }
    this.persist()
  },

  toggleSaveMode() {
    if (!this.settings) return
    const next = this.isAutoSave ? 'manual' : 'auto'
    // 模式本身立刻落盘（切换动作不能丢），顺带把已有改动一起存了
    this.settings = Object.assign({}, this.settings, { saveMode: next })
    if (!this.persist()) return
    this.saveMsg = next === 'manual'
      ? '已切到手动保存：改完点右上「保存」'
      : '已切到自动保存：改动即时落盘'
    log('saveMode ' + next)
  },

  // 手动保存模式下有未保存改动：第一次点只提醒，再点一次才真的丢弃离开
  coreBack() {
    if (!this.isAutoSave && this.dirty && !this.leaveWarn) {
      this.leaveWarn = true
      this.saveMsg = '有未保存改动，再点一次将放弃'
      return
    }
    this.coreUnsubscribe()
    const target = this.exitTarget || 'index'
    // 动态取 navTo，避免本文件依赖 platform 的具体导出细节
    const nav = this.navToFn
    if (typeof nav === 'function') nav(target)
  }
}
