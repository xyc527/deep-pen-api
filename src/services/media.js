// 相册 / 拍照（纯 API 端点版本，不需要自己驱动摄像头）
//
// 设计取舍：
//   参考实现（Deepseek-Pen/camera.js，该仓库为 GPL-3.0，此处仅作方案对比、未复用其代码）
//   是直接用 v4l2 + gstreamer + kmssink 驱动
//   /dev/video29、再用 modetest 改 plane zpos 做取景 —— 那套东西依赖
//   "开机后必须先启动过一次系统 AI拍照 应用" 才有 3A，且 plane/裁剪参数与具体
//   面板强耦合。本工程改为：**直接拉起系统官方拍照应用**，用户拍完返回，
//   我们在页面 onShow 里重扫相册，把新文件并进图片列表。
//   这样既不碰硬件，也天然拿到系统相机的对焦/曝光/闪光灯能力。

import { readText, readdir, stat, exists, execShell, shq, ensureAppDir, joinPath, navTo, log } from './platform.js'
import { isImageName, normalizePhoto, sortByMtimeDesc } from '../lib/photos.js'

// 相册目录：优先 /userdisk/Pictures（系统相册与 AI拍照 的落盘位置）
export const PHOTO_DIRS = ['/userdisk/Pictures', '/userdisk/DCIM', '/userdisk/Camera']

// 系统相机类应用候选。厂商随机型/固件不同，逐个试。
export const CAMERA_APPS = [
  { appid: '8001699004677776', name: 'AI拍照' },
  { appid: '8001735023580768', name: '拍照朗读' },
  { appid: '8001718963156066', name: '相册' }
]

export async function listPhotos(limit) {
  const cap = limit || 60
  const out = []
  for (let d = 0; d < PHOTO_DIRS.length; d++) {
    const dir = PHOTO_DIRS[d]
    const names = await readdir(dir)
    if (!names || !names.length) continue
    for (let i = 0; i < names.length; i++) {
      const name = String(names[i])
      if (!isImageName(name)) continue
      const path = dir.replace(/\/+$/, '') + '/' + name
      const st = await stat(path)
      out.push(normalizePhoto({
        name: name,
        path: path,
        size: st && st.size ? st.size : 0,
        mtime: st && st.mtime ? st.mtime : 0
      }))
      if (out.length >= cap * 2) break
    }
  }
  return sortByMtimeDesc(out).slice(0, cap)
}

// 相册目录的时间戳指纹：新增/删除文件都会改变目录 mtime。
// 轮询它比每次 readdir+stat 几十个文件便宜得多，用来发现"相机刚写进来的新照片"。
export async function photoDirStamp() {
  const parts = []
  for (let d = 0; d < PHOTO_DIRS.length; d++) {
    const st = await stat(PHOTO_DIRS[d])
    parts.push(st ? String(st.mtime || 0) + ':' + String(st.size || 0) : '-')
  }
  return parts.join('|')
}

// 图片 → data URL（OpenAI 兼容的 image_url 需要的形态）
// 走 shell base64：fs 没有可靠的二进制读接口，base64 一次落盘再读回最稳。
const MAX_INLINE = 4 * 1024 * 1024

export async function toDataUrl(path, mime) {
  const st = await stat(path)
  const size = st && st.size ? st.size : 0
  if (size > MAX_INLINE) {
    return { ok: false, error: '图片过大（' + Math.round(size / 1048576) + 'MB），请选小于 4MB 的图片' }
  }
  const dir = ensureAppDir('tmp')
  const b64File = joinPath(dir, 'b64_' + Date.now().toString(36) + '.txt')
  execShell('base64 < ' + shq(path) + ' 2>/dev/null | tr -d "\\n" > ' + shq(b64File) + '; printf 1 >> /dev/null')
  const b64 = await waitB64(b64File, 6000)
  execShell('rm -f ' + shq(b64File) + ' 2>/dev/null; true')
  if (!b64) return { ok: false, error: '读取图片失败' }
  const m = mime || guessMime(path)
  return { ok: true, url: 'data:' + m + ';base64,' + b64, size: size }
}

async function waitB64(path, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const raw = await readText(path, 1)
    if (raw && raw.length > 16) return String(raw).replace(/\s+/g, '')
    await new Promise((r) => setTimeout(r, 120))
  }
  return null
}

export function guessMime(path) {
  const s = String(path || '').toLowerCase()
  if (s.slice(-4) === '.png') return 'image/png'
  if (s.slice(-5) === '.webp') return 'image/webp'
  if (s.slice(-4) === '.bmp') return 'image/bmp'
  return 'image/jpeg'
}

// 拉起系统相机。返回 { ok, appid, name }
export function launchCamera(preferredAppid) {
  const list = CAMERA_APPS.slice()
  if (preferredAppid) {
    const idx = list.findIndex((a) => a.appid === preferredAppid)
    if (idx > 0) {
      const pick = list.splice(idx, 1)[0]
      list.unshift(pick)
    }
  }
  for (let i = 0; i < list.length; i++) {
    const app = list[i]
    const uri = 'falcon://' + app.appid + '/index'
    const ok = navTo(uri)
    log('launchCamera ' + uri + ' -> ' + ok)
    if (ok) return { ok: true, appid: app.appid, name: app.name }
  }
  return { ok: false, appid: '', name: '' }
}

export function pictureExists(path) {
  return exists(path)
}
