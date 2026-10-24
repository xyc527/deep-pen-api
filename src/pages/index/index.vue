<template>
    <div class="ix-page">

        <!-- 顶栏：标题 + 参数状态 + 入口。高度固定，滚动区拿剩下的高度 -->
        <div class="ix-top">
            <text class="ix-title" @click="openDrawer">{{ title }}</text>
            <div class="ix-chip" @click="openSettings"><text class="ix-chiptxt">{{ modelShort }}</text></div>
            <!-- 余额 + 当前计费时段：点一下立刻查一次余额（后台每 5 分钟自动刷）。
                 可在设置页「账户 → 主页显示」关掉，关掉后连轮询一起停 -->
            <div v-if="showBal" :class="balChipClass" @click="refreshBalance(true)"><text :class="balTxtClass">{{ balLabel }}</text></div>
            <div :class="thinkChipClass" @click="toggleThink"><text :class="thinkTxtClass">{{ thinkLabel }}</text></div>
            <div :class="searchChipClass" @click="toggleSearch"><text :class="searchTxtClass">{{ searchLabel }}</text></div>
            <div class="ix-chip" @click="newChat"><text class="ix-chiptxt">新对话</text></div>
            <div class="ix-chip" @click="openDrawer"><text class="ix-chiptxt">历史</text></div>
        </div>

        <!-- 消息区：scroller 不能套 v-if（被 v-if 包裹会渲染空白） -->
        <scroller class="ix-msgs" scroll-direction="vertical">
            <div v-for="(m, mi) in messages" :key="m.id" class="ix-msg" :style="msgStyle(m)">
                <div class="ix-msghead">
                    <text :class="roleClass(m)">{{ roleLabel(m) }}</text>
                    <div v-if="m.role === 'assistant' && !m.pending" class="ix-meta" @click="toggleReason(m)"><text class="ix-metatxt">{{ reasonToggle(m) }}</text></div>
                </div>

                <!-- 思考过程（可折叠） -->
                <div v-if="m.reasoning && reasonOpen(m)" :class="cls('ix-reason', m)">
                    <text :class="cls('ix-reasontext', m)">{{ m.reasoning }}</text>
                </div>

                <!-- 图片附件：预览 + 名称 -->
                <div v-if="m.images && m.images.length" class="ix-thumbs">
                    <div v-for="(im, ii) in m.images" :key="im.key" class="ix-thumb">
                        <image class="ix-thumbimg" :src="fileSrc(im.path)" :style="{ width: '96px', height: '60px' }"></image>
                        <text class="ix-thumbname">{{ im.name }}</text>
                    </div>
                </div>

                <text v-if="m.error" class="ix-err">{{ m.error }}</text>

                <!-- Markdown + LaTeX。run 必须同级平铺：<text> 带元素子节点会让框架 abort -->
                <div v-else class="ix-md">
                    <div v-for="(b, bi) in plan(m)" :key="bi" class="ix-blk">
                        <div v-if="b.type === 'p'" class="ix-p">
                            <template v-for="(r, ri) in b.runs" :key="ri">
                                <richtext v-if="r.math && r.typeset" class="ix-math"><latex :value="r.value"></latex></richtext>
                                <text v-else :class="runClass(r, m)">{{ r.text }}</text>
                            </template>
                        </div>
                        <div v-else-if="b.type === 'math'" class="ix-mathblock">
                            <div class="ix-mathcard" :style="mathCardStyle(m)">
                                <div v-if="b.lines && b.lines.length" class="ix-mathcol">
                                    <richtext v-for="(ln, li) in b.lines" :key="li" class="ix-math"><latex :value="ln"></latex></richtext>
                                </div>
                                <richtext v-else-if="b.native" class="ix-math"><latex :value="b.text"></latex></richtext>
                                <text v-else class="ix-mathfallback">{{ b.uni }}</text>
                            </div>
                        </div>
                        <text v-else-if="b.type === 'code'" :class="cls('ix-code', m)">{{ b.text }}</text>
                        <text v-else-if="b.type === 'h'" :class="headClass(b, m)">{{ b.text }}</text>
                        <text v-else-if="b.type === 'quote'" :class="cls('ix-quote', m)">{{ b.text }}</text>
                        <text v-else-if="b.type === 'hr'" :class="cls('ix-hr', m)">————————</text>
                        <div v-else-if="b.type === 'li'" class="ix-lirow">
                            <text :class="cls('ix-limark', m)">{{ b.marker }}</text>
                            <div class="ix-lirun">
                                <template v-for="(r, ri) in b.runs" :key="ri">
                                    <richtext v-if="r.math && r.typeset" class="ix-math"><latex :value="r.value"></latex></richtext>
                                    <text v-else :class="runClass(r, m)">{{ r.text }}</text>
                                </template>
                            </div>
                        </div>
                        <div v-else-if="b.type === 'table'" :class="cls('ix-tbl', m)">
                            <div v-for="(row, ri) in b.rows" :key="ri" :class="tblRowClass(ri, m)">
                                <text v-for="(cell, ci) in row" :key="ci" :class="tblCellClass(ri, m)">{{ cell }}</text>
                            </div>
                        </div>
                    </div>
                    <text v-if="m.pending && !m.content" :class="cls('ix-typing', m)">正在思考…</text>
                </div>
            </div>

            <div v-if="status" class="ix-status">
                <text class="ix-statustext">{{ status }}</text>
            </div>
            <div ref="bottom" class="ix-anchor"></div>
        </scroller>

        <!-- 输入条 -->
        <div class="ix-input">
            <div :class="imgBtnClass" @click="openPicker"><text :class="imgBtnTxtClass">{{ imgLabel }}</text></div>
            <div class="ix-btn" @click="takePhoto"><text class="ix-btntxt">拍照</text></div>
            <div class="ix-field" @click="editText">
                <text :class="draftClass">{{ draftText }}</text>
            </div>
            <div v-if="!busy" class="ix-sendbtn" @click="send"><text class="ix-sendtxt">发送</text></div>
            <div v-else class="ix-stopbtn" @click="stop"><text class="ix-stoptxt">停止</text></div>
        </div>

        <!-- 图片选择层 -->
        <div v-if="view === 'picker'" class="ix-overlay">
            <div class="ix-panel">
                <div class="ix-paneltop">
                    <text class="ix-paneltitle">选择图片（已选 {{ images.length }}/{{ maxImages }}）</text>
                    <div class="ix-chip" @click="refreshPhotos"><text class="ix-chiptxt">刷新</text></div>
                    <div class="ix-chip" @click="closePicker"><text class="ix-chiptxt">完成</text></div>
                </div>
                <scroller class="ix-photosc" scroll-direction="vertical">
                    <div class="ix-grid">
                        <div v-for="(p, pi) in photos" :key="p.key" :class="photoCellClass(p)" @click="togglePhoto(p)">
                            <image class="ix-photoimg" :src="fileSrc(p.path)" :style="{ width: '112px', height: '70px' }"></image>
                            <text :class="photoNameClass(p)">{{ p.name }}</text>
                        </div>
                    </div>
                    <text v-if="!photos.length" class="ix-empty">相册里还没有照片，点「拍照」用系统相机拍一张</text>
                </scroller>
            </div>
        </div>

        <!-- 会话抽屉 -->
        <div v-if="view === 'drawer'" class="ix-overlay">
            <div class="ix-drawer">
                <div class="ix-paneltop">
                    <text class="ix-paneltitle">历史对话（{{ convs.length }}）</text>
                    <div class="ix-chip" @click="closeDrawer"><text class="ix-chiptxt">关闭</text></div>
                </div>
                <scroller class="ix-convsc" scroll-direction="vertical">
                    <!-- 行内不再套一层可点元素：本平台里「父可点 + 子可点 + @click.stop」
                         会让子元素吃掉命中却又不执行处理器（实测点「删除」毫无反应，
                         连父级的切换都被吞掉）。改为并列两个可点区域，互不嵌套；
                         删除还要再点一次确认，避免和右上角「关闭」误触。 -->
                    <div v-for="(c, ci) in convs" :key="c.id" class="ix-convrow" :style="convRowStyle(c)">
                        <div class="ix-convopen" @click="switchConv(c)"><text class="ix-convtitle">{{ c.title }}</text></div>
                        <div :class="delRowClass(c)" @click="askDelete(c)"><text :class="delTxtClass(c)">{{ delLabel(c) }}</text></div>
                    </div>
                </scroller>
            </div>
        </div>
    </div>
</template>

<script>
import { loadSettings, saveSettings, loadChats, saveChats, loadPhotoSeen, savePhotoSeen, loadBalance, saveBalance } from '../../services/store.js'
import { sendChat, sendOnce, fetchBalance } from '../../services/api.js'
import { restoreHoliday, ensureHoliday } from '../../services/holiday.js'
import { openTextEditor } from '../../services/ime.js'
import { listPhotos, toDataUrl, launchCamera, photoDirStamp } from '../../services/media.js'
import { navTo, log } from '../../services/platform.js'
import { isReady } from '../../lib/settings.js'
import { buildBody, describeBody } from '../../lib/params.js'
import { renderPlan, needsPaperSheet } from '../../lib/md.js'
import { shortModelLabel } from '../../lib/params.js'
import { buildApiMessages, newConversation, newMessage, ensureTitle, summarizeUsage } from '../../lib/chat.js'
import { addPhoto, removePhoto, diffNewPhotos, formatSize } from '../../lib/photos.js'
import { billingPeriod, setTimeSkew, nowMs } from '../../lib/peak.js'
import { balanceChipText, balanceLevel } from '../../lib/balance.js'
import { setUiState, subscribeUiState } from '../../lib/uistate.js'

const MAX_IMAGES = 4

// 渲染计划缓存放在模块作用域（不要放进 data：写 data 会在渲染期触发重渲染）
const planCache = {}
const reasonOpenSet = {}
// 流式节流用的临时表（放模块作用域，避免写 data 触发额外重渲染）
const streamBuf = {}
const streamTimers = {}
const streamAt = {}
// 纸面判定缓存：内容每 180ms 变一次，不去重的话每个元素都跑一遍正则
const paperCache = {}
// 单条消息最多渲染多少字符
const RENDER_MAX = 40000
const PENDING_RENDER_MAX = 12000

export default {
    name: 'index',
    data() {
        return {
            view: 'chat',
            settings: null,
            convs: [],
            convId: '',
            draft: '',
            images: [],
            photos: [],
            busy: false,
            cancelled: false,
            status: '',
            photoSeen: null,
            watchTimer: null,
            photoStamp: null,
            destroyed: false,
            maxImages: MAX_IMAGES,
            delId: '',
            urlCache: {},
            // 余额 + 计费时段（余额落盘缓存，断网时显示上次的值）
            bal: null,
            balBusy: false,
            balErr: '',
            balFetchedAt: 0,
            // 顶栏余额芯片是否显示。**必须是 data 而不是 computed**：
            // 设置页改完要能立刻推过来（见 lib/uistate.js），computed 只能靠
            // settings 对象换引用触发，而设置页改的是它自己那份 settings。
            showBal: true,
            period: null,
            periodTimer: null
        }
    },
    computed: {
        conv() {
            for (let i = 0; i < this.convs.length; i++) if (this.convs[i].id === this.convId) return this.convs[i]
            return null
        },
        messages() {
            return this.conv ? this.conv.messages : []
        },
        title() {
            return this.conv ? this.conv.title : 'DeepSeek'
        },
        modelShort() {
            const id = this.settings ? this.settings.params.model : ''
            return shortModelLabel(id, this.settings ? this.settings.models : null)
        },
        thinkLabel() {
            const on = this.settings && this.settings.params.thinking !== false
            return on ? '思考 开' : '思考 关'
        },
        thinkChipClass() {
            const on = this.settings && this.settings.params.thinking !== false
            return on ? 'ix-chip-on' : 'ix-chip'
        },
        thinkTxtClass() {
            const on = this.settings && this.settings.params.thinking !== false
            return on ? 'ix-chiptxt-on' : 'ix-chiptxt'
        },
        searchTxtClass() {
            const on = this.settings && this.settings.params.webSearch === true
            return on ? 'ix-chiptxt-on' : 'ix-chiptxt'
        },
        searchLabel() {
            const on = this.settings && this.settings.params.webSearch === true
            return on ? '联网 开' : '联网 关'
        },
        searchChipClass() {
            const on = this.settings && this.settings.params.webSearch === true
            return on ? 'ix-chip-on' : 'ix-chip'
        },
        // 芯片文案：¥12.34·谷。没查过就只写「余额」，让用户知道可以点
        balLabel() {
            if (this.balBusy && !this.bal) return '余额…'
            return balanceChipText(this.bal, this.period)
        },
        balLevel() {
            if (!this.bal) return 'none'
            return balanceLevel(this.bal.total, this.bal.available)
        },
        // 余额异常优先用红/黄，正常时颜色跟随时段（峰价偏暖、谷价偏绿）
        balChipClass() {
            const lv = this.balLevel
            if (lv === 'empty' || lv === 'critical') return 'ix-balchip-bad'
            if (lv === 'none') return 'ix-balchip'
            if (lv === 'low') return 'ix-balchip-warn'
            return this.period && this.period.peak ? 'ix-balchip-peak' : 'ix-balchip-ok'
        },
        balTxtClass() {
            const lv = this.balLevel
            if (lv === 'empty' || lv === 'critical') return 'ix-baltxt-bad'
            if (lv === 'none') return 'ix-baltxt'
            if (lv === 'low') return 'ix-baltxt-warn'
            return this.period && this.period.peak ? 'ix-baltxt-peak' : 'ix-baltxt-ok'
        },
        imgLabel() {
            return this.images.length ? '图片 ' + this.images.length : '图片'
        },
        imgBtnClass() {
            return this.images.length ? 'ix-btn-on' : 'ix-btn'
        },
        imgBtnTxtClass() {
            return this.images.length ? 'ix-btntxt-on' : 'ix-btntxt'
        },
        draftText() {
            return this.draft ? this.draft : '点击这里输入…'
        },
        draftClass() {
            return this.draft ? 'ix-fieldtext' : 'ix-fieldph'
        }
    },
    mounted() {
        // 设置页改了「主页显示」要立刻生效，不能等 onShow —— 实测这个固件
        // 从设置页返回首页时不触发首页 onShow，芯片就会"点了隐藏还挂着"
        this.unsubUi = subscribeUiState((s) => {
            if (this.showBal === s.showBalance) return
            this.showBal = s.showBalance
            // 刚打开就补一次余额，别让芯片空着显示「余额」
            if (s.showBalance) this.refreshBalance(true)
        })
        this.boot()
    },
    // 页面被销毁时停掉相册轮询，避免遗留定时器
    unmounted() {
        if (this.unsubUi) { this.unsubUi(); this.unsubUi = null }
        this.stopPhotoWatch()
        this.stopPeriodTimer()
    },
    // 从系统相机/其他应用/其它页面返回时触发（不同固件可能只走其中一个通道，两个都挂）
    onShow() {
        // 必须重读配置：首次启动时 boot() 发现没 key 会直接跳 setup，
        // 用户填完 key 返回本页时 settings 还是"空 key"那个旧对象，发请求必然 401。
        // 同理，设置页改完参数返回后也要立刻生效。
        this.refreshSettings()
        // 从系统相机返回：把这段时间新增的照片自动纳入待发送列表
        this.pickupNewPhotos()
        // 回到前台时复习一次时段（可能已跨过 9:00 / 12:00 / 18:00）；余额按 5 分钟节流刷
        this.tickPeriod()
        this.refreshBalance(false)
    },
    methods: {
        async boot() {
            this.settings = await loadSettings()
            this.applyShowBalance(this.settings)
            if (!isReady(this.settings)) {
                navTo('setup', {})
                return
            }
            // 先把上次的余额和时钟偏差贴上来（断网也有东西看），再去查新的
            const cached = await loadBalance()
            if (cached) {
                this.bal = cached
                this.balFetchedAt = cached.at
                setTimeSkew(cached.skew)
            }
            // 节假日安排：先用缓存（同步生效），再后台补拉。拉不到就用内置表，
            // 这一段绝不能挡住首屏 —— 它只是顶栏那个「谷/峰」的配色依据。
            await restoreHoliday()
            this.tickPeriod()
            this.startPeriodTimer()
            await this.loadConvState()
            this.refreshBalance(false)
            this.syncHoliday(false)
        },

        // 后台更新节假日表（一年才变一次，失败静默）
        async syncHoliday(force) {
            try {
                const r = await ensureHoliday({ force: !!force })
                if (r && r.fetched && r.fetched.length) {
                    // 表换了可能改变今天的峰/谷判定，立刻重算
                    this.tickPeriod()
                    log('holiday ' + r.msg)
                }
                return r
            } catch (e) {
                return { ok: false, msg: '节假日更新失败' }
            }
        },

        // ---- 余额与峰谷时段 ----
        // 顶栏芯片开关：读配置 → 写本页 data + 广播给其它页面（设置页那份是同一份值）
        applyShowBalance(s) {
            const on = !s || s.showBalance !== false
            if (this.showBal !== on) this.showBal = on
            setUiState({ showBalance: on })
        },

        // 官方没有"当前是峰是谷"的接口（价格页脚注里只有规则），只能本地算。
        // 时段判定不读设备时区，一律按 UTC+8；真正要校正的是系统时钟本身，
        // 用余额响应头的 Date 算偏差，存进缓存，下次启动先套用。
        tickPeriod() {
            const p = billingPeriod(nowMs())
            const cur = this.period
            // 只在真正切换时写 data，避免每分钟无谓重渲染
            if (cur && cur.peak === p.peak && cur.until === p.until) return
            this.period = p
        },

        startPeriodTimer() {
            if (this.periodTimer) return
            this.periodTimer = setInterval(() => {
                this.tickPeriod()
                this.refreshBalance(false)
            }, 60000)
        },

        stopPeriodTimer() {
            if (this.periodTimer) {
                clearInterval(this.periodTimer)
                this.periodTimer = null
            }
        },

        // force=true 是点芯片手动刷新；否则 5 分钟内不重复请求
        async refreshBalance(force) {
            if (!this.settings || !isReady(this.settings)) return
            // 顶栏不显示余额时不再发请求：这块数据只给芯片用，设 1 分钟一跳的
            // 轮询在关掉后就是纯浪费流量
            if (!this.showBal) return
            if (this.balBusy) return
            const now = Date.now()
            if (force !== true && this.balFetchedAt && now - this.balFetchedAt < 5 * 60 * 1000) return
            this.balBusy = true
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
                this.balFetchedAt = Date.now()
                this.balErr = ''
                saveBalance(rec)
                this.tickPeriod()
            } catch (e) {
                // 失败不动缓存：断网/第三方地址不支持时继续显示上次的余额
                this.balErr = (e && e.message) || '余额查询失败'
                log('balance fail ' + this.balErr)
            } finally {
                this.balBusy = false
            }
        },

        async loadConvState() {
            this.convs = await loadChats()
            if (!this.convs.length) {
                const c = newConversation()
                this.convs = [c]
            }
            this.convId = this.convs[0].id
            await this.refreshPhotos()
            // 上一次的相册快照（落盘，跨页面重建/重启都还在）
            this.photoSeen = await loadPhotoSeen()
            this.scrollToBottom(true)
            log('boot ok convs=' + this.convs.length)
            // 进页面就先比对一次：相机/相册可能在应用没运行时加了照片
            await this.pickupNewPhotos()
            this.startPhotoWatch()
        },

        async refreshSettings() {
            const s = await loadSettings()
            if (!s) return
            this.settings = s
            this.applyShowBalance(s)
            if (!isReady(s)) {
                navTo('setup', {})
                return
            }
            // 刚从 setup 回来：会话状态还没加载过
            if (!this.convs.length) await this.loadConvState()
        },

        // 回到前台时把"离开期间新增的照片"并入待发送列表。
        // 早期版本靠 takePhoto() 里的 pendingCamera 标记，但页面被框架重建、
        // 或固件只走另一个 onShow 通道时标记就丢了，新照片会静默漏掉（实机踩到过）。
        // 现在改成：快照落盘 + 目录时间戳轮询，与返回时机彻底解耦。
        async pickupNewPhotos() {
            const prev = this.photoSeen
            await this.refreshPhotos()
            const now = this.photos.slice()
            const fresh = prev && prev.length ? diffNewPhotos(prev, now) : []
            this.photoSeen = now
            savePhotoSeen(now)
            if (!fresh.length) return
            let list = this.images.slice()
            for (let i = fresh.length - 1; i >= 0 && list.length < MAX_IMAGES; i--) {
                list = addPhoto(list, fresh[i], MAX_IMAGES)
            }
            const added = list.length - this.images.length
            this.images = list
            this.flash(added > 0 ? '已自动加入 ' + added + ' 张新照片' : '照片已达 ' + MAX_IMAGES + ' 张上限')
        },

        // 相册目录的 mtime 一变就说明有新文件（一次 stat 比 readdir 便宜得多）。
        // onShow 在不同固件上不一定触发，所以再挂一个低频兜底轮询。
        startPhotoWatch() {
            if (this.watchTimer) return
            const self = this
            this.destroyed = false
            const tick = async function () {
                self.watchTimer = null
                if (self.destroyed) return
                try {
                    const stamp = await photoDirStamp()
                    if (self.photoStamp === null) self.photoStamp = stamp
                    else if (stamp !== self.photoStamp) {
                        self.photoStamp = stamp
                        if (!self.busy) await self.pickupNewPhotos()
                    }
                } catch (e) { /* 忽略 */ }
                if (!self.destroyed) {
                    self.watchTimer = setTimeout(tick, 3000)
                }
            }
            this.watchTimer = setTimeout(tick, 3000)
        },

        stopPhotoWatch() {
            this.destroyed = true
            if (this.watchTimer) {
                clearTimeout(this.watchTimer)
                this.watchTimer = null
            }
        },

        async refreshPhotos() {

            const list = await listPhotos(40)
            this.photos = list
            return list
        },

        flash(msg) {
            this.status = msg
            const self = this
            setTimeout(function () { if (self.status === msg) self.status = '' }, 2600)
        },

        // ---------- 输入 ----------
        async editText() {
            if (this.busy) return
            const text = await openTextEditor(this.draft, { multiLine: true, confirmText: '完成' })
            if (text === null || text === undefined) return
            this.draft = text
        },

        // ---------- 图片 ----------
        openPicker() {
            this.view = 'picker'
            this.refreshPhotos()
        },
        closePicker() {

            this.view = 'chat'
        },
        isSelected(p) {
            for (let i = 0; i < this.images.length; i++) if (this.images[i].key === p.key) return true
            return false
        },
        togglePhoto(p) {
            if (this.isSelected(p)) {
                this.images = removePhoto(this.images, p.key)
                return
            }
            if (this.images.length >= MAX_IMAGES) {
                this.flash('最多选 ' + MAX_IMAGES + ' 张')
                return
            }
            this.images = addPhoto(this.images, p, MAX_IMAGES)
        },
        photoCellClass(p) {
            return this.isSelected(p) ? 'ix-cell ix-cell-on' : 'ix-cell'
        },
        photoNameClass(p) {
            return this.isSelected(p) ? 'ix-cellname-on' : 'ix-cellname'
        },

        // 拉起系统相机；返回时 onShow 里重扫相册并 diff
        async takePhoto() {
            // 出发前先刷新一次并记快照：回来后与这份快照比对就知道哪几张是新拍的
            await this.refreshPhotos()
            this.photoSeen = this.photos.slice()
            const appid = this.settings && this.settings.params.cameraAppid
            const r = launchCamera(appid)
            if (!r.ok) {
                this.flash('无法拉起系统相机，请长按笔身拍照键')
                return
            }
            this.flash('已打开「' + r.name + '」，拍完返回即可')
        },

        // ---------- 会话 ----------
        ensureConv() {
            if (this.conv) return this.conv
            const c = newConversation()
            this.convs = [c].concat(this.convs)
            this.convId = c.id
            return c
        },
        newChat() {

            const c = newConversation()
            this.convs = [c].concat(this.convs)
            this.convId = c.id
            this.images = []
            this.draft = ''
            this.view = 'chat'
            saveChats(this.convs)
        },
        openDrawer() {
            this.delId = ''
            this.view = 'drawer'
        },
        closeDrawer() {
            this.delId = ''
            this.view = 'chat'
        },
        switchConv(c) {
            this.convId = c.id
            this.view = 'chat'
            this.scrollToBottom(true)
        },
        removeConv(c) {
            this.delId = ''
            this.convs = this.convs.filter((x) => x.id !== c.id)
            if (!this.convs.length) this.convs = [newConversation()]
            if (this.convId === c.id) this.convId = this.convs[0].id
            saveChats(this.convs)
        },

        openSettings() {
            navTo('settings', {})
        },

        toggleThink() {

            const p = Object.assign({}, this.settings.params)
            p.thinking = p.thinking === false
            this.settings.params = p
            saveSettings(this.settings)
        },
        toggleSearch() {

            const p = Object.assign({}, this.settings.params)
            p.webSearch = !p.webSearch
            this.settings.params = p
            saveSettings(this.settings)
            this.flash(p.webSearch ? '联网搜索：开（已发 web_search_options，实测不生效）' : '联网搜索：关')
        },

        // ---------- 发送 ----------
        // 注意：必须接收「快照」而不是读 this.images。
        // send() 里为了先清空输入条，会在这之前把 this.images 置空；
        // 如果这里读 this.images，遍历的永远是空数组 → 图片一张都拼不进请求体，
        // 表现为「图片发出去但模型完全无视」（更糟时整条 user 消息被丢掉）。
        async imageUrlMap(list) {
            const map = {}
            const arr = list || this.images || []
            for (let i = 0; i < arr.length; i++) {
                const p = arr[i]
                if (this.urlCache[p.path]) { map[p.path] = this.urlCache[p.path]; continue }
                const r = await toDataUrl(p.path)
                if (r.ok) {
                    map[p.path] = r.url
                    this.urlCache[p.path] = r.url
                } else {
                    this.flash(r.error)
                }
            }
            return map
        },

        async send() {
            if (this.busy) return
            const text = String(this.draft || '').trim()
            if (!text && !this.images.length) {
                this.flash('先输入内容或选图片')
                return
            }
            const conv = this.ensureConv()
            const settings = this.settings

            const userMsg = newMessage('user', text)
            userMsg.images = this.images.slice()
            conv.messages.push(userMsg)
            conv.updatedAt = Date.now()
            ensureTitle(conv)
            this.draft = ''
            this.images = []

            const bot = newMessage('assistant', '')
            bot.pending = true
            conv.messages.push(bot)
            this.busy = true
            this.cancelled = false
            this.status = ''
            this.scrollToBottom()

            try {
                const urlMap = await this.imageUrlMap(userMsg.images).catch(() => ({}))
                const apiMsgs = buildApiMessages(conv.messages, {
                    systemPrompt: settings.systemPrompt,
                    maxMessages: settings.maxHistory * 2,
                    imageUrlOf: (path) => urlMap[path] || this.urlCache[path] || null
                })
                const built = buildBody(settings.params, apiMsgs)
                if (!built.ok) throw new Error(built.errors.join('；'))
                if (built.warnings.length) this.flash(built.warnings[0])
                log('REQ ' + describeBody(built.body))

                const opts = {
                    baseUrl: settings.baseUrl,
                    apiKey: settings.apiKey,
                    body: built.body,
                    shouldCancel: () => this.cancelled,
                    handlers: {
                        onContent: (d, full) => {
                            bot.pending = true
                            this.streamWrite(bot, 'content', full)
                        },
                        // 思考过程也要跟着滚：否则文字长到超出屏幕后，
                        // 界面定格在开头几行，看着像"卡住了"（实机踩到过）。
                        onReasoning: (d, full) => {
                            reasonOpenSet[bot.id] = true
                            this.streamWrite(bot, 'reasoning', full)
                        },
                        onUsage: (u) => { this.usage = u }
                    }
                }
                const r = built.body.stream ? await sendChat(opts) : await sendOnce(opts)
                bot.content = r.content
                bot.reasoning = r.reasoning
                bot.pending = false
                if (r.finishReason === 'length') this.flash('输出被 max_tokens 截断')
                if (r.usage) this.status = summarizeUsage(r.usage)
            } catch (e) {
                bot.pending = false
                if (e && e.code === 'CANCELLED') {
                    if (!bot.content) bot.content = '（已停止）'
                } else {
                    bot.error = (e && e.message) || '请求失败'
                    log('ERR ' + bot.error)
                }
            } finally {
                this.streamFlush(bot)
                this.busy = false
                conv.updatedAt = Date.now()
                saveChats(this.convs)
                this.scrollToBottom()
            }
        },

        stop() {
            this.cancelled = true
        },

        // 流式写入节流：每个 token 都写 data 会让整条消息重新 parse + 重新渲染，
        // 回复越长越卡（长回复时 CPU 直接打满，界面像死机）。压到 ~5 次/秒，
        // 首包立即出、尾包在 streamFlush 里补，肉眼仍是"逐字冒出"。
        streamWrite(bot, field, full) {
            const key = bot.id + ':' + field
            streamBuf[key] = full
            if (streamTimers[key]) return
            const wait = Math.max(0, 180 - (Date.now() - (streamAt[key] || 0)))
            const self = this
            streamTimers[key] = setTimeout(function () {
                streamTimers[key] = null
                streamAt[key] = Date.now()
                const v = streamBuf[key]
                if (field === 'content') bot.content = v
                else bot.reasoning = v
                self.scrollSoon()
            }, wait)
        },

        streamFlush(bot) {
            for (const field of ['content', 'reasoning']) {
                const key = bot.id + ':' + field
                if (streamTimers[key]) {
                    clearTimeout(streamTimers[key])
                    streamTimers[key] = null
                    if (field === 'content') bot.content = streamBuf[key]
                    else bot.reasoning = streamBuf[key]
                }
                delete streamBuf[key]
                delete streamTimers[key]
            }
        },

        // ---------- 渲染 ----------
        plan(m) {
            const raw = m.content || ''
            // 渲染上限：本机 1GB 内存 + QuickJS，几万字的回复一次性 parse 会卡很久。
            // 完整内容仍然落盘，这里只限制"画多少"。
            const cap = m.pending ? PENDING_RENDER_MAX : RENDER_MAX
            const src = raw.length > cap
                ? raw.slice(0, cap) + '\n\n（内容过长，仅渲染前 ' + cap + ' 字，完整内容已保存）'
                : raw
            const key = m.id + ':' + src.length + ':' + (m.pending ? 1 : 0)
            const hit = planCache[m.id]
            if (hit && hit.key === key) return hit.value
            const value = renderPlan(src, { typeset: !m.pending })
            planCache[m.id] = { key: key, value: value }
            return value
        },
        // ---------- 纸面模式 ----------
        // 原生 <latex> 只会画纯黑字形（引擎忽略 CSS color），所以"会出现原生公式的回答"
        // 整条必须是浅底。只给公式自己垫一块白条的话，解题过程里就是一条条白补丁，
        // 而且短公式会把整行涂白 —— 看着像排版事故。
        paper(m) {
            if (!m || m.role !== 'assistant') return false
            if (m.__paper) return true   // 一旦成为纸面就保持，避免流式过程中来回闪
            const src = m.content || ''
            const hit = paperCache[m.id]
            if (hit && hit.len === src.length) return hit.v
            const v = needsPaperSheet(src)
            paperCache[m.id] = { len: src.length, v: v }
            if (v) m.__paper = true
            return v
        },
        // 类名按纸面/深色二选一（不同时挂两个类：本平台多类同属性优先级不可靠）
        cls(base, m) {
            return this.paper(m) ? base + '-p' : base
        },
        msgStyle(m) {
            if (!this.paper(m)) return {}
            return {
                backgroundColor: '#f4f2ea',
                borderRadius: '8px',
                paddingLeft: '8px',
                paddingRight: '8px',
                paddingTop: '5px',
                paddingBottom: '5px'
            }
        },
        // 纸面里公式不再需要自己的底色（整条已经是纸），把卡片收成"无内边距、透明"
        mathCardStyle(m) {
            if (!this.paper(m)) return {}
            return {
                backgroundColor: 'rgba(0,0,0,0)',
                paddingLeft: '0px',
                paddingRight: '0px',
                paddingTop: '0px',
                paddingBottom: '0px'
            }
        },
        runClass(r, m) {
            const p = this.paper(m) ? '-p' : ''
            if (r.code) return 'ix-run ix-runcode'
            if (r.bold) return 'ix-run ix-runbold' + p
            if (r.italic) return 'ix-run ix-runit' + p
            if (r.strike) return 'ix-run ix-runstrike' + p
            return 'ix-run' + p
        },
        headClass(b, m) {
            const p = this.paper(m) ? '-p' : ''
            if (b.level <= 1) return 'ix-h1' + p
            if (b.level === 2) return 'ix-h2' + p
            return 'ix-h3' + p
        },
        tblRowClass(ri, m) {
            const p = this.paper(m) ? '-p' : ''
            return (ri === 0 ? 'ix-tblhrow' : 'ix-tblbrow') + p
        },
        tblCellClass(ri, m) {
            const p = this.paper(m) ? '-p' : ''
            return (ri === 0 ? 'ix-tblhcell' : 'ix-tblcell') + p
        },
        roleLabel(m) {
            if (m.role === 'user') return '我'
            return m.pending ? 'DeepSeek · 生成中' : 'DeepSeek'
        },
        roleClass(m) {
            return m.role === 'user' ? 'ix-roleuser' : 'ix-rolebot'
        },
        reasonToggle(m) {
            return this.reasonOpen(m) ? '收起' : '思考过程'
        },
        reasonOpen(m) {
            return reasonOpenSet[m.id] === true
        },
        toggleReason(m) {
            reasonOpenSet[m.id] = !this.reasonOpen(m)
            this.$forceUpdate()
        },
        convRowStyle(c) {
            // 用内联 style 而不是"两个类各写一遍 background-color"：
            // 本平台多类冲突时优先级不可靠，选中态会时有时无。
            return { backgroundColor: c.id === this.convId ? '#24303c' : '#1c1c22' }
        },
        askDelete(c) {
            // 两步删：第一下只标记，第二下才真删。右上角就是「关闭」，
            // 一步就删很容易点错（抽屉里两处都在右侧）。
            if (this.delId === c.id) {
                this.delId = ''
                this.removeConv(c)
                return
            }
            this.delId = c.id
            this.flash('再点一次「确认」删除：' + String(c.title || '').slice(0, 12))
        },
        delLabel(c) {
            return this.delId === c.id ? '确认' : '删除'
        },
        delRowClass(c) {
            return this.delId === c.id ? 'ix-convdel-on' : 'ix-convdel'
        },
        delTxtClass(c) {
            return this.delId === c.id ? 'ix-deltxt-on' : 'ix-deltxt'
        },
        fileSrc(path) {
            return 'file://' + path
        },

        scrollToBottom(force) {
            const self = this
            setTimeout(function () {
                try {
                    const el = self.$refs.bottom
                    if (el && self.$page && self.$page.$dom && self.$page.$dom.scrollToElement) {
                        self.$page.$dom.scrollToElement(el)
                    }
                } catch (e) { /* 忽略 */ }
            }, force ? 60 : 30)
        },
        scrollSoon() {
            if (this._scrollAt && Date.now() - this._scrollAt < 400) return
            this._scrollAt = Date.now()
            this.scrollToBottom()
        }
    }
}
</script>

<style>
.ix-page {
    width: 936px;
    height: 280px;
    flex-direction: column;
    background-color: #16161a;
    position: relative;
}

/* 全屏覆盖层（图片选择 / 会话抽屉）。
   必须绝对定位：本框架没有 position 时元素走正常流，会被排到 280 高之外——
   节点在渲染树里但屏幕上看不见（实机踩过）。 */
.ix-overlay {
    position: absolute;
    top: 0;
    left: 0;
    flex-direction: column;
    width: 936px;
    height: 280px;
    background-color: #101014;
}

.ix-top {
    height: 44px;
    flex-direction: row;
    align-items: center;
    padding-left: 12px;
    padding-right: 12px;
    background-color: #1e1e24;
}

.ix-title {
    font-size: 17px;
    color: #e8e8ee;
    flex: 1;
}

/* 芯片：**必须**用 div 承载 padding / 背景 / 圆角。
   实机实测：<text> 上的 padding 只参与绘制、不进入布局与命中测试，
   于是可见的那块「思考 开」「新对话」比它的热区整体偏左约 20~25px——
   点到看得见的地方没反应，要往右再戳一下才中（最右边的「历史」热区几乎顶到屏幕边）。
   套一层 div 后 padding 由 div 的盒子承担，绘制框 == 命中框。 */
.ix-chip {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    background-color: #2a2a33;
    margin-left: 8px;
}

.ix-chip-on {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    background-color: #4ade80;
    margin-left: 8px;
}

.ix-chiptxt {
    font-size: 13px;
    color: #9a9aa8;
}

.ix-chiptxt-on {
    font-size: 13px;
    color: #0d1a12;
}

/* 余额芯片：背景色跟状态走（余额异常优先，其次峰/谷）。
   每个状态都写成**独立一条**完整规则，不要拼 .ix-chip + 修饰类：
   本平台多类同属性时优先级不可靠，曾经因此把整行高度压塌过。 */
.ix-balchip {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    margin-left: 8px;
    background-color: #2a2a33;
}
.ix-balchip-ok {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    margin-left: 8px;
    background-color: #1d2b23;
}
.ix-balchip-peak {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    margin-left: 8px;
    background-color: #2f2718;
}
.ix-balchip-warn {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    margin-left: 8px;
    background-color: #33290f;
}
.ix-balchip-bad {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    margin-left: 8px;
    background-color: #3a1f1f;
}
.ix-baltxt {
    font-size: 13px;
    color: #9a9aa8;
}
.ix-baltxt-ok {
    font-size: 13px;
    color: #7fd39a;
}
.ix-baltxt-peak {
    font-size: 13px;
    color: #e8c07a;
}
.ix-baltxt-warn {
    font-size: 13px;
    color: #f0b866;
}
.ix-baltxt-bad {
    font-size: 13px;
    color: #f08a83;
}

.ix-msgs {
    height: 180px;
    padding-left: 12px;
    padding-right: 12px;
}

.ix-msg {
    flex-direction: column;
    margin-bottom: 10px;
}

.ix-msghead {
    flex-direction: row;
    align-items: center;
    margin-bottom: 2px;
}

.ix-roleuser {
    font-size: 12px;
    color: #7cc4ff;
}

.ix-rolebot {
    font-size: 12px;
    color: #8b8b9a;
}

/* 11px 的小字本身很难点，套 div 给它一个 20px 高、带内边距的热区，
   同时保证热区就是看得见的那块（<text> 的 padding 不算进命中测试）。 */
.ix-meta {
    flex-direction: row;
    align-items: center;
    height: 20px;
    padding-left: 8px;
    padding-right: 8px;
    margin-left: 4px;
}

.ix-metatxt {
    font-size: 11px;
    color: #6d6d7c;
}

.ix-reason {
    background-color: #202028;
    border-left-width: 2px;
    border-left-color: #4a4a58;
    padding: 6px;
    margin-bottom: 4px;
}

.ix-reasontext {
    font-size: 12px;
    color: #8f8f9e;
}

.ix-md {
    flex-direction: column;
}

.ix-blk {
    flex-direction: column;
}

.ix-p {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
}

.ix-run {
    font-size: 15px;
    color: #dcdce4;
}

.ix-runbold {
    font-size: 15px;
    color: #ffffff;
}

.ix-runit {
    font-size: 15px;
    color: #dcb8e6;
}

.ix-runcode {
    font-size: 14px;
    color: #ffd479;
    background-color: #26262f;
}

.ix-runstrike {
    font-size: 15px;
    color: #7a7a88;
    text-decoration: line-through;
}

.ix-math {
    margin-left: 2px;
    margin-right: 2px;
    color: #dcdce4;
}

/* 独立成行的公式：**必须给浅色底**。
   实测（截图取色）固件内置 LaTeX 引擎把字形画成纯黑 (0,0,0)，
   且完全忽略 CSS 的 color —— 父节点写 `color:#dcdce4` 也没用。
   于是深色主题下就成了"黑字压近黑底"（对比度约 1.1:1），几乎看不见，
   这正是"公式颜色与背景过于接近"的根因。
   既然改不了字色，就改底色：给公式一块浅色"纸"，黑字立刻清晰（对比度 > 12:1）。 */
/* 公式行：整行居中，**自身不画底色** —— 底色挪到卡片上，让卡片按内容收缩。
   以前底色画在这一层，短公式（E=mc²）也会把 912px 整行涂白，视觉上像一条空栏。 */
.ix-mathblock {
    flex-direction: row;
    justify-content: center;
    margin-top: 3px;
    margin-bottom: 3px;
}

/* 卡片：不写 width / flex，宽度由内容撑开 */
.ix-mathcard {
    flex-direction: column;
    align-items: center;
    padding-top: 4px;
    padding-bottom: 4px;
    padding-left: 10px;
    padding-right: 10px;
    background-color: #e9ebf3;
    border-radius: 8px;
}

/* 长公式被断成多行时，每行一个 richtext，纵向排开 */
.ix-mathcol {
    flex-direction: column;
    align-items: center;
}

/* 断不动、退回 Unicode 近似的公式也落在浅色纸上，所以这里用深色字 */
.ix-mathfallback {
    font-size: 15px;
    color: #16161d;
}

.ix-code {
    font-size: 13px;
    color: #cfd6e4;
    background-color: #1b1b21;
    padding: 8px;
    border-radius: 6px;
    margin-top: 4px;
    margin-bottom: 4px;
}

.ix-h1 {
    font-size: 19px;
    color: #ffffff;
    margin-top: 4px;
    margin-bottom: 2px;
}

.ix-h2 {
    font-size: 17px;
    color: #f0f0f6;
    margin-top: 4px;
    margin-bottom: 2px;
}

.ix-h3 {
    font-size: 15px;
    color: #e4e4ec;
    margin-top: 3px;
    margin-bottom: 2px;
}

.ix-quote {
    font-size: 14px;
    color: #a0a0b0;
    border-left-width: 2px;
    border-left-color: #3d3d4a;
    padding-left: 8px;
}

.ix-hr {
    font-size: 12px;
    color: #3a3a46;
}

.ix-lirow {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
}

.ix-limark {
    font-size: 15px;
    color: #7a7a8a;
    width: 18px;
}

.ix-lirun {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    flex: 1;
}

.ix-tbl {
    flex-direction: column;
    margin-top: 6px;
    margin-bottom: 6px;
    background-color: #1c1c22;
    border-radius: 6px;
    overflow: hidden;
}

.ix-tblhrow {
    flex-direction: row;
    background-color: #2a2a34;
    padding-top: 5px;
    padding-bottom: 5px;
}

.ix-tblbrow {
    flex-direction: row;
    padding-top: 5px;
    padding-bottom: 5px;
}

.ix-tblhcell {
    flex: 1;
    font-size: 12px;
    color: #d8d8e4;
    padding-left: 8px;
    padding-right: 8px;
}

.ix-tblcell {
    flex: 1;
    font-size: 12px;
    color: #b4b4c2;
    padding-left: 8px;
    padding-right: 8px;
}

.ix-thumbs {
    flex-direction: row;
    flex-wrap: wrap;
    margin-top: 2px;
    margin-bottom: 4px;
}

.ix-thumb {
    flex-direction: column;
    margin-right: 8px;
    margin-bottom: 4px;
}

.ix-thumbimg {
    border-radius: 4px;
}

.ix-thumbname {
    font-size: 10px;
    color: #7a7a8a;
}

.ix-err {
    font-size: 13px;
    color: #ff8f8f;
    background-color: #2a1a1c;
    padding: 6px;
    border-radius: 4px;
}

.ix-typing {
    font-size: 13px;
    color: #6d6d7c;
}

.ix-status {
    flex-direction: row;
    padding-top: 2px;
}

.ix-statustext {
    font-size: 11px;
    color: #6d6d7c;
}

.ix-anchor {
    height: 2px;
}

.ix-input {
    height: 56px;
    flex-direction: row;
    align-items: center;
    padding-left: 12px;
    padding-right: 12px;
    background-color: #1e1e24;
}

.ix-btn {
    flex-direction: row;
    align-items: center;
    height: 32px;
    background-color: #2a2a33;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    margin-right: 8px;
}

.ix-btn-on {
    flex-direction: row;
    align-items: center;
    height: 32px;
    background-color: #7cc4ff;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    margin-right: 8px;
}

.ix-btntxt {
    font-size: 13px;
    color: #b8b8c6;
}

.ix-btntxt-on {
    font-size: 13px;
    color: #0d1a12;
}

.ix-field {
    flex: 1;
    height: 36px;
    background-color: #26262f;
    border-radius: 8px;
    padding-left: 10px;
    padding-right: 10px;
    justify-content: center;
}

.ix-fieldtext {
    font-size: 14px;
    color: #e4e4ec;
    lines: 1;
}

.ix-fieldph {
    font-size: 14px;
    color: #66667a;
}

.ix-sendbtn {
    flex-direction: row;
    align-items: center;
    height: 36px;
    background-color: #4ade80;
    padding-left: 16px;
    padding-right: 16px;
    border-radius: 8px;
    margin-left: 8px;
}

.ix-stopbtn {
    flex-direction: row;
    align-items: center;
    height: 36px;
    background-color: #c0392b;
    padding-left: 16px;
    padding-right: 16px;
    border-radius: 8px;
    margin-left: 8px;
}

.ix-sendtxt {
    font-size: 14px;
    color: #0d1a12;
}

.ix-stoptxt {
    font-size: 14px;
    color: #ffffff;
}

.ix-panel {
    flex-direction: column;
    width: 936px;
    height: 280px;
    background-color: #14141a;
}

.ix-paneltop {
    height: 40px;
    flex-direction: row;
    align-items: center;
    padding-left: 12px;
    padding-right: 12px;
    background-color: #1e1e24;
}

.ix-paneltitle {
    font-size: 14px;
    color: #e4e4ec;
    flex: 1;
}

.ix-photosc {
    height: 240px;
    padding-left: 8px;
    padding-right: 8px;
}

.ix-grid {
    flex-direction: row;
    flex-wrap: wrap;
    padding-top: 8px;
}

.ix-cell {
    flex-direction: column;
    width: 132px;
    height: 92px;
    margin-right: 8px;
    margin-bottom: 8px;
    background-color: #1c1c22;
    border-radius: 6px;
    padding: 4px;
    border-width: 2px;
    border-color: #1c1c22;
}

.ix-cell-on {
    border-color: #4ade80;
}

.ix-photoimg {
    border-radius: 3px;
}

.ix-cellname {
    font-size: 10px;
    color: #7a7a8a;
    margin-top: 2px;
    lines: 1;
}

.ix-cellname-on {
    font-size: 10px;
    color: #4ade80;
    margin-top: 2px;
    lines: 1;
}

.ix-empty {
    font-size: 13px;
    color: #6d6d7c;
    padding: 20px;
}

.ix-drawer {
    flex-direction: column;
    width: 936px;
    height: 280px;
    background-color: #14141a;
}

.ix-convsc {
    height: 240px;
    padding-left: 8px;
    padding-right: 8px;
}

/* 行容器不带 background-color：选中态由内联 :style 决定，
   否则两个类都写同一条属性，优先级不可靠（见 askDelete 注释）。 */
.ix-convrow {
    flex-direction: row;
    align-items: center;
    height: 44px;
    margin-top: 4px;
    border-radius: 6px;
}

/* 标题区与删除区**并列**，互不嵌套：嵌套可点元素会让子元素吃掉点击
   却不执行处理器（实测删除按钮完全无响应）。 */
.ix-convopen {
    flex: 1;
    flex-direction: row;
    align-items: center;
    height: 44px;
    padding-left: 10px;
}

.ix-convtitle {
    font-size: 14px;
    color: #dcdce4;
    lines: 1;
}

.ix-convdel {
    width: 72px;
    height: 44px;
    flex-direction: row;
    align-items: center;
    justify-content: center;
}

.ix-convdel-on {
    width: 72px;
    height: 44px;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    background-color: #c0392b;
    border-top-right-radius: 6px;
    border-bottom-right-radius: 6px;
}

.ix-deltxt {
    font-size: 12px;
    color: #ff8f8f;
}

.ix-deltxt-on {
    font-size: 12px;
    color: #ffffff;
}

/* ---------- 纸面变体（浅底深字）----------
   这些类**自成一体**（字号/颜色/间距都写全），页面里按 paper(m) 二选一返回，
   不会和深色类同时挂在同一个节点上 —— 本平台"两个类写同一条属性"会静默取错。 */
.ix-run-p { font-size: 15px; color: #23232b; }
.ix-runbold-p { font-size: 15px; color: #101016; }
.ix-runit-p { font-size: 15px; color: #7b3f96; }
.ix-runcode-p { font-size: 14px; color: #ffd479; background-color: #2a2a33; }
.ix-runstrike-p { font-size: 15px; color: #7c7c88; text-decoration: line-through; }

.ix-h1-p { font-size: 19px; color: #0f0f14; margin-top: 4px; margin-bottom: 2px; }
.ix-h2-p { font-size: 17px; color: #12121a; margin-top: 4px; margin-bottom: 2px; }
.ix-h3-p { font-size: 15px; color: #1a1a22; margin-top: 3px; margin-bottom: 2px; }

.ix-quote-p {
    font-size: 14px;
    color: #4c4c58;
    border-left-width: 2px;
    border-left-color: #c9c6bc;
    padding-left: 8px;
}

.ix-hr-p { font-size: 12px; color: #c4c2b8; }

.ix-limark-p { font-size: 15px; color: #6f6f7c; width: 18px; }

.ix-code-p {
    font-size: 13px;
    color: #e6e2d6;
    background-color: #26262f;
    padding: 8px;
    border-radius: 6px;
    margin-top: 4px;
    margin-bottom: 4px;
}

.ix-typing-p { font-size: 13px; color: #6a6a76; }

.ix-tbl-p { flex-direction: column; margin-top: 6px; margin-bottom: 6px; background-color: #ecebe3; border-radius: 6px; }
.ix-tblhrow-p { flex-direction: row; background-color: #e0ded3; padding-top: 5px; padding-bottom: 5px; }
.ix-tblbrow-p { flex-direction: row; background-color: #ecebe3; padding-top: 5px; padding-bottom: 5px; }
.ix-tblhcell-p { flex: 1; font-size: 12px; color: #16161d; padding-left: 8px; padding-right: 8px; }
.ix-tblcell-p { flex: 1; font-size: 12px; color: #33333d; padding-left: 8px; padding-right: 8px; }

.ix-reason-p {
    background-color: #eae8de;
    border-left-width: 2px;
    border-left-color: #b9b6ac;
    padding: 6px;
    margin-bottom: 4px;
}

.ix-reasontext-p { font-size: 12px; color: #55555f; }
</style>
