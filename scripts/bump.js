#!/usr/bin/env node
// 出包前递增版本号。
//
// 为什么要有这一步：amr 文件名是 `<appid>.<x_y_z>.amr`，版本号不变的时候
// 新包和旧包在设备上、在 /userdisk 里长得一模一样，出了问题分不清装的是哪一版。
// 约定：每次改代码 / 修 bug 出包前先跑一次，patch 位 +1（0.1.0 → 0.1.1）。
//
// 用法:
//   node scripts/bump.js            // patch +1（默认）
//   node scripts/bump.js minor      // 0.1.3 → 0.2.0
//   node scripts/bump.js major      // 0.2.0 → 1.0.0
//   node scripts/bump.js 1.4.2      // 直接指定

const fs = require('fs')
const path = require('path')

const file = path.resolve(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
const cur = String(pkg.version || '0.0.0')
const arg = (process.argv[2] || 'patch').toLowerCase()

let next
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg
} else {
  const parts = cur.split('.').map((n) => parseInt(n, 10) || 0)
  const a = parts[0] || 0
  const b = parts[1] || 0
  const c = parts[2] || 0
  if (arg === 'major') next = a + 1 + '.0.0'
  else if (arg === 'minor') next = a + '.' + (b + 1) + '.0'
  else next = a + '.' + b + '.' + (c + 1)
}

if (next === cur) {
  console.log('[bump] 版本没变：' + cur)
  process.exit(0)
}

pkg.version = next
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
console.log('[bump] ' + cur + ' → ' + next)
console.log('[bump] 出包名：' + pkg.appid + '.' + next.replace(/\./g, '_') + '.amr')
