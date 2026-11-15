// 存档的读写（IO 层）
//
// 为什么不像设置那样直接 fs 写：目标在 /userdisk 下，那是**系统目录**，
// 本机 fs 模块只能保证应用自己的 data 目录可写。可靠的做法是「先写进 data 目录
// 的 tmp（这条路打通了），再用 shell 的 cp 搬到目标」—— cp 不受参数长度限制，
// 大一点的记录文件也过得去。
//
// 列目录同理：fs.readdir 分不出"文件还是文件夹"，改用 `ls -1p`（目录名带尾斜杠），
// 输出重定向到 tmp 再读 —— execShell 无回显，这是本机上唯一能拿到命令输出的方式。

import {
  execShell, shq, readText, readTextEx, writeTextEx, removeFile, ensureAppDir,
  joinPath, logLine, waitForFile
} from './platform.js'
import {
  ROOT_DIR, EXPORT_DIR, IMPORT_DIR, PERSONA_DIR, profileFolder, toJson,
  buildSettingsDoc, buildRecordsDoc, parseSettingsArchive, parseRecordsArchive,
  buildPersonaCardDoc, buildPersonaSampleDoc, personaFileName
} from '../lib/archive.js'

function tmpFile(tag) {
  const dir = ensureAppDir('tmp')
  return joinPath(dir, tag + '_' + Date.now().toString(36) + '.json')
}

export function shellMkdir(path) {
  try {
    execShell('mkdir -p ' + shq(path) + ' 2>/dev/null; true')
    return true
  } catch (e) {
    return false
  }
}

// 返回 [{ name, dir }]，目录名不带尾斜杠
export async function listDir(path) {
  const out = joinPath(ensureAppDir('tmp'), 'ls_' + Date.now().toString(36) + '.txt')
  try {
    // 末尾补一个 "."：目录是空的时候不能让输出文件完全为空，
    // 否则 waitForFile 会把"空目录"判成"命令还没跑完"，白等 1.2 秒
    execShell('ls -1p ' + shq(path) + ' 2>/dev/null > ' + shq(out) + '; echo . >> ' + shq(out) + '; true')
    const text = await waitForFile(out, 1500)
    if (text == null) return null
    const lines = String(text).split('\n')
    const items = []
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].replace(/\r/g, '').trim()
      if (!raw || raw === '.' || raw === './' || raw === '../') continue
      const isDir = /\/$/.test(raw)
      const name = raw.replace(/\/$/, '')
      if (!name) continue
      items.push({ name: name, dir: isDir })
    }
    return items
  } finally {
    removeFile(out)
  }
}

// 写一个可能在系统目录里的文件：先落 data/tmp，再 cp 过去，最后回读比对。
export async function writeOutside(path, text) {
  const s = String(text == null ? '' : text)
  const tmp = tmpFile('out')
  const w = writeTextEx(tmp, s)
  if (!w.ok) return { ok: false, error: '暂存失败：' + w.error }
  // 目标目录可能在 /userdisk 下，先建出来（cp 不会自己建目录）
  const dir = path.replace(/\/[^/]+$/, '')
  shellMkdir(dir)
  try {
    execShell('cp -f ' + shq(tmp) + ' ' + shq(path) + ' 2>/dev/null; true')
  } catch (e) {
    return { ok: false, error: '复制失败' }
  }
  // 回读校验：cp 静默失败时（没有权限 / 目录不存在）不能报"导出成功"
  const back = await readTextEx(path, 3)
  if (!back.ok) return { ok: false, error: '写入后读不回来（可能没有权限）' }
  if (String(back.text) !== s) return { ok: false, error: '写入内容与预期不一致' }
  return { ok: true, error: '' }
}

// 导出当前档案：settings.json + records.json 两个文件放同一个文件夹
export async function exportProfile(input) {
  const o = input || {}
  const folder = EXPORT_DIR + '/' + profileFolder(o.profileKey, o.name)
  shellMkdir(folder)
  const at = Date.now()
  const sDoc = buildSettingsDoc({
    at: at, mode: o.mode, personaId: o.personaId, personaName: o.name,
    card: o.card, settings: o.settings
  })
  const rDoc = buildRecordsDoc({
    at: at, mode: o.mode, personaId: o.personaId, personaName: o.name,
    card: o.card, settings: o.settings, personaPrompt: o.personaPrompt,
    convs: o.convs, notes: o.notes
  })
  const sText = toJson(sDoc)
  const rText = toJson(rDoc)
  const a = await writeOutside(folder + '/settings.json', sText)
  const b = await writeOutside(folder + '/records.json', rText)
  const ok = a.ok && b.ok
  logLine(ok ? 'I' : 'E', 'export ' + (ok ? 'ok' : 'fail') + ' ' + folder
    + ' settings=' + sText.length + 'B records=' + rText.length + 'B'
    + (a.ok ? '' : ' S:' + a.error) + (b.ok ? '' : ' R:' + b.error))
  return {
    ok: ok,
    folder: folder,
    error: a.ok ? (b.ok ? '' : 'records.json：' + b.error) : 'settings.json：' + a.error,
    bytes: sText.length + rText.length
  }
}

// 列出可导入的存档目录：export/<档案>/{settings.json?,records.json?}
export async function listExports() {
  const items = await listDir(EXPORT_DIR)
  if (!items) return []
  const out = []
  for (let i = 0; i < items.length; i++) {
    if (!items[i].dir) continue
    const folder = EXPORT_DIR + '/' + items[i].name
    const st = await readText(folder + '/settings.json', 1)
    const rec = await readText(folder + '/records.json', 1)
    const info = { name: items[i].name, folder: folder, hasSettings: !!st, hasRecords: !!rec, at: 0, sessions: 0, messages: 0 }
    if (st) {
      const p = parseSettingsArchive(st)
      if (p.ok) { info.at = p.at || info.at; if (p.name) info.name = p.name }
    }
    if (rec) {
      const p = parseRecordsArchive(rec)
      if (p.ok) {
        info.at = Math.max(info.at, p.at || 0)
        info.sessions = p.convs.length
        for (let k = 0; k < p.convs.length; k++) info.messages += p.convs[k].messages.length
        if (p.name && !info.name) info.name = p.name
      }
    }
    out.push(info)
  }
  // 新的在前
  out.sort((a, b) => (b.at || 0) - (a.at || 0))
  return out
}

export async function readExport(folder) {
  const sText = await readText(folder + '/settings.json', 2)
  const rText = await readText(folder + '/records.json', 2)
  const s = sText ? parseSettingsArchive(sText) : null
  const r = rText ? parseRecordsArchive(rText) : null
  return {
    ok: !!(s && s.ok) || !!(r && r.ok),
    settings: s && s.ok ? s.settings : null,
    name: (s && s.ok && s.name) || (r && r.ok && r.name) || '',
    card: (r && r.ok && r.card) || (s && s.ok && s.card) || null,
    convs: r && r.ok ? r.convs : null,
    notes: r && r.ok ? r.notes : null,
    error: (s && !s.ok ? '设置：' + s.error : '') + (r && !r.ok ? ' 记录：' + r.error : '')
  }
}

// 用户丢进 import/ 的人设文件
export async function listImportFiles() {
  const items = await listDir(IMPORT_DIR)
  if (!items) return []
  const out = []
  for (let i = 0; i < items.length; i++) {
    const n = items[i].name
    if (items[i].dir) continue
    if (!/\.(json|txt|md|markdown)$/i.test(n)) continue
    out.push({ name: n, path: IMPORT_DIR + '/' + n })
  }
  return out
}

export async function readImportFile(path) {
  return await readText(path, 2)
}

// 第一次打开时把目录建出来：用户点「导出」才发现目录不存在就太晚了，
// 这里在进入数据页时顺手建一次（失败也无所谓，导出时会再建）
export function ensureArchiveDirs() {
  shellMkdir(ROOT_DIR)
  shellMkdir(EXPORT_DIR)
  shellMkdir(IMPORT_DIR)
  shellMkdir(PERSONA_DIR)
}

// 把某个人设的角色卡导出成一个 .json（社区通用的 chara_card_v2）
export async function exportPersonaCard(input) {
  const o = input || {}
  const path = PERSONA_DIR + '/' + personaFileName(o.name)
  const text = toJson(buildPersonaCardDoc(o.card, { at: Date.now() }))
  const r = await writeOutside(path, text)
  logLine(r.ok ? 'I' : 'E', 'persona export ' + (r.ok ? 'ok' : 'fail') + ' ' + path
    + ' ' + text.length + 'B' + (r.ok ? '' : ' :: ' + r.error))
  return { ok: r.ok, path: path, bytes: text.length, error: r.error }
}

// 写一份示例角色卡（字段里带"该写什么"的说明），用户照着改就能用
export async function exportPersonaSample() {
  const path = PERSONA_DIR + '/sample_card.json'
  const text = toJson(buildPersonaSampleDoc(Date.now()))
  const r = await writeOutside(path, text)
  logLine(r.ok ? 'I' : 'E', 'persona sample ' + (r.ok ? 'ok' : 'fail') + ' ' + path
    + ' ' + text.length + 'B' + (r.ok ? '' : ' :: ' + r.error))
  return { ok: r.ok, path: path, bytes: text.length, error: r.error }
}
