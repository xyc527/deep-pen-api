<template>
    <div class="st-page">
        <div class="st-top">
            <text class="st-title">设置</text>
            <text :class="topHintClass">{{ topHint }}</text>
            <!-- 保存方式：自动=改一项存一项；手动=只在点「保存」时落盘。
                 两者互斥 —— 自动模式下这一区域不会出现保存按钮。 -->
            <div class="st-mode" @click="toggleSaveMode">
                <text class="st-modetxt">保存：{{ isAutoSave ? '自动' : '手动' }}</text>
            </div>
            <div v-if="!isAutoSave" :class="saveBtnClass" @click="saveNow">
                <text :class="saveBtnTxtClass">{{ saveBtnLabel }}</text>
            </div>
            <div class="st-btn" @click="back"><text class="st-btntxt">返回</text></div>
        </div>

        <!-- 模式切换：**不属于任何分类页**，单独放外层。
             它换的是"整套设置+记录用哪一份"，不是一个设置项。 -->
        <div class="st-switch">
            <text class="st-swlabel">模式</text>
            <div :class="modeChipClass('chat')" @click="pickMode('chat')">
                <text :class="modeTxtClass('chat')">聊天</text>
            </div>
            <div :class="modeChipClass('role')" @click="pickMode('role')">
                <text :class="modeTxtClass('role')">扮演</text>
            </div>
            <text class="st-swhint">{{ modeHint }}</text>
        </div>

        <!-- 人设：只有扮演模式才有。切人设 = 连设置带记录一起换。
             这里只放"切换"；新建 / 改名 / 导入导出都在「人设与角色」那张卡里
             —— 同一屏给两个入口进同一页，用户会以为是两个不同的地方。 -->
        <div v-if="isRole" class="st-switch">
            <text class="st-swlabel">人设</text>
            <div v-for="(p, pi) in personaChips" :key="p.id" :class="personaChipClass(p.id)" @click="pickPersona(p.id)">
                <text :class="personaTxtClass(p.id)">{{ p.name }}</text>
            </div>
            <text class="st-swhint">{{ personaHint }}</text>
        </div>

        <!-- 模型：常用项，放在外层直接换，不用进分类页 -->
        <div class="st-switch">
            <text class="st-swlabel">模型</text>
            <div v-for="(m, mi) in modelChips" :key="m.value" :class="modelChipClass(m.value)" @click="pickModel(m.value)">
                <text :class="modelTxtClass(m.value)">{{ m.label }}</text>
            </div>
            <text class="st-swhint">{{ modelHint }}</text>
        </div>

        <!-- 分类卡片：横向排列，放不下自动换行；两侧留边距，不顶满整行 -->
        <div class="st-cards">
            <div v-for="(s, si) in sections" :key="s.id" class="st-card" @click="openSection(s.id)">
                <div class="st-cardhead">
                    <div class="st-cardbadge"><text class="st-cardbadgetxt">{{ s.badge }}</text></div>
                    <text class="st-cardtitle">{{ s.title }}</text>
                </div>
                <text class="st-cardsub">{{ s.sub }}</text>
                <text class="st-cardstat">{{ statusOf(s.id) }}</text>
            </div>
        </div>
    </div>
</template>

<script>
import { loadChats, loadBalance, saveBalance, loadMemory, switchMode, switchPersona, getProfileKey, loadAmapKey } from '../../services/store.js'
import { sectionsFor, sectionStatus } from '../../lib/sections.js'
import { navTo, log } from '../../services/platform.js'
import { APP_VERSION } from '../../lib/appversion.js'
import { isReady, settingsSignature } from '../../lib/settings.js'
import { setSection, publishSettings, subscribeUiState } from '../../lib/uistate.js'
import { fetchBalance } from '../../services/api.js'
import { describePeriod, setTimeSkew, nowMs, formatRemain } from '../../lib/peak.js'
import { moneyText } from '../../lib/balance.js'
import { modelOptions, findModel } from '../../lib/params.js'
import { baseData, baseComputed, baseMethods } from './core.js'

// 外层芯片上放短名：「DeepSeek V4.1 Flash」这种全称会把整行挤爆。
// 内置模型有 short，扫描出来的 id 去掉 deepseek- 前缀。
function modelChipLabel(id, fallback) {
    const known = findModel(id)
    if (known) return known.short || known.label
    const t = String(id || '').replace(/^deepseek-/, '')
    return t || String(fallback || '模型')
}

export default {
    name: 'settings',
    data() {
        return         Object.assign(baseData(), {
            convCount: 0,
            // 地图 Key 存在设备级文件里（不跟人设走），卡片上要显示"配没配"
            amapKey: '',
            hasBalance: false,
            memoryCount: 0,
            // 切档案后要重新统计状态（对话数 / 余额 / 记忆都是分档案的）
            statKey: '',
            // 分类页里清空记忆 / 导入存档后，卡片状态要跟着变（返回时不触发 onShow）
            memRev: 0,
            chatsRev: 0,
            statUnsub: null,
            // 余额 + 峰谷：进这一页就查一次，卡片上直接报数字
            bal: null,
            balBusy: false,
            balMsg: '',
            period: null,
            tickTimer: null
        })
    },
    computed: Object.assign({}, baseComputed, {
        isRole() {
            return !!(this.settings && this.settings.mode === 'role')
        },
        sections() {
            return sectionsFor(this.isRole ? 'role' : 'chat')
        },
        // 顶栏那行字：优先报保存状态，其次提示有未保存改动，最后才是常规说明
        topHint() {
            if (this.saveMsg) return this.saveMsg
            if (!this.isAutoSave && this.dirty) return '有改动未保存'
            if (!this.settings) return '读取中…'
            return this.isRole ? '扮演模式 · 独立设置与记录' : '聊天模式 · 设置按类别分开'
        },
        topHintClass() {
            if (this.saveMsg && this.saveMsg.indexOf('失败') >= 0) return 'st-sub-bad'
            if (this.leaveWarn || (!this.isAutoSave && this.dirty)) return 'st-sub-warn'
            return 'st-sub'
        },
        modeHint() {
            return this.isRole ? '人设之间完全隔离' : '独立的设置与记录'
        },
        personaChips() {
            const list = (this.settings && this.settings.personas) || []
            return list.slice(0, 4)
        },
        personaHint() {
            const n = ((this.settings && this.settings.personas) || []).length
            if (!n) return '还没有人设，去「人设与角色」新建'
            return n > 4 ? ('共 ' + n + ' 个 · 更多在「人设与角色」') : '切换即换设置与记录'
        },
        // 模型：外层直接换。最多摆 3 个，再多去「模型与参数」页
        modelChips() {
            const list = modelOptions(this.settings ? this.settings.models : null)
            const out = []
            for (let i = 0; i < list.length && out.length < 3; i++) {
                out.push({ value: list[i].value, label: modelChipLabel(list[i].value, list[i].label) })
            }
            return out
        },
        modelHint() {
            const all = modelOptions(this.settings ? this.settings.models : null)
            if (all.length > 3) return '共 ' + all.length + ' 个 · 更多在「模型与参数」'
            const p = (this.settings && this.settings.params) || {}
            const bits = []
            bits.push(p.thinking !== false ? '思考开' : '思考关')
            if (p.searchMode && p.searchMode !== 'off') bits.push('联网开')
            return bits.join(' · ')
        },
        // 卡片上直接报余额数字
        balanceText() {
            if (!this.bal || !this.bal.at) return ''
            if (this.bal.available === false) return '余额不足'
            return moneyText(this.bal.total, this.bal.currency)
        },
        // 地图 Key 的掩码：卡片上不该把整串 Key 摆出来
        amapMask() {
            const s = this.amapKey || ''
            if (!s) return ''
            return s.length <= 8 ? s.slice(0, 2) + '****' : s.slice(0, 4) + '****' + s.slice(-4)
        },
        // 「距转谷 1 小时 20 分」：剩余时间每 5 秒重算，不会站着不动
        periodText() {
            const p = this.period
            if (!p || !p.remainMs) return ''
            return '距转' + (p.peak ? '谷' : '峰') + ' ' + formatRemain(p.remainMs)
        }
    }),
    mounted() {
        this.load()
    },
    unmounted() {
        this.coreUnsubscribe()
        this.stopTick()
        if (this.statUnsub) { this.statUnsub(); this.statUnsub = null }
    },
    methods: Object.assign({}, baseMethods, {
        async load() {
            this.exitTarget = 'index'
            await this.coreLoad()
            this.coreSubscribe()
            await this.refreshStats()
            this.amapKey = await loadAmapKey()
            this.watchStats()
            // 进设置页就查一次余额、把峰谷剩余时间跑起来：卡片上要显示真实数字，
            // 不能等用户点进去才查
            this.tickPeriod()
            this.startTick()
            this.refreshBalanceNow()
            log('settings page mode=' + (this.settings ? this.settings.mode : '?'))
        },

        // ---------- 余额 / 峰谷 ----------
        async refreshBalanceNow() {
            if (this.balBusy) return
            const s = this.settings
            if (!isReady(s)) { this.balMsg = '未填 Key'; return }
            this.balBusy = true
            this.balMsg = ''
            try {
                const r = await fetchBalance({ baseUrl: s.baseUrl, apiKey: s.apiKey, timeoutMs: 8000 })
                const skew = r.serverTime ? (r.serverTime - Date.now()) : (this.bal ? this.bal.skew : 0)
                setTimeSkew(skew)
                const rec = {
                    available: r.available, currency: r.currency, total: r.total,
                    granted: r.granted, toppedUp: r.toppedUp,
                    at: Date.now(), skew: skew
                }
                this.bal = rec
                saveBalance(rec)
                this.tickPeriod()
            } catch (e) {
                // 查不到就继续显示缓存值，卡片上不写错误（点进「连接与账户」才看细节）
                this.balMsg = (e && e.message) || '查询失败'
            } finally {
                this.balBusy = false
            }
        },
        tickPeriod() {
            this.period = describePeriod(nowMs())
        },
        startTick() {
            if (this.tickTimer) return
            this.tickTimer = setInterval(() => this.tickPeriod(), 5000)
        },
        stopTick() {
            if (this.tickTimer) {
                clearInterval(this.tickTimer)
                this.tickTimer = null
            }
        },

        // ---------- 模型 ----------
        pickModel(id) {
            if (!this.settings || !id) return
            if (this.settings.params.model === id) return
            if (!this.isAutoSave && this.dirty) {
                this.saveMsg = '先保存或放弃改动，再切模型'
                return
            }
            const p = Object.assign({}, this.settings.params)
            p.model = id
            this.apply({ params: p })
            log('model ' + id)
        },
        modelChipClass(id) {
            return this.settings && this.settings.params.model === id ? 'st-chip-on' : 'st-chip'
        },
        modelTxtClass(id) {
            return this.settings && this.settings.params.model === id ? 'st-chiptxt-on' : 'st-chiptxt'
        },

        // 分类页在后台改了记忆 / 对话（清空记忆、导入存档），回到这页时卡片上的
        // 「记忆已开 · N 条」「N 个对话」是旧的 —— 固件返回不触发 onShow，只能靠订阅
        watchStats() {
            if (this.statUnsub) return
            this.statUnsub = subscribeUiState((st) => {
                if (st.memoryRev === this.memRev && st.chatsRev === this.chatsRev) return
                this.memRev = st.memoryRev
                this.chatsRev = st.chatsRev
                this.refreshStats()
            })
        },

        // 卡片右下角那句状态：不用点进去也能看出哪块没配好
        async refreshStats() {
            this.statKey = getProfileKey()
            try {
                const convs = await loadChats()
                this.convCount = convs ? convs.length : 0
                const bal = await loadBalance()
                this.bal = bal || null
                this.hasBalance = !!(bal && bal.at)
                if (bal) setTimeSkew(bal.skew)
                const notes = await loadMemory()
                this.memoryCount = notes ? notes.length : 0
            } catch (e) {
                this.convCount = 0
            }
        },

        statusOf(secId) {
            const s = this.settings || {}
            return sectionStatus(secId, {
                hasKey: isReady(s),
                balance: this.hasBalance,
                balanceText: this.balanceText,
                periodText: this.periodText,
                params: s.params || {},
                memoryOn: !!(s.memory && s.memory.on),
                memoryCount: this.memoryCount,
                showBalance: s.showBalance !== false,
                srcFull: s.sourceStyle === 'full',
                convCount: this.convCount,
                hasAmapKey: !!this.amapKey,
                amapKeyMask: this.amapMask,
                version: APP_VERSION,
                personaName: s.personaName || ''
            })
        },

        // ---------- 模式 / 人设 ----------
        pickMode(mode) {
            if (!this.settings) return
            const cur = this.isRole ? 'role' : 'chat'
            if (cur === mode) return
            // 有未保存改动就先别切：切过去之后手上这份已经不属于任何档案了
            if (!this.isAutoSave && this.dirty) {
                this.saveMsg = '先保存或放弃改动，再切模式'
                return
            }
            const next = switchMode(mode)
            if (!next) { this.saveMsg = '切换失败：写入被拒绝'; return }
            this.adoptProfile(next)
            log('mode ' + mode)
        },

        pickPersona(id) {
            if (!this.settings || this.settings.personaId === id) return
            if (!this.isAutoSave && this.dirty) {
                this.saveMsg = '先保存或放弃改动，再切人设'
                return
            }
            const next = switchPersona(id)
            if (!next) { this.saveMsg = '切换失败：写入被拒绝'; return }
            this.adoptProfile(next)
            log('persona ' + id)
        },

        // 换了一份档案：整包换掉本地状态，指纹重算（否则「有未保存改动」会一直亮着）
        adoptProfile(flat) {
            this.settings = Object.assign({}, flat, {
                params: Object.assign({}, flat.params),
                memory: Object.assign({}, flat.memory)
            })
            this.savedSig = settingsSignature(flat)
            this.dirty = false
            this.leaveWarn = false
            this.saveMsg = ''
            this.convCount = 0
            this.hasBalance = false
            this.bal = null
            this.period = null
            this.refreshBalanceNow()
            // 首页也要知道换人了：它手上的 Key / 模型 / 会话记录全都得换
            publishSettings(this.settings)
            this.refreshStats()
        },

        openSection(id) {
            if (!this.settings) return
            if (!this.isAutoSave && this.dirty) {
                this.saveMsg = '有未保存改动，先保存或再点一次「返回」放弃'
                return
            }
            setSection(id)
            navTo('settingsx', {})
        },

        modeChipClass(mode) {
            const cur = this.isRole ? 'role' : 'chat'
            return cur === mode ? 'st-chip-on' : 'st-chip'
        },
        modeTxtClass(mode) {
            const cur = this.isRole ? 'role' : 'chat'
            return cur === mode ? 'st-chiptxt-on' : 'st-chiptxt'
        },
        personaChipClass(id) {
            return this.settings && this.settings.personaId === id ? 'st-chip-on' : 'st-chip'
        },
        personaTxtClass(id) {
            return this.settings && this.settings.personaId === id ? 'st-chiptxt-on' : 'st-chiptxt'
        },

        navToFn(target) {
            navTo(target, {})
        },
        back() {
            this.coreBack()
        }
    })
}
</script>

<style>
.st-page {
    width: 936px;
    height: 280px;
    flex-direction: column;
    background-color: #16161a;
}

.st-top {
    height: 40px;
    flex-direction: row;
    align-items: center;
    padding-left: 14px;
    padding-right: 14px;
    background-color: #1e1e24;
}

.st-title {
    font-size: 16px;
    color: #e8e8ee;
    margin-right: 12px;
}

.st-sub {
    font-size: 11px;
    color: #6d6d7c;
    flex: 1;
}

.st-sub-warn {
    font-size: 11px;
    color: #fbbf24;
    flex: 1;
}

.st-sub-bad {
    font-size: 11px;
    color: #f87171;
    flex: 1;
}

.st-mode {
    flex-direction: row;
    align-items: center;
    height: 24px;
    padding-left: 10px;
    padding-right: 10px;
    margin-right: 8px;
    border-radius: 6px;
    background-color: #2a2a33;
    border-width: 1px;
    border-color: #3a3a46;
}

.st-modetxt {
    font-size: 11px;
    color: #c9c9d4;
}

.st-save-on {
    flex-direction: row;
    align-items: center;
    height: 24px;
    padding-left: 12px;
    padding-right: 12px;
    margin-right: 8px;
    border-radius: 6px;
    background-color: #fbbf24;
}

.st-savetxt-on {
    font-size: 12px;
    color: #201704;
}

.st-save-off {
    flex-direction: row;
    align-items: center;
    height: 24px;
    padding-left: 12px;
    padding-right: 12px;
    margin-right: 8px;
    border-radius: 6px;
    background-color: #2a2a33;
}

.st-savetxt-off {
    font-size: 12px;
    color: #6d6d7c;
}

/* 可点击元素一律用 div 承载 padding：<text> 的 padding 不进布局与命中测试 */
.st-btn {
    flex-direction: row;
    align-items: center;
    height: 28px;
    background-color: #4ade80;
    padding-left: 14px;
    padding-right: 14px;
    border-radius: 6px;
}

.st-btntxt {
    font-size: 13px;
    color: #0d1a12;
}

/* 模式 / 人设 切换行 */
.st-switch {
    flex-direction: row;
    align-items: center;
    height: 24px;
    margin-top: 2px;
    padding-left: 16px;
    padding-right: 16px;
}

.st-swlabel {
    font-size: 11px;
    color: #7cc4ff;
    width: 34px;
}

.st-swhint {
    font-size: 10px;
    color: #5d5d6c;
    flex: 1;
    margin-left: 6px;
    lines: 1;
}

.st-chip {
    flex-direction: row;
    align-items: center;
    height: 22px;
    padding-left: 12px;
    padding-right: 12px;
    border-radius: 11px;
    background-color: #26262f;
    margin-right: 6px;
}

.st-chip-on {
    flex-direction: row;
    align-items: center;
    height: 22px;
    padding-left: 12px;
    padding-right: 12px;
    border-radius: 11px;
    background-color: #4ade80;
    margin-right: 6px;
}

.st-chiptxt {
    font-size: 11px;
    color: #9a9aa8;
}

.st-chiptxt-on {
    font-size: 11px;
    color: #0d1a12;
}

/* 分类卡片：横向排列 + 放不下换行；两侧 16px 留白，不顶满整行 */
.st-cards {
    flex-direction: row;
    flex-wrap: wrap;
    margin-top: 4px;
    padding-left: 16px;
    padding-right: 16px;
}

.st-card {
    width: 214px;
    height: 64px;
    flex-direction: column;
    background-color: #1c1c22;
    border-radius: 8px;
    padding: 6px;
    margin-right: 10px;
    margin-bottom: 6px;
    border-width: 1px;
    border-color: #26262f;
}

.st-cardhead {
    flex-direction: row;
    align-items: center;
    margin-bottom: 3px;
}

.st-cardbadge {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background-color: #26262f;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    margin-right: 6px;
}

.st-cardbadgetxt {
    font-size: 11px;
    color: #7cc4ff;
}

.st-cardtitle {
    font-size: 13px;
    color: #e4e4ec;
}

.st-cardsub {
    font-size: 10px;
    color: #6d6d7c;
    lines: 1;
    margin-bottom: 2px;
}

.st-cardstat {
    font-size: 10px;
    color: #9fe1cb;
    lines: 1;
}
</style>
