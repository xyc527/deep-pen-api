// 设置模型（纯函数）：默认值、归一化、迁移

import { defaultParams, PARAM_MAP, clampNumber } from './params.js'

export const SETTINGS_VERSION = 1

export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  apiKey: '',
  baseUrl: DEFAULT_BASE_URL,
  systemPrompt: '',
  // /models 扫到的可用模型（[{id,label}]）。空数组 = 还没扫过，界面用内置清单兜底
  models: [],
  maxHistory: 12, // 最多带多少轮历史（6 轮问答）
  // 主页顶栏是否显示「余额 + 峰谷」芯片。关掉只是不显示、也不再定时查余额，
  // 设置页「账户」里的余额/时段照常可查
  showBalance: true,
  // 保存方式：'auto' 改一项存一项；'manual' 只在点顶部「保存」时落盘。
  // 两者互斥 —— manual 下所有改动只留在内存，顶部才会出现保存按钮
  saveMode: 'auto',
  params: defaultParams(),
  updatedAt: 0
}

export function maskKey(key) {
  const s = String(key || '')
  if (!s) return ''
  if (s.length <= 12) return s.slice(0, 4) + '****'
  return s.slice(0, 7) + '****' + s.slice(-4)
}

export function normalizeBaseUrl(url) {
  let s = String(url || '').trim()
  if (!s) return DEFAULT_BASE_URL
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  s = s.replace(/\/+$/, '')
  // 用户可能填到 /chat/completions，统一去掉后缀，保留 base
  s = s.replace(/\/chat\/completions$/i, '')
  if (/^https:\/\/api\.deepseek\.com$/i.test(s)) s += '/v1'
  return s
}

export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {
    version: SETTINGS_VERSION,
    apiKey: typeof src.apiKey === 'string' ? src.apiKey.trim() : '',
    baseUrl: normalizeBaseUrl(src.baseUrl),
    systemPrompt: typeof src.systemPrompt === 'string' ? src.systemPrompt : '',
    models: normalizeModels(src.models),
    maxHistory: clampInt(src.maxHistory, 0, 40, DEFAULT_SETTINGS.maxHistory),
    // 只有显式写 false 才关（老配置文件里没这个字段 → 视为开）
    showBalance: src.showBalance === false ? false : true,
    // 只认 'manual'，其它一律按自动保存（老配置没有这个字段 → 自动保存）
    saveMode: src.saveMode === 'manual' ? 'manual' : 'auto',
    params: Object.assign({}, defaultParams(), src.params && typeof src.params === 'object' ? src.params : {}),
    updatedAt: Number(src.updatedAt) || 0
  }

  // 逐项类型校正，避免手改文件后崩在运行期
  const keys = Object.keys(PARAM_MAP)
  for (let i = 0; i < keys.length; i++) {
    const def = PARAM_MAP[keys[i]]
    const v = out.params[keys[i]]
    if (def.kind === 'number') out.params[keys[i]] = clampNumber(def, v)
    else if (def.kind === 'bool') out.params[keys[i]] = v === true || v === 'true'
    else if (def.kind === 'enum') {
      const ok = def.options.some((o) => o.value === v)
      out.params[keys[i]] = ok ? v : def.default
    } else out.params[keys[i]] = String(v == null ? def.default : v)
  }
  return out
}

function normalizeModels(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (let i = 0; i < raw.length && out.length < 64; i++) {
    const m = raw[i]
    if (!m) continue
    const id = typeof m === 'string' ? m : String(m.id || '')
    if (!id) continue
    out.push({ id: id, label: String((m && m.label) || id) })
  }
  return out
}

function clampInt(v, min, max, dft) {
  let n = parseInt(v, 10)
  if (!isFinite(n)) n = dft
  if (n < min) n = min
  if (n > max) n = max
  return n
}

export function isReady(settings) {
  return !!(settings && settings.apiKey && settings.apiKey.length > 8)
}

// 「是否改过」用的指纹：归一化后去掉 updatedAt 再序列化。
// 归一化是必须的 —— 界面上的对象可能带着未裁剪的空格、未规范化的 baseUrl，
// 直接 JSON.stringify 会一直报「有未保存改动」。
export function settingsSignature(s) {
  if (!s) return ''
  const o = normalizeSettings(s)
  o.updatedAt = 0
  return JSON.stringify(o)
}

// 手动保存模式下顶栏保存按钮的文案/是否可点，抽成纯函数好测
export function saveButtonState(dirty) {
  return dirty ? { label: '保存', enabled: true } : { label: '已保存', enabled: false }
}
