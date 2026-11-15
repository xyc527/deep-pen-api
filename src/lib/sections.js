// 设置分类表（纯数据）
//
// 干嘛用：设置项已经多到一屏放不下了（连接 / 账户 / 5 组参数 / 提示词 / 记忆 /
// 显示 / 备份 / 诊断）。做法是把它们**按类别拆成独立设置页**，外层页只当导航：
// 上面一排「模式 / 人设」切换，下面一堆分类卡片横向排列、放不下自动换行。
//
// 外层的模式切换**不属于任何分类页**（需求明确要求单独放在外层）——
// 它改的是"整套设置+记录用哪一份"，不是某个设置项。

export const SECTIONS_CHAT = [
  { id: 'conn', badge: '连', title: '连接与账户', sub: 'Key · 地址 · 余额峰谷', groups: ['conn', 'acct'] },
  { id: 'model', badge: '模', title: '模型与参数', sub: '模型 · 思考 · 联网 · 采样', groups: ['param'] },
  { id: 'talk', badge: '话', title: '对话与提示词', sub: 'System · 历史轮数 · 记忆', groups: ['prompt', 'memory'] },
  { id: 'view', badge: '显', title: '界面显示', sub: '余额芯片 · 来源展开', groups: ['view'] },
  { id: 'tool', badge: '图', title: '地图与天气', sub: '高德 Key · 地点搜索 · 天气', groups: ['tool'] },
  { id: 'data', badge: '备', title: '数据与备份', sub: '导出 · 导入 · 会话清理', groups: ['data'] },
  { id: 'diag', badge: '诊', title: '诊断', sub: '自检 · 版本 · 日志', groups: ['diag'] }
]

// 扮演模式多一个「人设与角色」页，且第一个就是它 —— 这个模式里最重要的入口
export const SECTIONS_ROLE = [
  { id: 'persona', badge: '设', title: '人设与角色', sub: '角色卡 · 导入 · 切换', groups: ['persona'] },
  { id: 'conn', badge: '连', title: '连接与账户', sub: '本模式独立 Key · 余额', groups: ['conn', 'acct'] },
  { id: 'model', badge: '模', title: '模型与参数', sub: '模型 · 思考 · 采样', groups: ['param'] },
  { id: 'talk', badge: '记', title: '记忆与上下文', sub: '补充要求 · 压缩 · 记忆', groups: ['prompt', 'memory'] },
  { id: 'view', badge: '显', title: '界面显示', sub: '余额芯片 · 来源展开', groups: ['view'] },
  { id: 'data', badge: '备', title: '数据与备份', sub: '导出两个文件 · 导入', groups: ['data'] },
  { id: 'diag', badge: '诊', title: '诊断', sub: '自检 · 版本 · 日志', groups: ['diag'] }
]

export function sectionsFor(mode) {
  return mode === 'role' ? SECTIONS_ROLE : SECTIONS_CHAT
}

export function sectionById(mode, id) {
  const list = sectionsFor(mode)
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
  return list[0]
}

export function hasGroup(section, group) {
  if (!section || !section.groups) return false
  return section.groups.indexOf(group) >= 0
}

// 分类卡片右下角那句状态：让用户不用点进去也知道哪块没配好
export function sectionStatus(secId, ctx) {
  const c = ctx || {}
  if (secId === 'conn') {
    if (!c.hasKey) return '未填 Key'
    // 直接报"还有多少钱 + 距离下次峰谷切换多久"：「有余额」这种说法
    // 什么都看不出来，还得点进去才知道够不够用
    const bits = []
    if (c.balanceText) bits.push(c.balanceText)
    if (c.periodText) bits.push(c.periodText)
    return bits.length ? bits.join(' · ') : '已填 Key · 未查余额'
  }
  if (secId === 'model') {
    const p = c.params || {}
    const bits = []
    bits.push(String(p.model || '未选模型'))
    if (p.thinking !== false) bits.push('思考')
    if (p.searchMode && p.searchMode !== 'off') bits.push('联网')
    return bits.join(' · ')
  }
  if (secId === 'talk') return c.memoryOn ? '记忆已开 · ' + c.memoryCount + ' 条' : '记忆已关'
  if (secId === 'view') return (c.showBalance ? '余额显示' : '余额隐藏') + ' · ' + (c.srcFull ? '来源全称' : '来源单行')
  if (secId === 'tool') {
    if (!c.hasAmapKey) return '未填高德 Key'
    return c.amapKeyMask ? '已配 ' + c.amapKeyMask : '已填 Key'
  }
  if (secId === 'data') return c.convCount ? c.convCount + ' 个对话' : '还没有对话'
  if (secId === 'diag') return 'v' + String(c.version || '')
  if (secId === 'persona') return c.personaName ? '当前：' + c.personaName : '没有人设'
  return ''
}
