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
import { loadSettings, saveSettings } from '../../services/store.js'
import { openTextEditor } from '../../services/ime.js'
import { testConnection } from '../../services/api.js'
import { navTo, log } from '../../services/platform.js'
import { maskKey, normalizeBaseUrl, isReady } from '../../lib/settings.js'

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
            this.settings = await loadSettings()
            if (!this.settings.baseUrl) this.settings.baseUrl = 'https://api.deepseek.com/v1'
        },
        async editKey() {
            const text = await openTextEditor(this.settings.apiKey || '', { multiLine: false, confirmText: '确定', maxlength: 200 })
            if (text === null || text === undefined) return
            this.settings.apiKey = String(text).trim()
            this.status = ''
        },
        async editBase() {
            const text = await openTextEditor(this.settings.baseUrl || '', { multiLine: false, confirmText: '确定', maxlength: 200 })
            if (text === null || text === undefined) return
            this.settings.baseUrl = normalizeBaseUrl(text)
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
            this.settings.models = r.models.map((m) => ({ id: m.id, label: m.id }))
            if (ids.length && ids.indexOf(this.settings.params.model) < 0) {
                const p = Object.assign({}, this.settings.params)
                p.model = ids[0]
                this.settings.params = p
            }
            saveSettings(this.settings)
            this.status = '连接成功，可用模型：' + ids.join(' / ')
            log('models ' + ids.join(','))
        },
        enter() {
            if (!isReady(this.settings)) {
                this.status = '请先填入有效的 API Key'
                return
            }
            saveSettings(this.settings)
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
