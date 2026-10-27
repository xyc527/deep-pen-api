// 写文件的通道选择（纯函数，便于单测）
//
// 为什么要多通道：不同机型 / 固件对 `fs` 的暴露不一样。文档里的 fs 只列了
// readdir / stat / exists / readFile / mkdir / rm，**没有 writeFile**；X7 的固件
// 额外带了一个，换台笔就是 undefined，调用当场 "TypeError: not a function"。
// 于是写操作按「上次成功的 → 其余候选」的顺序试，第一条能用的就是本次会话的通道。

export const WRITE_ORDER = ['fs.writeFile', 'fs.writeFileSync', 'shell']

// available: { 'fs.writeFile': true, 'shell': true, ... }
// first: 上一轮成功的通道（可为空）
// 返回：按优先级排好的、确实存在的通道列表
export function planWrites(available, first) {
  const av = available || {}
  const out = []
  if (first && av[first] && WRITE_ORDER.indexOf(first) >= 0) out.push(first)
  for (let i = 0; i < WRITE_ORDER.length; i++) {
    const b = WRITE_ORDER[i]
    if (av[b] && out.indexOf(b) < 0) out.push(b)
  }
  return out
}

// 把失败信息压成一行，日志里能看：哪个通道、什么原因
export function describeWriteFail(attempts) {
  const list = attempts || []
  if (!list.length) return '没有可用的写文件接口'
  return list.map((a) => a.backend + ' :: ' + (a.error || 'unknown')).join(' | ')
}
