// 模拟器调试桩：桌面模拟器没有 global 原生模块，import global 会导致整页白屏。
// 构建时用 `mock: true` 让 aiot-vue-cli 的 pluginVirtual 用本文件替换 `import globalModule from 'global'`。
// 只做「让页面能渲染」的最小实现：Global 类 + execShell 恒返回 false。
export class Global {
  constructor() {}
  execShell() { return false }
}
export default { Global }
