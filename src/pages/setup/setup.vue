<template>
    <div class="su-page">
        <div class="su-head">
            <text class="su-logo">DeepSeek</text>
            <text class="su-sub">首次使用需要填入 API Key（仅保存在本机）</text>
        </div>

        <div class="su-body">
            <div class="su-row" @click="editKey">
                <text class="su-label">API Key</text>
                <text :class="keyClass">{{ keyText }}</text>
                <text class="su-hint">点击编辑</text>
            </div>
            <div class="su-row" @click="editBase">
                <text class="su-label">服务地址</text>
                <text class="su-value">{{ baseUrl }}</text>
                <text class="su-hint">点击编辑</text>
            </div>
            <div class="su-row2">
                <text class="su-note">在 platform.deepseek.com 创建 Key，格式 sk-…；可用模型：deepseek-flash / deepseek-v4-pro</text>
            </div>
        </div>

        <div class="su-foot">
            <text class="su-status">{{ status }}</text>
            <div class="su-btn" @click="test"><text class="su-btntxt">测试连接</text></div>
            <div :class="enterClass" @click="enter"><text :class="enterTxtClass">保存并进入</text></div>
        </div>
    </div>
</template>

<script>
import { loadSettings, saveSettings, getLastSaveInfo } from '../../services/store.js'
import { openTextEditor } from '../../services/ime.js'
import { testConnection } from '../../services/api.js'
import { navTo, log } from '../../services/platform.js'
import { maskKey, normalizeBaseUrl, isReady, settingsSignature } from '../../lib/settings.js'
import { publishSettings } from '../../lib/uistate.js'

export default {
    name: 'setup',
    data() {
        return {
            settings: null,
            status: '',
            testing: false
        }
    },
    computed: {
        keyText() {
            const k = this.settings ? this.settings.apiKey : ''
            return k ? maskKey(k) : '（未填写）'
        },
        keyClass() {
            const k = this.settings ? this.settings.apiKey : ''
            return k ? 'su-value' : 'su-value-empty'
        },
        baseUrl() {
            return this.settings ? this.settings.baseUrl : ''
        },
        enterClass() {
            return isReady(this.settings) ? 'su-btn-main' : 'su-btn-main-off'
        },
        enterTxtClass() {
            return isReady(this.settings) ? 'su-btntxt-main' : 'su-btntxt-main-off'
        }
    },
    mounted() {
        this.load()
    },
    methods: {
        async load() {
            // normalizeSettings 已经保证 baseUrl 有默认值，这里不需要再补
            this.settings = await loadSettings()
        },
        // 首次配置也要"改完就落盘"：以前只在点「测试连接 / 保存并进入」时才写，
        // 中途返回（或应用被系统回收）这次输入就没了 —— 用户看到的就是
        // "第一次填的 Key 填完就消失"。现在每次编辑立刻保存并回读确认。
        applyAndSave(patch) {
            this.settings = Object.assign({}, this.settings, patch || {})
            const saved = saveSettings(this.settings)
            if (!saved) {
                // 把真实原因带出来（以前只说"写入配置失败"，用户报给我们时无从查起）
                const info = getLastSaveInfo()
                this.status = '保存失败：写入配置被拒绝' +
                    (info.reason && info.reason !== 'unknown' ? '（' + info.reason + '）' : '') +
                    '，已记入日志'
                log('setup 保存失败 reason=' + info.reason + ' path=' + info.path)
                return false
            }
            this.settings = saved
            publishSettings(saved)
            this.verifySoon(saved)
            return true
        },
        // 本机 writeFile 会"不报错也不落盘"，所以写成功之后还要读回来对一遍
        verifySoon(expected) {
            const sig = settingsSignature(expected)
            setTimeout(async () => {
                const disk = await loadSettings()
                if (!disk) return
                if (settingsSignature(disk) === sig) return
                this.status = '保存失败：写后读回不一致，已记入日志'
                log('setup 写后读回不一致')
            }, 300)
        },
        async editKey() {
            if (!this.settings) { this.status = '配置还在读取，请稍候再点'; return }
            const text = await openTextEditor(this.settings.apiKey || '', { multiLine: false, confirmText: '确定', maxlength: 200 })
            if (text === null || text === undefined) return
            const key = String(text).trim()
            if (!this.applyAndSave({ apiKey: key })) return
            const disk = await loadSettings()
            if (!disk || disk.apiKey !== key) {
                this.status = '保存失败：读回的值与输入不一致，已记入日志'
                log('setup verify 不一致 disk=' + (disk ? disk.apiKey.length : -1) + ' want=' + key.length)
                return
            }
            this.status = isReady(this.settings) ? '已保存到本机' : 'Key 太短，请检查是否复制完整'
            log('setup key saved len=' + key.length)
        },
        async editBase() {
            if (!this.settings) { this.status = '配置还在读取，请稍候再点'; return }
            const text = await openTextEditor(this.settings.baseUrl || '', { multiLine: false, confirmText: '确定', maxlength: 200 })
            if (text === null || text === undefined) return
            if (this.applyAndSave({ baseUrl: normalizeBaseUrl(text) })) this.status = '服务地址已保存'
        },
        async test() {
            if (this.testing) return
            if (!isReady(this.settings)) { this.status = '请先填入 API Key'; return }
            this.testing = true
            this.status = '正在连接…'
            // 测试成功就把模型清单存下来：设置页的「模型」可选值、首页顶栏的短名
            // 都靠它，不用再扫一次
            const r = await testConnection({ baseUrl: this.settings.baseUrl, apiKey: this.settings.apiKey })
            this.testing = false
            if (!r.ok) { this.status = r.error || '连接失败'; return }
            const ids = r.models.map((m) => m.id)
            const p = Object.assign({}, this.settings.params)
            if (ids.length && ids.indexOf(p.model) < 0) p.model = ids[0]
            if (!this.applyAndSave({ models: r.models.map((m) => ({ id: m.id, label: m.id })), params: p })) return
            this.status = '连接成功，可用模型：' + ids.join(' / ')
            log('models ' + ids.join(','))
        },
        enter() {
            if (!isReady(this.settings)) {
                this.status = '请先填入有效的 API Key'
                return
            }
            if (!this.applyAndSave({})) return
            navTo('index', {})
        }
    }
}
</script>

<style>
.su-page {
    width: 936px;
    height: 280px;
    flex-direction: column;
    background-color: #16161a;
}

.su-head {
    height: 64px;
    flex-direction: row;
    align-items: center;
    padding-left: 24px;
    background-color: #1e1e24;
}

.su-logo {
    font-size: 24px;
    color: #4ade80;
    margin-right: 16px;
}

.su-sub {
    font-size: 13px;
    color: #8b8b9a;
}

.su-body {
    flex: 1;
    flex-direction: column;
    padding-left: 24px;
    padding-right: 24px;
    padding-top: 12px;
}

.su-row {
    height: 46px;
    flex-direction: row;
    align-items: center;
    background-color: #202028;
    border-radius: 8px;
    padding-left: 14px;
    padding-right: 14px;
    margin-bottom: 10px;
}

.su-label {
    font-size: 14px;
    color: #9a9aa8;
    width: 96px;
}

.su-value {
    font-size: 15px;
    color: #e4e4ec;
    flex: 1;
}

.su-value-empty {
    font-size: 15px;
    color: #7a7a88;
    flex: 1;
}

.su-hint {
    font-size: 12px;
    color: #5f5f70;
}

.su-row2 {
    flex-direction: row;
    padding-left: 4px;
}

.su-note {
    font-size: 12px;
    color: #6d6d7c;
}

.su-foot {
    height: 52px;
    flex-direction: row;
    align-items: center;
    padding-left: 24px;
    padding-right: 24px;
    background-color: #1e1e24;
}

.su-status {
    font-size: 12px;
    color: #8b8b9a;
    flex: 1;
}

/* 可点击元素用 div 承载 padding（<text> 的 padding 不进命中测试，见 index.vue 注释） */
.su-btn {
    flex-direction: row;
    align-items: center;
    height: 36px;
    background-color: #2a2a33;
    padding-left: 16px;
    padding-right: 16px;
    border-radius: 8px;
    margin-right: 12px;
}

.su-btntxt {
    font-size: 14px;
    color: #b8b8c6;
}

.su-btn-main {
    flex-direction: row;
    align-items: center;
    height: 38px;
    background-color: #4ade80;
    padding-left: 20px;
    padding-right: 20px;
    border-radius: 8px;
}

.su-btntxt-main {
    font-size: 15px;
    color: #0d1a12;
}

.su-btn-main-off {
    flex-direction: row;
    align-items: center;
    height: 38px;
    background-color: #24242c;
    padding-left: 20px;
    padding-right: 20px;
    border-radius: 8px;
}

.su-btntxt-main-off {
    font-size: 15px;
    color: #4a4a58;
}
</style>
