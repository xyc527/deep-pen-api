// 系统输入法（有道输入法）接入
//
// 结论（真机验证 + 参考 haasui-falcon-app 的输入法章节，仅参考调用约定、未复用代码，两条路径一致）：
//   - 词典笔的输入法是**独立的系统 mini-app**，不是页面内的输入框控件。
//   - 拉起方式：`global.startTextEdit(JSON.stringify(config))`；结果通过
//     `textEditFinished` 回传（Global 信号 + $falcon 事件双通道，哪个来都能收到）。
//   - 预填充字段只有 `text` 真正生效（实测 contents/defaultText/inputText/value 都被忽略），
//     所以 config 里同时给 text 和 contents（后者用于兼容按该名字实现的固件）。
//   - 必须 on/off 成对管理，且同一时刻只允许一个编辑会话：旧会话先按取消结算。
//
// 这条路不需要 native C++ 扩展 —— 参考仓库里 templates/jsapi 的 KeyInput/KeyCodes
// 是"往应用内注入按键事件"的 native 能力，跟"拉起系统输入法"是两件事，这里用不上。

import { getGlobal, log } from './platform.js'

// IME 回传结果里的文本字段名（不同固件/语音形态不同，逐个兜底）
const TEXT_KEYS = ['contents', 'jsonData', 'text', 'inputText', 'currentText', 'content', 'data', 'result', 'value', 'textContent', 'editContent']

let _cleanup = null
let _settle = null

export function imeAvailable() {
  const g = getGlobal()
  return !!(g && typeof g.startTextEdit === 'function')
}

function findText(j, depth) {
  if (depth > 3 || !j || typeof j !== 'object') return ''
  for (let i = 0; i < TEXT_KEYS.length; i++) {
    const k = TEXT_KEYS[i]
    const v = j[k]
    if (v === undefined || v === null) continue
    if (typeof v === 'string') return v
    if (typeof v === 'object') {
      const nested = findText(v, depth + 1)
      if (nested) return nested
    }
  }
  return ''
}

function extract(args) {
  for (let i = 0; i < args.length; i++) {
    let v = args[i]
    if (v && typeof v === 'object' && 'data' in v) v = v.data
    if (v === null || v === undefined) continue
    if (typeof v === 'string') {
      if (/^[0-9a-fA-F]{32}$/.test(v)) continue // 纯 uuid
      try {
        const j = JSON.parse(v)
        if (j && typeof j === 'object') {
          const has = TEXT_KEYS.some((k) => j[k] !== undefined && j[k] !== null)
          if (has) return { text: findText(j, 0), canceled: !!(j.editCanceled || j.canceled || j.cancel), found: true }
          continue
        }
      } catch (e) { /* 纯文本 */ }
      return { text: v, canceled: false, found: true }
    }
    if (typeof v === 'object') {
      const has = TEXT_KEYS.some((k) => v[k] !== undefined && v[k] !== null)
      if (has) return { text: findText(v, 0), canceled: !!(v.editCanceled || v.canceled || v.cancel), found: true }
    }
  }
  return { text: '', canceled: false, found: false }
}

export function closeTextEditor() {
  const g = getGlobal()
  try { if (g && typeof g.closeTextEdit === 'function') g.closeTextEdit() } catch (e) { /* 忽略 */ }
  if (_cleanup) {
    try { _cleanup() } catch (e) { /* 忽略 */ }
    const s = _settle
    _cleanup = null
    _settle = null
    if (s) s(null)
  }
}

// 打开输入法。返回 Promise<string|null>：确认返回文本（可能为 ''），取消返回 null
export function openTextEditor(initialText, options) {
  const opts = options || {}
  return new Promise((resolve) => {
    const g = getGlobal()
    if (!g || typeof g.startTextEdit !== 'function') {
      log('IME 不可用：global.startTextEdit 缺失')
      resolve(null)
      return
    }

    closeTextEditor() // 上一会话残留先按取消结算

    let settled = false
    const cleanup = () => {
      try { g.textEditFinished.off(handler) } catch (e) { /* 忽略 */ }
      try { $falcon.off('textEditFinished', falconHandler) } catch (e) { /* 忽略 */ }
    }
    const settle = (args) => {
      if (settled) return
      settled = true
      cleanup()
      if (_cleanup === cleanup) { _cleanup = null; _settle = null }
      const r = extract(args || [])
      // found=false（诊断钩子等无载荷）按取消处理，不覆盖调用方原值
      resolve(!r.found ? null : (r.canceled ? null : r.text))
    }
    const handler = function () { settle(Array.prototype.slice.call(arguments)) }
    const falconHandler = function (e) { settle([e]) }

    g.textEditFinished.on(handler)
    try { $falcon.on('textEditFinished', falconHandler) } catch (e) { /* 忽略 */ }
    _cleanup = cleanup
    _settle = settle

    try {
      const text = String(initialText === undefined || initialText === null ? '' : initialText)
      const config = {
        placeholder: opts.placeholder || '',
        autofocus: true,
        maxlength: opts.maxlength || 4000,
        showCursor: true,
        confirmButtonDisabledOnTextEmpty: false,
        multiLinesEditVisible: opts.multiLine !== false,
        enterButtonText: opts.confirmText || '完成',
        text: text,
        contents: text
      }
      // inputType 是 SDK 里的枚举，本工程不依赖 SDK；留空则不传，由输入法取默认。
      if (opts.inputType !== undefined && opts.inputType !== null && opts.inputType !== '') {
        config.inputType = opts.inputType
      }
      g.startTextEdit(JSON.stringify(config))
    } catch (e) {
      log('startTextEdit 失败 ' + e)
      settle([])
    }
  })
}
