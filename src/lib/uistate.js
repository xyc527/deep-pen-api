// 跨页面的 UI 状态（同一个 JS 运行时内共享）
//
// 为什么需要它：小程序页面之间没有 props / emit，设置页把「主页显示余额」
// 关掉之后，首页那个**已经存在的页面实例**完全不知情 —— 它的 settings 还是
// 进设置页之前读出来的旧对象。实测固件返回上一页时也不会触发首页的 onShow
// （只有冷启动 / 从系统应用回来才触发），于是出现「点了隐藏，回首页芯片还在」。
//
// 这里用一个模块级单例 + 订阅：设置页改完立刻广播，首页实例（即使不在前台）
// 收到就改自己的 data，回去时已经是正确状态，不依赖 onShow 是否被调用。
//
// settings 整包也走这条通道：API Key / 服务地址 / 采样参数改了之后，
// 首页下一次发请求必须用新值 —— 否则「改了 Key 仍能继续聊」就是必然结果。
// rev 递增是为了让首页能判断"手上这份比广播的旧"，而不是逐字段比对。

const state = {
  showBalance: true,
  settings: null,
  settingsRev: 0,
  // 会话记录被整包换掉（导入存档）时用：设置没变，但首页手上的对话列表已经过期了
  chatsRev: 0,
  // 记忆被清空 / 重写：首页手上那份 memNotes 会过期，不清掉的话下次发消息
  // 又会把旧记忆折回去 —— 用户刚点完「清空」，记忆却自己长回来。
  memoryRev: 0,
  // 首页正在收回答。切人设 / 切模式会换掉整套档案，边收边换会让这一轮的分片
  // 写进另一个人的对话里，所以设置页切换前先看这一位。
  chatBusy: false
}

// 设置分类页的"要打开哪一页"：页面之间没有 props，navTo 的 options
// 在 Vue 页面（不是原生 page.js）里拿不到，所以用模块单例传参。
// 只是一个字符串，写在 navTo 之前，目标页 mounted 时读一次即可。
let _section = ''

export function setSection(id) {
  _section = String(id || '')
}

export function getSection() {
  return _section
}

const subs = []

function notify() {
  // 复制一份再遍历：回调里可能退订，直接迭代原数组会漏项
  const list = subs.slice()
  for (let i = 0; i < list.length; i++) {
    try { list[i](state) } catch (e) { /* 单个订阅出错不能影响其它页面 */ }
  }
}

export function getUiState() {
  return state
}

export function setUiState(patch) {
  let changed = false
  const keys = Object.keys(patch || {})
  for (let i = 0; i < keys.length; i++) {
    if (state[keys[i]] !== patch[keys[i]]) {
      state[keys[i]] = patch[keys[i]]
      changed = true
    }
  }
  if (!changed) return state
  notify()
  return state
}

// 广播整份设置（落盘成功之后调用）。rev 每次 +1，首页据此判断要不要换掉自己那份。
export function publishSettings(settings) {
  if (!settings) return state
  state.settings = settings
  state.settingsRev = state.settingsRev + 1
  state.showBalance = settings.showBalance !== false
  notify()
  return state
}

// 广播"对话记录变了"（导入存档之后）。不带上设置 —— 设置那一份有自己的通道
export function publishChats() {
  state.chatsRev = state.chatsRev + 1
  notify()
  return state
}

// 广播"记忆变了"（设置页清空记忆之后）。首页据此重读磁盘，避免旧记忆被折回去
export function publishMemory() {
  state.memoryRev = state.memoryRev + 1
  notify()
  return state
}

// 返回退订函数；页面 unmounted 时务必调用，否则旧实例会被一直持有
export function subscribeUiState(fn) {
  if (typeof fn !== 'function') return function () {}
  subs.push(fn)
  return function () {
    const i = subs.indexOf(fn)
    if (i >= 0) subs.splice(i, 1)
  }
}
