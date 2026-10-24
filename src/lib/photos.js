// 图片列表的纯逻辑：排序、去重、增量对比（拍照返回后要"只把新照片加进来"）

export const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.bmp']

export function isImageName(name) {
  const s = String(name || '').toLowerCase()
  for (let i = 0; i < IMAGE_EXT.length; i++) {
    if (s.slice(-IMAGE_EXT[i].length) === IMAGE_EXT[i]) return true
  }
  return false
}

export function sortByMtimeDesc(list) {
  const arr = (list || []).slice()
  arr.sort((a, b) => {
    const d = (b.mtime || 0) - (a.mtime || 0)
    if (d !== 0) return d
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
  return arr
}

export function normalizePhoto(raw) {
  const name = String(raw.name || '')
  const path = String(raw.path || '')
  return {
    path: path,
    name: name,
    size: Number(raw.size) || 0,
    mtime: Number(raw.mtime) || 0,
    key: path || name
  }
}

// 已选列表里加一张（按 key 去重，最多 max 张）
export function addPhoto(list, photo, max) {
  const cap = max || 4
  const cur = (list || []).slice()
  if (cur.some((p) => p.key === photo.key)) return cur
  if (cur.length >= cap) return cur
  cur.push(photo)
  return cur
}

export function removePhoto(list, key) {
  return (list || []).filter((p) => p.key !== key)
}

// 拍照前后对比：返回"新增的照片"（路径不在 before 里）
export function diffNewPhotos(before, after) {
  const seen = {}
  for (let i = 0; i < (before || []).length; i++) seen[before[i].key] = 1
  const out = []
  for (let i = 0; i < (after || []).length; i++) {
    if (!seen[after[i].key]) out.push(after[i])
  }
  // 新增的按时间正序（最早拍的排前面，符合直觉）
  out.sort((a, b) => (a.mtime || 0) - (b.mtime || 0))
  return out
}

export function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'M'
  if (n >= 1024) return Math.round(n / 1024) + 'K'
  return n + 'B'
}
