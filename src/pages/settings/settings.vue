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

        <scroller class="st-sc" scroll-direction="vertical">

            <!-- 连接：首次引导页之后，改 Key / 换服务地址的唯一入口 -->
            <div class="st-group">
                <text class="st-gtitle">连接</text>
                <div class="st-row" @click="editKey">
                    <text class="st-label">API Key</text>
                    <text :class="keyClass">{{ keyText }}</text>
                    <text class="st-hint">点击修改</text>
                </div>
                <div class="st-row" @click="editBase">
                    <text class="st-label">服务地址</text>
                    <text class="st-value">{{ baseUrl }}</text>
                    <text class="st-hint">点击修改</text>
                </div>
                <div class="st-row">
                    <text class="st-label">连通性</text>
                    <div class="st-btn2" @click="test"><text class="st-btn2txt">测试连接</text></div>
                    <div class="st-btn2" @click="scan"><text class="st-btn2txt">{{ scanning ? '扫描中…' : '扫描模型' }}</text></div>
                    <text :class="connStatusClass">{{ connStatus || '点左侧按钮验证 Key 是否可用' }}</text>
                </div>
            </div>

            <!-- 账户：余额走官方 GET /user/balance；峰谷是本地按规则算的（官方无状态接口） -->
            <div class="st-group">
                <text class="st-gtitle">账户</text>
                <div class="st-row">
                    <text class="st-label">余额</text>
                    <text :class="balValueClass">{{ balanceText }}</text>
                    <div class="st-btn2" @click="refreshBalance"><text class="st-btn2txt">{{ balBusy ? '查询中…' : '刷新' }}</text></div>
                    <text :class="balDocClass">{{ balDoc }}</text>
                </div>
                <!-- 整行可点：笔上 40px 高的行、按钮只有 24px，只点小方块太难命中。
                     注意两个圆角块**不能**再挂 @click —— 会和行级点击一起冒泡，
                     一次点击切两次 = 看着"点了没反应"。 -->
                <div class="st-row" @click="toggleShowBalance">
                    <text class="st-label">主页显示</text>
                    <div class="st-ctl">
                        <div :class="showBalOn ? 'st-opt-on' : 'st-opt'"><text :class="showBalOn ? 'st-opttxt-on' : 'st-opttxt'">显示</text></div>
                        <div :class="showBalOn ? 'st-opt' : 'st-opt-on'"><text :class="showBalOn ? 'st-opttxt' : 'st-opttxt-on'">隐藏</text></div>
                    </div>
                    <text class="st-doc">{{ showBalDoc }}</text>
                </div>
                <div class="st-row">
                    <text class="st-label">计费时段</text>
                    <text :class="periodClass">{{ periodText }}</text>
                    <text class="st-doc">{{ periodDoc }}</text>
                </div>
                <div class="st-row">
                    <text class="st-label">节假日</text>
                    <text :class="holClass">{{ holText }}</text>
                    <div class="st-btn2" @click="refreshHoliday(false)"><text class="st-btn2txt">{{ holBusy ? '更新中…' : '更新' }}</text></div>
                    <text class="st-doc">{{ holDoc }}</text>
                </div>
            </div>

            <div v-for="(g, gi) in groups" :key="gi" class="st-group">
                <text class="st-gtitle">{{ g.title }}</text>

                <div v-for="(it, ii) in g.items" :key="ii" class="st-row">
                    <text class="st-label">{{ it.label }}</text>

                    <!-- 布尔 -->
                    <div v-if="it.kind === 'bool'" class="st-ctl">
                        <div :class="boolClass(it.key, true)" @click="setParam(it.key, true)"><text :class="boolTxtClass(it.key, true)">开</text></div>
                        <div :class="boolClass(it.key, false)" @click="setParam(it.key, false)"><text :class="boolTxtClass(it.key, false)">关</text></div>
                    </div>

                    <!-- 枚举 -->
                    <div v-else-if="it.kind === 'enum'" class="st-ctl st-ctl-wrap">
                        <div v-for="(o, oi) in it.options" :key="oi" :class="enumClass(it.key, o.value)" @click="setParam(it.key, o.value)"><text :class="enumTxtClass(it.key, o.value)">{{ o.label }}</text></div>
                    </div>

                    <!-- 数值 -->
                    <div v-else-if="it.kind === 'number'" class="st-ctl">
                        <div class="st-step" @click="stepParam(it, -1)"><text class="st-steptxt">-</text></div>
                        <text class="st-num">{{ numText(it) }}</text>
                        <div class="st-step" @click="stepParam(it, 1)"><text class="st-steptxt">+</text></div>
                    </div>

                    <!-- 文本 -->
                    <div v-else class="st-ctl" @click="editParam(it)">
                        <text :class="textClass(it)">{{ textValue(it) }}</text>
                    </div>

                    <text :class="it.active ? 'st-doc' : 'st-doc-off'">{{ it.active ? it.doc : it.reason }}</text>
                </div>
            </div>

            <div class="st-group">
                <text class="st-gtitle">系统提示词</text>
                <div class="st-row">
                    <text class="st-label">System</text>
                    <div class="st-ctl" @click="editSystem">
                        <text :class="sysClass">{{ sysText }}</text>
                    </div>
                    <text class="st-doc">作为 system 消息置顶发送；留空则不发送</text>
                </div>
                <div class="st-row">
                    <text class="st-label">历史轮数</text>
                    <div class="st-ctl">
                        <div class="st-step" @click="stepHistory(-1)"><text class="st-steptxt">-</text></div>
                        <text class="st-num">{{ settings ? settings.maxHistory : 0 }}</text>
                        <div class="st-step" @click="stepHistory(1)"><text class="st-steptxt">+</text></div>
                    </div>
                    <text class="st-doc">最多携带最近 N 轮问答（越少越省 token）</text>
                </div>
                <div class="st-row">
                    <text class="st-label">拍照应用</text>
                    <div class="st-ctl" @click="cycleCamera">
                        <text class="st-text">{{ cameraLabel }}</text>
                    </div>
                    <text class="st-doc">点「拍照」时拉起哪个系统应用；返回后自动刷新相册</text>
                </div>
            </div>

            <div class="st-group">
                <text class="st-gtitle">请求预览</text>
                <div class="st-preview">
                    <text class="st-previewtext">{{ preview }}</text>
                </div>
            </div>

            <!-- 诊断：保存不上时，用户能自己把原因读出来（否则只能"我这边复现不了"） -->
            <div class="st-group">
                <text class="st-gtitle">诊断</text>
                <div class="st-row">
                    <text class="st-label">写入自检</text>
                    <div class="st-btn2" @click="runSelfTest"><text class="st-btn2txt">{{ diagBusy ? '检测中…' : '运行' }}</text></div>
                    <text class="st-doc">建目录 → 写测试文件 → 读回比对；失败会指出卡在哪一步</text>
                </div>
                <div class="st-row">
                    <text class="st-label">版本</text>
                    <div class="st-ctl"><text class="st-text">{{ appVer }}</text></div>
                    <text class="st-doc">数据目录 {{ dataDir }}</text>
                </div>
                <div class="st-row">
                    <text class="st-label">日志</text>
                    <div class="st-btn2" @click="refreshDiag"><text class="st-btn2txt">刷新</text></div>
                    <text class="st-doc">最近 10 行，存在同目录 app.log</text>
                </div>
                <div class="st-preview">
                    <text class="st-logtext">{{ diagMsg }}</text>
                </div>
                <div class="st-preview">
                    <text class="st-logtext">{{ logTailText }}</text>
                </div>
            </div>
        </scroller>
    </div>
</template>

<script>
import { loadSettings, saveSettings, loadBalance as loadBalanceCache, saveBalance, selfTestWrite, getLastSaveInfo } from '../../services/store.js'
import { openTextEditor } from '../../services/ime.js'
import { navTo, deviceInfo, log, logTail, appDir } from '../../services/platform.js'
import { APP_VERSION } from '../../lib/appversion.js'
import { listModels, testConnection, fetchBalance } from '../../services/api.js'
import { PARAMS, PARAM_MAP, defaultParams, clampNumber, buildBody, describeBody, modelOptions } from '../../lib/params.js'
import { maskKey, normalizeBaseUrl, isReady, settingsSignature } from '../../lib/settings.js'
import { describePeriod, setTimeSkew, nowMs, formatRemain, holidayTableYears } from '../../lib/peak.js'
import { restoreHoliday, ensureHoliday, holidaySummary } from '../../services/holiday.js'
import { balanceDetailText, balanceLevel, balanceSplitText, updatedAgo } from '../../lib/balance.js'
import { CAMERA_APPS } from '../../services/media.js'
import { setUiState, publishSettings } from '../../lib/uistate.js'

const GROUP_TITLES = {
    core: '模型与思考',
    web: '联网搜索',
    sampling: '采样与长度',
    output: '输出与结构',
    experimental: '实验特性'
}

const GROUP_ORDER = ['core', 'web', 'sampling', 'output', 'experimental']

export default {
    name: 'settings',
    data() {
        return {
            settings: null,
            connStatus: '',
            connOk: false,
            scanning: false,
            // 账户
            bal: null,
            balBusy: false,
            balMsg: '',
            period: null,
            nowTick: Date.now(),
            tickTimer: null,
            // 节假日数据
            holBusy: false,
            holMsg: '',
            holInfo: null,
            // 保存：saveMsg 是顶栏那行状态；savedSig 是"磁盘上那份"的指纹，
            // 和当前设置一比对就知道有没有未保存改动（手动模式才有意义）
            saveMsg: '',
            savedSig: '',
            // 诊断
            appVer: APP_VERSION,
            dataDir: '',
            diagBusy: false,
            diagMsg: '',
            logTailText: '',
            dirty: false,
            leaveWarn: false
        }
    },
    computed: {
        keyText() {
            const k = this.settings ? this.settings.apiKey : ''
            return k ? maskKey(k) : '（未填写，点击输入）'
        },
        keyClass() {
            const k = this.settings ? this.settings.apiKey : ''
            return k ? 'st-value' : 'st-ph'
        },
        baseUrl() {
            return this.settings ? this.settings.baseUrl : ''
        },
        connLabel() {
            const n = this.settings && this.settings.models ? this.settings.models.length : 0
            return n ? '已扫描 ' + n + ' 个可用模型' : '参数项与可选值对齐 DeepSeek 官方文档'
        },
        // ---------- 保存 ----------
        isAutoSave() {
            return !this.settings || this.settings.saveMode !== 'manual'
        },
        saveBtnLabel() {
            return this.dirty ? '保存' : '已保存'
        },
        saveBtnClass() {
            return this.dirty ? 'st-save-on' : 'st-save-off'
        },
        saveBtnTxtClass() {
            return this.dirty ? 'st-savetxt-on' : 'st-savetxt-off'
        },
        // 顶栏那行字：优先报保存状态，其次提示有未保存改动，最后才是常规说明
        topHint() {
            if (this.saveMsg) return this.saveMsg
            if (!this.isAutoSave && this.dirty) return '有改动未保存'
            return this.connLabel
        },
        topHintClass() {
            if (this.saveMsg && this.saveMsg.indexOf('失败') >= 0) return 'st-sub-bad'
            if (this.leaveWarn || (!this.isAutoSave && this.dirty)) return 'st-sub-warn'
            return 'st-sub'
        },
        connStatusClass() {
            return this.connOk ? 'st-ok' : 'st-hint'
        },
        // ---------- 账户 ----------
        balanceText() {
            return balanceDetailText(this.bal)
        },
        balValueClass() {
            if (!this.bal || !this.bal.at) return 'st-ph'
            const lv = balanceLevel(this.bal.total, this.bal.available)
            if (lv === 'empty' || lv === 'critical') return 'st-badnum'
            if (lv === 'low') return 'st-warnnum'
            return 'st-oknum'
        },
        balDoc() {
            if (this.balMsg) return this.balMsg
            if (!this.bal || !this.bal.at) return '点右侧「刷新」查询 GET /user/balance'
            return balanceSplitText(this.bal) + ' · ' + updatedAgo(this.bal.at, this.nowTick)
        },
        balDocClass() {
            return this.balMsg ? 'st-doc-off' : 'st-doc'
        },
        // 主页顶栏的「余额 + 峰谷」芯片开关
        showBalOn() {
            return !this.settings || this.settings.showBalance !== false
        },
        showBalDoc() {
            return this.showBalOn
                ? '点这一行切换；顶栏显示余额与峰谷，点芯片强刷，后台每 5 分钟查一次'
                : '点这一行切换；顶栏不显示，也停止自动查余额（本页数据照常可查）'
        },
        periodText() {
            const p = this.period
            if (!p) return '计算中'
            if (!p.remainMs) return p.label + ' · 近期无峰时'
            return p.label + ' · ' + (p.peak ? '转谷 ' : '转峰 ') + formatRemain(p.remainMs)
        },
        periodClass() {
            return this.period && this.period.peak ? 'st-warnnum' : 'st-oknum'
        },
        periodDoc() {
            const p = this.period
            if (!p) return ''
            return p.reasonText + '；工作日 9-12、14-18 峰价，其余半价'
        },
        // ---------- 节假日 ----------
        holText() {
            const i = this.holInfo
            if (!i) return '读取中'
            if (i.source === 'builtin') return '内置表'
            return i.years.length ? i.years.join('/') + ' 年' : '内置表'
        },
        holClass() {
            const i = this.holInfo
            if (!i || i.source === 'builtin') return 'st-hint'
            return 'st-ok'
        },
        holDoc() {
            if (this.holMsg) return this.holMsg
            const i = this.holInfo
            if (!i) return ''
            if (i.source === 'builtin') {
                return '还没从网络取过；内置 ' + holidayTableYears().join('/') + ' 年，点「更新」拉取最新公告'
            }
            return i.text
        },
        groups() {
            const p = this.settings ? this.settings.params : defaultParams()
            const out = []
            for (let gi = 0; gi < GROUP_ORDER.length; gi++) {
                const name = GROUP_ORDER[gi]
                const items = []
                for (let i = 0; i < PARAMS.length; i++) {
                    const def = PARAMS[i]
                    if (def.group !== name) continue
                    let active = true
                    let reason = ''
                    if (def.scope === 'thinking' && p.thinking === false) {
                        active = false
                        reason = '仅思考模式生效（已关闭深度思考）'
                    } else if (def.scope === 'noThinking' && p.thinking !== false) {
                        active = false
                        reason = '仅非思考模式生效（当前开启了深度思考）'
                    } else if (def.scope === 'stream' && !p.stream) {
                        active = false
                        reason = '仅流式输出时可用'
                    } else if (def.scope === 'logprobs' && !p.logprobs) {
                        active = false
                        reason = '需先开启「返回对数概率」'
                    }
                    // 模型那一项：可选值来自 /models 扫描结果，没扫过用内置清单兜底。
                    // 之前是写死两个模型 —— 服务端加了新模型也选不到。
                    let options = def.options
                    let doc = def.doc
                    if (def.key === 'model') {
                        options = this.modelOpts
                        const ms = (this.settings && this.settings.models) ? this.settings.models : []
                        doc = ms.length
                            ? '扫描结果 ' + ms.length + ' 个：' + ms.map((m) => m.id).join('、')
                            : '还没扫描过，当前用内置清单；点上方「扫描模型」取真实列表'
                    }
                    items.push({
                        key: def.key, label: def.label, kind: def.kind, options: options,
                        min: def.min, max: def.max, step: def.step, doc: doc,
                        active: active, reason: reason
                    })
                }
                if (items.length) out.push({ title: GROUP_TITLES[name] || name, items: items })
            }
            return out
        },
        modelOpts() {
            return modelOptions(this.settings ? this.settings.models : null)
        },
        sysText() {
            const s = this.settings ? this.settings.systemPrompt : ''
            return s ? (s.length > 46 ? s.slice(0, 46) + '…' : s) : '（空，点击编辑）'
        },
        sysClass() {
            const s = this.settings ? this.settings.systemPrompt : ''
            return s ? 'st-text' : 'st-ph'
        },
        cameraLabel() {
            const id = this.settings && this.settings.params.cameraAppid
            for (let i = 0; i < CAMERA_APPS.length; i++) if (CAMERA_APPS[i].appid === id) return CAMERA_APPS[i].name
            return CAMERA_APPS[0].name
        },
        preview() {
            if (!this.settings) return ''
            try {
                const built = buildBody(this.settings.params, [{ role: 'user', content: 'hi' }])
                return describeBody(built.body)
            } catch (e) {
                return String(e)
            }
        }
    },
    mounted() {
        this.load()
    },
    unmounted() {
        this.stopTick()
    },
    methods: {
        async load() {
            this.settings = await loadSettings()
            // 记下"磁盘上那份"的指纹，手动保存模式用它判断有没有未保存改动
            this.savedSig = settingsSignature(this.settings)
            this.dirty = false
            this.refreshDiag()
            // 把落盘的真实值广播一次：首页可能拿着旧值（先开首页再进设置），
            // 而返回上一页时固件不触发首页 onShow，只能靠这条通道
            setUiState({ showBalance: this.settings.showBalance !== false })
            publishSettings(this.settings)
            const dev = deviceInfo()
            if (dev.model) log('settings ' + dev.model + ' ' + dev.version + ' ' + dev.width + 'x' + dev.height)
            // 先贴上次的余额 + 时钟偏差（断网也有东西看），再起倒计时、查新的
            const cached = await loadBalanceCache()
            if (cached) {
                this.bal = cached
                setTimeSkew(cached.skew)
            }
            // 节假日表：先用缓存，再后台补一次网络（一年才变一次）
            await restoreHoliday()
            this.holInfo = holidaySummary()
            this.tickPeriod()
            this.startTick()
            // 还没扫过模型（首次配置 / 换过服务地址）就自动扫一次：
            // 省的只是"忘点按钮"这一步，但结果差别很大 —— 下拉里放的是服务端
            // 真实返回的模型，而不是内置清单里那两条猜测。
            const ms = this.settings && this.settings.models
            if (isReady(this.settings) && (!ms || !ms.length)) this.scan()
            if (isReady(this.settings)) this.refreshBalance()
            // 缓存过期就顺手更新一次；失败保持内置表，不打扰用户
            this.refreshHoliday(true)
        },

        // ---------- 节假日 ----------
        // 数据来自第三方（holiday-cn / timor.tech），一年只变一次；quiet=true 表示
        // 后台顺手更新，不显示"更新中"。真正的兜底是 peak.js 里的内置表。
        async refreshHoliday(quiet) {
            if (this.holBusy) return
            this.holBusy = true
            if (!quiet) this.holMsg = ''
            try {
                const r = await ensureHoliday({ force: quiet !== true })
                if (r && r.fetched && r.fetched.length) {
                    this.holMsg = r.msg + '（已生效）'
                    this.tickPeriod()
                } else if (!quiet) {
                    this.holMsg = (r && r.msg) || '没有可更新的年份'
                }
            } catch (e) {
                if (!quiet) this.holMsg = (e && e.message) || '更新失败'
            } finally {
                this.holInfo = holidaySummary()
                this.holBusy = false
            }
        },

        // ---------- 账户 ----------
        // 主页芯片开关。整体换 settings 对象（不就地改字段）：Weex 对深层属性
        // 直接改写的派发不稳，换引用才能保证 computed 一定重算
        toggleShowBalance() {
            const next = !this.showBalOn
            // 广播交给 persist()：手动保存模式下，开关改动要等点「保存」才对首页生效
            this.apply({ showBalance: next })
            log('showBalance ' + next)
        },

        // 余额：GET /user/balance（官方接口）。顺带用响应头 Date 校准设备时钟 ——
        // 峰谷判定完全依赖"现在几点"，设备没同步 NTP 的话时段会算错。
        async refreshBalance() {
            if (this.balBusy) return
            if (!isReady(this.settings)) {
                this.balMsg = '先填 API Key 再查余额'
                return
            }
            this.balBusy = true
            this.balMsg = ''
            try {
                const r = await fetchBalance({
                    baseUrl: this.settings.baseUrl,
                    apiKey: this.settings.apiKey,
                    timeoutMs: 8000
                })
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
                log('balance ' + rec.total + ' ' + rec.currency)
            } catch (e) {
                this.balMsg = (e && e.message) || '余额查询失败'
            } finally {
                this.balBusy = false
            }
        },

        // 峰谷：本地按官方规则算，官方没有状态接口
        tickPeriod() {
            this.period = describePeriod(nowMs())
            this.nowTick = Date.now()
        },
        startTick() {
            if (this.tickTimer) return
            // 倒计时只显示到分钟，5 秒刷一次够用；1 秒一次会让整页反复重排
            this.tickTimer = setInterval(() => this.tickPeriod(), 5000)
        },
        stopTick() {
            if (this.tickTimer) {
                clearInterval(this.tickTimer)
                this.tickTimer = null
            }
        },
        // ---------- 保存 ----------
        // 所有改动都走这里：整体换对象（不就地改字段），再按保存模式决定落盘还是标记待存。
        // 统一入口的好处是"手动模式"只需要在一个地方判断，不会漏掉某个开关。
        apply(patch) {
            if (!this.settings) return false
            this.settings = Object.assign({}, this.settings, patch || {})
            if (this.isAutoSave) {
                this.persist()
            } else {
                // 一有改动就让位给「有改动未保存」，别让上一条提示一直占着顶栏
                this.saveMsg = ''
                this.refreshDirty()
            }
            return true
        },
        afterChange() {
            if (this.isAutoSave) this.persist()
            else this.refreshDirty()
        },
        refreshDirty() {
            if (!this.savedSig) { this.dirty = false; return }
            this.dirty = settingsSignature(this.settings) !== this.savedSig
            if (this.dirty) this.leaveWarn = false
        },
        // 落盘 + 回读校验。saveSettings 内部是同步写（本机 fs.writeFile 同步），
        // 返回 null 表示写失败 —— 以前这个返回值被丢掉，写失败时界面一切正常，
        // 重启后设置全没了，正是"填了 Key 又消失"那类反馈的来源之一。
        persist() {
            if (!this.settings) return false
            const saved = saveSettings(this.settings)
            if (!saved) {
                // 顶栏只放得下一句话；真实原因放诊断区并已写进 app.log
                const info = getLastSaveInfo()
                this.saveMsg = '保存失败：写入被拒绝'
                this.diagMsg = '上次保存失败：' + (info.reason || 'unknown') + '\n目标 ' + info.path
                this.refreshDirty()
                log('saveSettings 返回 null :: ' + info.reason)
                this.refreshDiag()
                return false
            }
            this.settings = saved
            this.savedSig = settingsSignature(saved)
            this.dirty = false
            this.leaveWarn = false
            this.saveMsg = '已保存'
            // 首页靠这条通道换掉自己那份 settings（返回上一页不触发 onShow）
            publishSettings(saved)
            this.verifySavedSoon(saved)
            return true
        },
        // 写一次不算数：本机 writeFile 会"不报错也不落盘"，必须读回比对。
        // 放在 300ms 后做，不挡操作；真的对不上再翻脸，并把日志摆到诊断区。
        verifySavedSoon(expected) {
            const sig = settingsSignature(expected)
            setTimeout(async () => {
                const disk = await loadSettings()
                if (!disk) return
                if (settingsSignature(disk) === sig) return
                this.saveMsg = '保存失败：写后读回不一致'
                this.diagMsg = '写后读回不一致，已记入日志\n目标 ' + appDir() + '/settings.json'
                log('settings 写后读回不一致')
                this.refreshDiag()
            }, 300)
        },
        saveNow() {
            if (this.isAutoSave) { this.saveMsg = '当前是自动保存，无需手动保存'; return }
            if (!this.dirty) { this.saveMsg = '没有需要保存的改动'; return }
            this.persist()
        },
        // ---------- 诊断 ----------
        refreshDiag() {
            this.logTailText = logTail(10) || '(日志为空)'
            this.dataDir = appDir()
        },
        async runSelfTest() {
            if (this.diagBusy) return
            this.diagBusy = true
            this.diagMsg = '正在自检…'
            const r = await selfTestWrite()
            this.diagBusy = false
            if (r.ok) {
                this.diagMsg = '写入正常：目录可写、读回一致\n' + r.dir
                log('selftest ok ' + r.dir)
            } else {
                const stepName = r.step === 'write' ? '写入失败' : (r.step === 'read' ? '写入成功但读不回来' : '读回内容不一致')
                this.diagMsg = '自检不通过：' + stepName + '\n' + r.error + '\n' + r.dir
                log('selftest fail step=' + r.step + ' :: ' + r.error)
            }
            this.refreshDiag()
        },
        toggleSaveMode() {
            const next = this.isAutoSave ? 'manual' : 'auto'
            // 模式本身立刻落盘（切换动作不能丢），顺带把已有改动一起存了
            this.settings = Object.assign({}, this.settings, { saveMode: next })
            const ok = this.persist()
            if (!ok) return
            this.saveMsg = next === 'manual'
                ? '已切到手动保存：改完点右上「保存」'
                : '已切到自动保存：改动即时落盘'
            log('saveMode ' + next)
        },
        // 保存后回读一遍，确认磁盘上真的是用户输入的值（防"看着存了其实没存"）
        async verifyKey(expected) {
            const disk = await loadSettings()
            if (!disk || disk.apiKey !== expected) {
                this.saveMsg = '保存失败：磁盘上的 Key 与输入不一致'
                log('verifyKey 不一致 disk=' + (disk ? disk.apiKey.length : -1) + ' want=' + expected.length)
                return false
            }
            return true
        },

        // ---------- 连接 ----------
        // 注意这里必须先判空：load() 是异步的（要读文件、还要等节假日网络），
        // 页面一渲染出来就能点。以前直接取 this.settings.apiKey，抢在加载完成前
        // 点就会抛 TypeError —— async 方法里抛出的错没人接，用户看到的就是
        // "点了没反应、填了也不保存"，这正是首次进入时的必现路径。
        async editKey() {
            if (!this.settings) { this.connStatus = '配置还在读取，请稍候再点'; return }
            const text = await openTextEditor(this.settings.apiKey || '', { multiLine: false, confirmText: '确定', maxlength: 200 })
            if (text === null || text === undefined) return
            const key = String(text).trim()
            this.connOk = false
            this.apply({ apiKey: key })
            if (!this.isAutoSave) { this.connStatus = '已修改，点右上「保存」生效'; return }
            const ok = await this.verifyKey(key)
            this.connStatus = !ok
                ? '保存失败，请重试'
                : (isReady(this.settings) ? '已保存，建议点「测试连接」验证' : 'Key 太短，仍不可用')
        },
        async editBase() {
            if (!this.settings) { this.connStatus = '配置还在读取，请稍候再点'; return }
            const text = await openTextEditor(this.settings.baseUrl || '', { multiLine: false, confirmText: '确定', maxlength: 200 })
            if (text === null || text === undefined) return
            const url = normalizeBaseUrl(text)
            this.connOk = false
            this.apply({ baseUrl: url })
            if (!this.isAutoSave) { this.connStatus = '已修改，点右上「保存」生效'; return }
            const disk = await loadSettings()
            if (!disk || disk.baseUrl !== url) { this.saveMsg = '保存失败：服务地址未写入'; return }
            this.connStatus = '服务地址已改为 ' + url
        },
        async test() {
            if (this.scanning) return
            if (!isReady(this.settings)) { this.connStatus = '请先填入 API Key'; this.connOk = false; return }
            this.scanning = true
            this.connStatus = '正在连接…'
            this.connOk = false
            const r = await testConnection({ baseUrl: this.settings.baseUrl, apiKey: this.settings.apiKey })
            this.scanning = false
            if (r.ok) {
                this.applyModels(r.models)
                this.connOk = true
                this.connStatus = '连接成功，可用模型：' + r.models.map((m) => m.id).join(' / ')
            } else {
                this.connStatus = r.error || '连接失败'
            }
        },
        async scan() {
            if (this.scanning) return
            if (!isReady(this.settings)) { this.connStatus = '请先填入 API Key'; this.connOk = false; return }
            this.scanning = true
            this.connStatus = '正在扫描可用模型…'
            this.connOk = false
            try {
                const list = await listModels({ baseUrl: this.settings.baseUrl, apiKey: this.settings.apiKey, timeoutMs: 15000 })
                this.applyModels(list)
                this.connOk = list.length > 0
                this.connStatus = list.length
                    ? ('已刷新：扫描到 ' + list.length + ' 个模型 → 下方「模型」可选 ' + list.map((m) => m.id).join(' / '))
                    : '接口返回空列表'
            } catch (e) {
                this.connStatus = (e && e.message) || '扫描失败'
            } finally {
                this.scanning = false
            }
        },
        // 扫描结果落盘，首页顶栏的模型芯片也用它显示短名
        applyModels(list) {
            const arr = (list || []).filter((m) => m && m.id)
                .map((m) => ({ id: String(m.id), label: String(m.label || m.id) }))
            // 当前选中的模型如果已经不在可用列表里（例如 old 模型下线了），自动切到第一个
            const ids = arr.map((m) => m.id)
            const p = Object.assign({}, this.settings.params)
            if (ids.length && ids.indexOf(p.model) < 0) p.model = ids[0]
            // **整体换对象**，不要就地改 this.settings.models。
            // Weex 运行时对"深层属性直接改写"的派发不稳（曾经表现为扫描成功、
            // 界面上的模型选项一个字都没变）；换引用能保证 groups / modelOpts
            // 这两个 computed 一定重算，模板一定重渲染。
            this.apply({ models: arr, params: p })
        },

        // ---------- 参数 ----------
        setParam(key, value) {
            const p = Object.assign({}, this.settings.params)
            p[key] = value
            this.apply({ params: p })
        },
        stepParam(it, dir) {
            const def = PARAM_MAP[it.key]
            const cur = Number(this.settings.params[it.key]) || 0
            const step = def.step || 1
            const next = clampNumber(def, cur + dir * step)
            this.setParam(it.key, next)
        },
        numText(it) {
            const v = this.settings ? this.settings.params[it.key] : 0
            if (it.key === 'maxTokens' && !Number(v)) return '自动'
            if (it.key === 'topLogprobs' && !Number(v)) return '0'
            return String(v)
        },
        boolClass(key, val) {
            const cur = this.settings.params[key] === true
            return cur === val ? 'st-opt-on' : 'st-opt'
        },
        boolTxtClass(key, val) {
            const cur = this.settings.params[key] === true
            return cur === val ? 'st-opttxt-on' : 'st-opttxt'
        },
        enumClass(key, val) {
            return this.settings.params[key] === val ? 'st-opt-on' : 'st-opt'
        },
        enumTxtClass(key, val) {
            return this.settings.params[key] === val ? 'st-opttxt-on' : 'st-opttxt'
        },
        textValue(it) {
            const v = this.settings.params[it.key]
            if (!v) return '（空，点击编辑）'
            return String(v).length > 30 ? String(v).slice(0, 30) + '…' : String(v)
        },
        textClass(it) {
            const v = this.settings.params[it.key]
            return v ? 'st-text' : 'st-ph'
        },
        async editParam(it) {
            const cur = String(this.settings.params[it.key] || '')
            const text = await openTextEditor(cur, { multiLine: it.key === 'stopText', confirmText: '确定', maxlength: 600 })
            if (text === null || text === undefined) return
            this.setParam(it.key, String(text))
        },
        async editSystem() {
            if (!this.settings) { this.connStatus = '配置还在读取，请稍候再点'; return }
            const text = await openTextEditor(this.settings.systemPrompt || '', { multiLine: true, confirmText: '完成', maxlength: 1200 })
            if (text === null || text === undefined) return
            this.apply({ systemPrompt: String(text) })
        },
        stepHistory(dir) {
            let v = ((this.settings && this.settings.maxHistory) || 0) + dir
            if (v < 0) v = 0
            if (v > 20) v = 20
            this.apply({ maxHistory: v })
        },
        cycleCamera() {
            const cur = this.settings.params.cameraAppid || CAMERA_APPS[0].appid
            let idx = 0
            for (let i = 0; i < CAMERA_APPS.length; i++) if (CAMERA_APPS[i].appid === cur) idx = i
            const next = CAMERA_APPS[(idx + 1) % CAMERA_APPS.length]
            this.setParam('cameraAppid', next.appid)
        },
        back() {
            // 手动保存模式下有未保存改动：第一次点只提醒，再点一次才真的丢弃离开。
            // 不做自动保存 —— 那样"手动"就名不副实了。
            if (!this.isAutoSave && this.dirty && !this.leaveWarn) {
                this.leaveWarn = true
                this.saveMsg = '有未保存改动，再点一次「返回」将放弃'
                return
            }
            this.stopTick()
            navTo('index', {})
        }
    }
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

/* 顶栏状态：未保存=琥珀，保存失败=红 */
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

/* 保存方式切换：始终可见，点一下在 自动 / 手动 之间切 */
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

/* 手动模式下的保存按钮：有改动才亮，没有改动时是灰的（不可点） */
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

/* 可点击元素一律用 div 承载 padding：<text> 的 padding 不进布局与命中测试，
   热区会和看得见的位置错开（详见 index.vue 里 .ix-chip 的注释）。 */
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

.st-sc {
    height: 240px;
    padding-left: 12px;
    padding-right: 12px;
}

.st-group {
    flex-direction: column;
    margin-top: 8px;
    margin-bottom: 4px;
}

.st-gtitle {
    font-size: 12px;
    color: #7cc4ff;
    margin-bottom: 4px;
}

.st-row {
    flex-direction: row;
    align-items: center;
    height: 40px;
    background-color: #1c1c22;
    border-radius: 6px;
    padding-left: 10px;
    padding-right: 10px;
    margin-bottom: 4px;
}

.st-label {
    font-size: 13px;
    color: #c8c8d4;
    width: 92px;
}

.st-ctl {
    flex-direction: row;
    align-items: center;
    margin-right: 10px;
}

/* 连接行里的两个动作按钮（测试连接 / 扫描模型） */
.st-btn2 {
    flex-direction: row;
    align-items: center;
    height: 26px;
    background-color: #26262f;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 5px;
    margin-right: 8px;
}

.st-btn2txt {
    font-size: 12px;
    color: #7cc4ff;
}

.st-ctl-wrap {
    flex-wrap: wrap;
}

.st-opt {
    flex-direction: row;
    align-items: center;
    height: 24px;
    background-color: #26262f;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 5px;
    margin-right: 6px;
    margin-top: 2px;
    margin-bottom: 2px;
}

.st-opt-on {
    flex-direction: row;
    align-items: center;
    height: 24px;
    background-color: #4ade80;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 5px;
    margin-right: 6px;
    margin-top: 2px;
    margin-bottom: 2px;
}

.st-opttxt {
    font-size: 12px;
    color: #9a9aa8;
}

.st-opttxt-on {
    font-size: 12px;
    color: #0d1a12;
}

.st-step {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 26px;
    background-color: #26262f;
    border-radius: 5px;
}

.st-steptxt {
    font-size: 16px;
    color: #cfd6e4;
}

.st-num {
    font-size: 13px;
    color: #e4e4ec;
    width: 62px;
    text-align: center;
}

.st-text {
    font-size: 13px;
    color: #e4e4ec;
}

.st-value {
    font-size: 13px;
    color: #9fe1cb;
    flex: 1;
    lines: 1;
    text-overflow: ellipsis;
}

.st-ph {
    font-size: 13px;
    color: #6d6d7c;
}

.st-hint {
    font-size: 11px;
    color: #6d6d7c;
}

.st-ok {
    font-size: 11px;
    color: #4ade80;
    flex: 1;
    lines: 1;
}

/* 余额 / 时段这类"数值"文本：不占满剩余宽度（后面的 doc 才需要 flex:1） */
.st-oknum {
    font-size: 13px;
    color: #4ade80;
}
.st-warnnum {
    font-size: 13px;
    color: #f0b866;
}
.st-badnum {
    font-size: 13px;
    color: #f08a83;
}

.st-doc {
    font-size: 10px;
    color: #6d6d7c;
    flex: 1;
    lines: 1;
}

.st-doc-off {
    font-size: 10px;
    color: #b8863a;
    flex: 1;
    lines: 1;
}

.st-preview {
    flex-direction: row;
    background-color: #1c1c22;
    border-radius: 6px;
    padding: 8px;
}

.st-previewtext {
    font-size: 11px;
    color: #9fe1cb;
}

/* 诊断区：日志要能整段读，字号压到 9px，允许换行 */
.st-logtext {
    font-size: 9px;
    color: #8f8f9e;
}
</style>
