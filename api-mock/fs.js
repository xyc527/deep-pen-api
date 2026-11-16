// 模拟器调试桩：桌面模拟器没有 fs 原生模块，import fs 会导致整页白屏。
// 构建时用 `mock: true` 让 aiot-vue-cli 的 pluginVirtual 用本文件替换 `import fs from 'fs'`。
// 只做「让页面能渲染」的最小实现：读一律返回 null，写一律返回 false，
// 平台层的 readText/writeText 会走它自己的兜底路径（不会崩）。
export default {
  readFile() { return null },
  writeFile() { return false },
  writeFileSync() { return false },
  mkdir() { return false },
  exists() { return false },
  stat() { return null },
  readdir() { return null },
  rm() { return false },
  rename() { return false },
  copy() { return false }
}
