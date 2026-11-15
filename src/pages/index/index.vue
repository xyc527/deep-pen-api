<template>
    <div class="ix-page">

        <!-- 顶栏：标题 + 参数状态 + 入口。高度固定，滚动区拿剩下的高度 -->
        <div class="ix-top">
            <text class="ix-title" @click="openDrawer">{{ title }}</text>
            <!-- 人设切换**只在设置页**给（人设与角色 → 切换人设）。
                 主界面不摆这个入口：陪伴模式下换人设是低频动作，顶栏留给
                 模型 / 余额 / 思考 / 联网这些真正随手要动的开关。 -->
            <div class="ix-chip" @click="openSettings"><text class="ix-chiptxt">{{ modelShort }}</text></div>
            <!-- 余额 + 当前计费时段：点一下立刻查一次余额（后台每 5 分钟自动刷）。
                 可在设置页「账户 → 主页显示」关掉，关掉后连轮询一起停 -->
            <div v-if="showBal" :class="balChipClass" @click="refreshBalance(true)"><text :class="balTxtClass">{{ balLabel }}</text></div>
            <div :class="thinkChipClass" @click="toggleThink"><text :class="thinkTxtClass">{{ thinkLabel }}</text></div>
            <div :class="searchChipClass" @click="toggleSearch"><text :class="searchTxtClass">{{ searchLabel }}</text></div>
            <!-- 会话切换只在聊天模式给：扮演模式下聊天记录跟着人设走，一条线到底，
                 再摆「新对话 / 历史」不仅多余，还容易在换档案后误开一条空白对话 -->
            <div v-if="!isRole" class="ix-chip" @click="newChat"><text class="ix-chiptxt">新对话</text></div>
            <div v-if="!isRole" class="ix-chip" @click="openDrawer"><text class="ix-chiptxt">历史</text></div>
        </div>

        <!-- 消息区：scroller 不能套 v-if（被 v-if 包裹会渲染空白） -->
        <scroller class="ix-msgs" scroll-direction="vertical">
            <div v-for="(m, mi) in messages" :key="m.id" class="ix-msg" :style="msgStyle(m)">
                <div class="ix-msghead">
                    <text :class="roleClass(m)">{{ roleLabel(m) }}</text>
                    <!-- 没有思考内容就不给这个开关：以前只判 assistant，导致
                         开场白（以及关掉思考后的回答）都顶着一个点开是空的「思考过程」 -->
                    <div v-if="m.role === 'assistant' && !m.pending && m.reasoning" class="ix-meta" @click="toggleReason(m)"><text class="ix-metatxt">{{ reasonToggle(m) }}</text></div>
                </div>


                <!-- 查高德地图中的状态：跟联网检索一样要提示，不然这几秒屏幕上没动静 -->
                <div v-if="m.mapping" class="ix-searching">
                    <text class="ix-searchingtxt">正在查高德地图…</text>
                </div>

                <!-- 查到了什么：一行标签，点开看真实数据。摆出来是为了让用户能核实
                     「模型说的天气到底是不是高德给的」，而不是信它一张嘴 -->
                <div v-if="m.mapChip" class="ix-srcs" @click="toggleMap(m)">
                    <text class="ix-maptxt">{{ m.mapChip }}{{ mapOpen(m) ? ' ▲' : ' ▼' }}</text>
                </div>
                <div v-if="m.mapChip && mapOpen(m)" class="ix-srclist">
                    <text v-for="(ln, li) in mapLines(m)" :key="li" class="ix-srcitem">{{ ln }}</text>
                </div>

                <!-- 联网检索中的状态。搜索是同步请求，1–3 秒才有结果，
                     不给提示的话屏幕上毫无变化，看着像卡死 -->
                <div v-if="m.searching" class="ix-searching">
                    <text class="ix-searchingtxt">正在联网检索…</text>
                </div>

                <!-- 来源：默认只占一行，点开看标题。不显示 URL —— 笔上点不了链接，
                     列出来只会占地方 -->
                <div v-if="m.sources && m.sources.length" class="ix-srcs" @click="toggleSources(m)">
                    <text class="ix-srctxt">{{ sourcesLabel(m) }}</text>
                </div>
                <div v-if="m.sources && m.sources.length && srcOpen(m)" class="ix-srclist">
                    <text v-for="(s, si) in m.sources" :key="si" class="ix-srcitem">{{ srcLine(s, si) }}</text>
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

                <!-- 出错的消息只有这行红字（没有正文节点）；不挂点击就永远选不中，
                     也就没法重抽那条失败的请求（实测踩到） -->
                <text v-if="m.error" class="ix-err" @click="selectMsg(m)">{{ m.error }}</text>

                <!-- Markdown + LaTeX。run 必须同级平铺：<text> 带元素子节点会让框架 abort -->
                <!-- 点正文 = 选中该句。只挂在这一层：头部（思考过程）和来源自己
                     有点击行为，挂到外层会被子元素吃掉命中（本平台老问题） -->
                <div v-else class="ix-md" @click="selectMsg(m)">
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

        <!-- 选中操作条：浮在对话区底部，不跟着消息滚（做成内联的话长回答滚到底部就点不到了）。
             必须放在输入条**之后**：本平台里 position:absolute 的元素按兄弟顺序叠，
             写在输入条前面时触摸会落到下层的消息正文上 —— 点了没反应（实测）。 -->
        <div v-if="selId" class="ix-actbar">
            <text class="ix-acthint">{{ selHint }}</text>
            <!-- 按钮按角色给：自己的提问只能改、不能重抽（重抽的是回答），
                 回答只能重抽、不能改（要改就自己另说一句），两种模式都一样。
                 开场白除外：它前面没有提问，重抽一定失败，干脆不给按钮 -->
            <div v-if="selIsAnswer && selMsg && !selMsg.greet" class="ix-act" @click="regenSel"><text class="ix-acttxt">重新生成</text></div>
            <div v-if="selIsUser" class="ix-act" @click="editSel"><text class="ix-acttxt">修改内容</text></div>
            <div class="ix-act-c" @click="clearSel"><text class="ix-acttxt">取消</text></div>
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

        <!-- 清空确认：只有选中的那句**后面还有内容**才出现（最后一句直接执行）。
             用自绘层而不是 toast/alert：本平台没有可用的确认框组件，闪一下就没了，
             用户根本来不及看清会删掉多少东西。 -->
        <div v-if="ask" class="ix-overlay-dim">
            <div class="ix-confirm">
                <text class="ix-confirmtitle">{{ askTitle }}</text>
                <text class="ix-confirmtext">{{ askText }}</text>
                <div class="ix-confirmrow">
                    <div class="ix-act" @click="cancelAsk"><text class="ix-acttxt">取消</text></div>
                    <div class="ix-act-go" @click="confirmAsk"><text class="ix-acttxt-go">确定清空</text></div>
                </div>
            </div>
        </div>
        <!-- 人设切换层已经搬到设置页（人设与角色 → 切换人设）：
             主界面留一个能一键换掉整套档案的入口，误触代价太大 -->
    </div>
</template>

<script>
import { loadSettings, saveSettings, getLastSaveInfo, loadChats, saveChats, loadPhotoSeen, savePhotoSeen, loadBalance, saveBalance, loadMemoryState, saveMemory } from '../../services/store.js'
import { sendChat, sendOnce, fetchBalance, searchWeb } from '../../services/api.js'
import { restoreHoliday, ensureHoliday } from '../../services/holiday.js'
import { openTextEditor } from '../../services/ime.js'
import { listPhotos, toDataUrl, launchCamera, photoDirStamp } from '../../services/media.js'
import { navTo, log } from '../../services/platform.js'
import { isReady } from '../../lib/settings.js'
import { buildBody, describeBody } from '../../lib/params.js'
import { renderPlan, needsPaperSheet } from '../../lib/md.js'
import { shortModelLabel } from '../../lib/params.js'
import { buildApiMessages, newConversation, newMessage, ensureTitle, summarizeUsage, planRegenerate, planEdit } from '../../lib/chat.js'
import { addPhoto, removePhoto, diffNewPhotos, formatSize } from '../../lib/photos.js'
import { billingPeriod, setTimeSkew, nowMs } from '../../lib/peak.js'
import { balanceChipText, balanceLevel } from '../../lib/balance.js'
import { setUiState, subscribeUiState, getUiState } from '../../lib/uistate.js'
import { normalizeSearchMode, shouldSearch, buildSearchQuery, formatSearchContext, searchSources, injectSearchContext, sourceLine } from '../../lib/search.js'
import { personaSystemPrompt, greetingOf } from '../../lib/persona.js'
import { planCompression, foldMessages, memoryText, notesAfter } from '../../lib/memory.js'
import { parseMapIntent, formatMapContext, mapChipLabel } from '../../lib/mapintent.js'
import { ensureAmap, runMapIntent, amapAutoOn } from '../../services/amap.js'

const MAX_IMAGES = 4

// 渲染计划缓存放在模块作用域（不要放进 data：写 data 会在渲染期触发重渲染）
const planCache = {}
const reasonOpenSet = {}
// 联网来源的展开状态（同样放模块作用域）
const srcOpenSet = {}
// 地图查询结果的展开状态
const mapOpenSet = {}
// 展开状态一律按消息 id 记账；调用方传消息对象或 id 都能拿到同一个 key。
// （模板里 v-if 曾写成 srcOpen(m.id)，而方法取的是 m.id → undefined，恒为 false：
//   标签能变 ▲，列表却永远不出现。）
function openKey(m) {
    if (m && typeof m === 'object') return String(m.id)
    return String(m)
}
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
            // 手上这份 settings 对应哪一次广播（见 lib/uistate.js 的 settingsRev）
            settingsRev: 0,
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
            // 选中要操作的消息（点消息正文选中，再出「重新生成 / 修改内容」）
            selId: '',
            // 待确认的操作 { kind, id, text }：只有该句后面还有内容时才弹
            ask: null,
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
            periodTimer: null,
            // 压缩记忆（按档案分，切人设就换一段）
            memNotes: [],
            // 清空记忆的时间水位：更早的消息不再折进来
            memFloor: 0,
            // 已经收到的"对话记录变更"版本号（导入存档后要重读）
            chatsRev: 0,
            // 已经收到的"记忆变更"版本号（设置页清空记忆后要重读）
            memRev: 0
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
        selMsg() {
            const i = this.idxOf(this.selId)
            return i < 0 ? null : this.messages[i]
        },
        // 选中的是回答 → 只给「重新生成」；选中的是我的提问 → 只给「修改内容」
        selIsAnswer() {
            const m = this.selMsg
            return !!m && m.role === 'assistant'
        },
        selIsUser() {
            const m = this.selMsg
            return !!m && m.role === 'user'
        },
        selHint() {
            // 注意：selMsg 是 computed（属性），不能写成 this.selMsg()
            const m = this.selMsg
            if (!m) return ''
            if (m.greet) return '已选：开场白'
            return m.role === 'user' ? '已选：我的提问' : '已选：这条回答'
        },
        askTitle() {
            if (!this.ask) return ''
            return this.ask.kind === 'edit' ? '修改内容' : '重新生成'
        },
        askText() {
            const a = this.ask
            if (!a) return ''
            const n = Number(a.tail) || 0
            const what = a.kind === 'edit' ? '修改' : '重新生成'
            return '这句之后还有 ' + n + ' 条内容，' + what + '会把它们一起清空，且无法恢复。'
        },
        title() {
            const c = this.conv
            if (!c) return 'DeepSeek'
            // 扮演模式没有「新对话」入口了，空会话再顶着「新对话」三个字，
            // 看着像还能新建一条 —— 换成「与「人设」对话」，说清这是谁的线
            if (this.isRole && c.title === '新对话') {
                return '与「' + this.personaName + '」对话'
            }
            return c.title
        },
        // 扮演模式才有的概念（聊天模式没有人设）
        isRole() {
            return !!(this.settings && this.settings.mode === 'role')
        },
        personaName() {
            const n = this.settings && this.settings.personaName
            return n || '人设'
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
        searchMode() {
            return normalizeSearchMode(this.settings && this.settings.params.searchMode)
        },
        // 来源展开后的显示方式：设置里选「全部」→ 完整标题（可折行）
        srcFull() {
            return !!(this.settings && this.settings.sourceStyle === 'full')
        },
        searchTxtClass() {
            return this.searchMode === 'off' ? 'ix-chiptxt' : 'ix-chiptxt-on'
        },
        // 三档一眼可辨：关（灰）/ 自动（亮）/ 常开（亮）
        searchLabel() {
            const m = this.searchMode
            if (m === 'always') return '联网 常开'
            if (m === 'auto') return '联网 自动'
            return '联网 关'
        },
        searchChipClass() {
            if (this.searchMode === 'off') return 'ix-chip'
            if (this.searchMode === 'always') return 'ix-chip-on-strong'
            return 'ix-chip-on'
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
        // 设置页改完立刻生效，不能等 onShow —— 实测这个固件从设置页返回首页时
        // 不触发首页 onShow。以前只同步了「主页显示」一个开关，API Key / 服务地址 /
        // 模型 / 采样参数全都同步不过来：用户把 Key 改错，返回后照样能聊，
        // 因为发请求用的是这份旧 settings。
        this.unsubUi = subscribeUiState((s) => {
            if (s.settings && s.settingsRev > this.settingsRev) {
                this.settingsRev = s.settingsRev
                // **必须复制成自己的一份**：广播过来的是设置页那个组件的对象，
                // 直接拿来用会出现「改了芯片只写盘、界面不刷新」——本平台对
                // 跨页面实例的深层改写派发不稳定（实测）。拷一层普通对象后，
                // this.settings 的引用变化始终由本页自己控制。
                const prevKey = this.profileTag()
                this.settings = Object.assign({}, s.settings, {
                    params: Object.assign({}, s.settings.params),
                    memory: Object.assign({}, s.settings.memory)
                })
                this.applyShowBalance(this.settings)
                // 切了模式 / 人设：设置、会话记录、余额、记忆全是另一套，
                // 不重读的话屏幕上还是上一个人的对话（发出去就串了）
                if (prevKey !== this.profileTag()) this.switchProfileLocal()
                return
            }
            // 导入存档：对话记录被整包换掉了，设置没变也必须重读一遍
            if (s.chatsRev > this.chatsRev) {
                this.chatsRev = s.chatsRev
                this.reloadConvs()
                return
            }
            // 设置页清空了记忆：本页手上的 memNotes 已经作废，不清掉的话
            // 下一次发消息会把旧记忆折回去（用户会说"清空没用"）
            if (s.memoryRev > this.memRev) {
                this.memRev = s.memoryRev
                this.reloadMemoryLocal()
                return
            }
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
            this.settingsRev = getUiState().settingsRev
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
            // 压缩记忆按档案存，进页面先读一次（后面发请求要带上）
            const ms = await loadMemoryState()
            this.memNotes = ms.notes
            this.memFloor = ms.floor
            await this.loadConvState()
            this.refreshBalance(false)
            this.syncHoliday(false)
        },

        // 只重读对话列表（导入存档后用）。不重置当前对话 —— 除非它已经不在了
        async reloadConvs() {
            const list = await loadChats()
            if (!list.length) { this.flash('这个档案还没有对话'); return }
            this.convs = list
            let hit = false
            for (let i = 0; i < list.length; i++) if (list[i].id === this.convId) hit = true
            if (!hit) this.convId = list[0].id
            this.selId = ''
            this.ask = null
            this.scrollToBottom(true)
            this.flash('已载入 ' + list.length + ' 个对话')
        },

        // 重读压缩记忆（设置页清空 / 重写之后）。
        // 为什么不自己判断有没有变：清空是别的页面干的，本页只知道"版本号跳了"。
        async reloadMemoryLocal() {
            const ms = await loadMemoryState()
            this.memNotes = ms.notes
            this.memFloor = ms.floor
        },

        // 当前档案指纹：'chat' 或 'role:<id>'。换人就整页换数据。
        profileTag() {
            const s = this.settings
            if (!s) return ''
            return (s.mode || 'chat') + ':' + (s.personaId || '')
        },
        // 扮演模式下"谁在回答"
        botName() {
            const s = this.settings
            if (s && s.mode === 'role' && s.personaName) return s.personaName
            return 'DeepSeek'
        },

        // 切模式 / 切人设之后：会话、记忆、余额全换一套。
        // 这些数据在磁盘上是按档案分文件的（chats_role_x.json 之类），所以只要重读。
        async switchProfileLocal() {
            this.selId = ''
            this.ask = null
            this.status = ''
            // 换档案一律回到对话界面：切到扮演模式后历史抽屉不再有入口，
            // 若页面还停在抽屉上就退不出来了
            this.view = 'chat'
            const ms = await loadMemoryState()
            this.memNotes = ms.notes
            this.memFloor = ms.floor
            this.bal = null
            this.balErr = ''
            this.balFetchedAt = 0
            const cached = await loadBalance()
            if (cached) {
                this.bal = cached
                this.balFetchedAt = cached.at
                setTimeSkew(cached.skew)
            }
            this.convs = []
            this.convId = ''
            await this.loadConvState()
            this.refreshBalance(true)
            this.flash('已切换到' + (this.settings && this.settings.mode === 'role'
                ? ('人设「' + this.settings.personaName + '」')
                : '聊天模式'))
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

        // 扮演模式的开场白：档案里还一条消息都没有时，让角色先开口。
        // 只补"空对话"，绝不往已有记录里插 —— 换了人设再切回来也不会重复。
        // 开场白是真实消息（会存盘、能选中、能重建标题），但发请求时由
        // buildApiMessages 把它改写成 system 说明，避免 assistant 打头被模型拒。
        seedGreeting() {
            const s = this.settings
            if (!s || s.mode !== 'role') return
            const conv = this.conv
            if (!conv) return
            const text = greetingOf(s.personaCard)
            if (!text) return
            if (!conv.messages) conv.messages = []
            if (conv.messages.length) return
            const m = newMessage('assistant', text)
            m.greet = true
            conv.messages.push(m)
            saveChats(this.convs)
            log('greet seeded len=' + text.length)
        },

        async loadConvState() {
            this.convs = await loadChats()
            if (!this.convs.length) {
                const c = newConversation()
                this.convs = [c]
            }
            this.convId = this.convs[0].id
            this.seedGreeting()
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
            // 磁盘那份比手上这份旧就跳过：写盘有延迟时（本机很常见），
            // 用磁盘旧值覆盖内存新值 = 刚关掉的开关又自己弹回去。
            const cur = this.settings
            if (cur && cur.updatedAt && s.updatedAt && s.updatedAt < cur.updatedAt) {
                this.settingsRev = getUiState().settingsRev
                return
            }
            const prevKey = this.profileTag()
            this.settings = Object.assign({}, s, {
                params: Object.assign({}, s.params),
                memory: Object.assign({}, s.memory)
            })
            this.settingsRev = getUiState().settingsRev
            this.applyShowBalance(s)
            if (!isReady(s)) {
                navTo('setup', {})
                return
            }
            // 刚从 setup 回来：会话状态还没加载过
            if (!this.convs.length) { await this.loadConvState(); return }
            // 模式 / 人设换过（onShow 这条路径也要跟上，不能只靠广播）
            if (prevKey && prevKey !== this.profileTag()) await this.switchProfileLocal()
            // 同一档案从设置页返回：刚填了开场白、而对话还是空的，也补上
            else this.seedGreeting()
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
            // 扮演模式没有「新对话」入口（顶栏芯片已藏），这里再兜一层，
            // 免得从别处误调到把当前人设的记录切走
            if (this.isRole) return
            const c = newConversation()
            this.convs = [c].concat(this.convs)
            this.convId = c.id
            this.images = []
            this.draft = ''
            this.view = 'chat'
            this.selId = ''
            this.ask = null
            saveChats(this.convs)
        },
        openDrawer() {
            // 扮演模式不提供会话切换：入口芯片已藏掉，标题这一处点击也要一起关，
            // 否则顶栏左边点一下仍会弹出历史列表
            if (this.isRole) return
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
            this.selId = ''
            this.ask = null
            this.scrollToBottom(true)
        },
        removeConv(c) {
            this.delId = ''
            this.convs = this.convs.filter((x) => x.id !== c.id)
            if (!this.convs.length) this.convs = [newConversation()]
            if (this.convId === c.id) this.convId = this.convs[0].id
            saveChats(this.convs)
        },

        // ---------- 人设切换 ----------
        // 入口只在设置页（人设与角色 → 切换人设）。这里保留 switchProfileLocal()：
        // 设置页切完会广播 settings，本页收到 profileTag 变化就走整套档案重载。
        openSettings() {
            navTo('settings', {})
        },

        // 首页这两处开关改了要落盘，但写失败时以前是**静默丢掉的**：
        // 用户点了「思考 关」，界面变了，重启又回来，日志里什么都没有。
        saveSettingsQuiet(tag) {
            const saved = saveSettings(this.settings)
            if (saved) return true
            const info = getLastSaveInfo()
            log('index 保存失败 tag=' + tag + ' :: ' + info.reason + ' @ ' + info.path)
            this.flash('设置没存上：' + (info.reason || '未知原因'))
            return false
        },
        toggleThink() {
            // **整体换 settings 对象**，不要写成 this.settings.params = p。
            // 就地改深层字段时，本平台不一定重算依赖它的 computed：
            // 表现就是从设置页回来后点「思考」没有反应，得先点一下「联网」
            // （那个方法换了整份 settings）芯片才刷新 —— 用户反馈的正是这个。
            const p = Object.assign({}, this.settings.params)
            p.thinking = p.thinking === false
            this.settings = Object.assign({}, this.settings, { params: p })
            log('think ' + (p.thinking === false ? 'off' : 'on'))
            this.saveSettingsQuiet('think')
        },
        // 三档循环：关 → 自动 → 常开 → 关。
        // 「自动」靠本地规则判断（lib/search.js），零额外请求、零延迟；
        // 「常开」每问必检索，一次 0.005 元，所以文案里把价钱说清楚。
        toggleSearch() {
            const cur = this.searchMode
            const next = cur === 'off' ? 'auto' : (cur === 'auto' ? 'always' : 'off')
            const p = Object.assign({}, this.settings.params, { searchMode: next })
            this.settings = Object.assign({}, this.settings, { params: p })
            this.saveSettingsQuiet('search')
            if (next === 'off') this.flash('联网搜索：关')
            else if (next === 'auto') this.flash('联网搜索：自动（仅在需要时检索）')
            else this.flash('联网搜索：常开（每问必检索，约 0.005 元/次）')
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

        // 发请求前确认手上这份设置是最新的。
        // 设置页每次落盘都会 publishSettings（rev+1），这里 rev 不一致就重读一遍磁盘 ——
        // 万一订阅回调因为页面重建/时序没跑到，也不会用旧 Key 发请求。
        async ensureFreshSettings() {
            const rev = getUiState().settingsRev
            // 只有「广播的比手上这份新」才重读磁盘。以前用 !=，导致本页刚改完
            // 而 rev 还没对齐时，一发请求就把内存里的新值换成磁盘旧值（写盘慢半拍
            // 时就是「刚关掉思考，下一条回答还在思考」）。
            if (rev > this.settingsRev) {
                const s = await loadSettings()
                if (s) {
                    this.settings = Object.assign({}, s, { params: Object.assign({}, s.params) })
                    this.settingsRev = rev
                    this.applyShowBalance(s)
                }
            }
            return this.settings
        },

        async send() {
            if (this.busy) return
            const text = String(this.draft || '').trim()
            if (!text && !this.images.length) {
                this.flash('先输入内容或选图片')
                return
            }
            const conv = this.ensureConv()
            const settings = await this.ensureFreshSettings()
            // 设置页把 Key 清掉/改废了也要给出明确提示，而不是拿旧 Key 继续发
            if (!settings || !isReady(settings)) {
                this.flash('还没填有效的 API Key，去「设置 → 连接」填一下')
                return
            }

            const userMsg = newMessage('user', text)
            userMsg.images = this.images.slice()
            conv.messages.push(userMsg)
            conv.updatedAt = Date.now()
            ensureTitle(conv)
            this.draft = ''
            this.images = []
            this.selId = ''
            await this.runChat(conv, userMsg)
        },

        // 真正发一轮请求：把「提问之前」的那三步（校验 Key、建占位消息、置忙）
        // 和「提问之后」的流式处理收在一起，重抽 / 修改内容直接复用它。
        // userMsg 必须传进来：send 里已经清空了输入框和图片，不能再读 this.images。
        async runChat(conv, userMsg) {
            if (!conv || !userMsg) return
            // 提问原文：send 里已经清空了 this.draft，重抽/改写的调用点也没有草稿，
            // 所以一切都以传进来的这条消息为准。
            const text = String(userMsg.content || '')
            const settings = await this.ensureFreshSettings()
            if (!settings || !isReady(settings)) {
                this.flash('还没填有效的 API Key，去「设置 → 连接」填一下')
                return
            }
            const bot = newMessage('assistant', '')
            bot.pending = true
            conv.messages.push(bot)
            this.busy = true
            // 告诉设置页「首页正在收回答」：那边切人设会换掉整套档案，
            // 这一轮的流式分片还在往旧对话里写
            setUiState({ chatBusy: true })
            this.cancelled = false
            this.status = ''
            this.scrollToBottom()

            try {
                const urlMap = await this.imageUrlMap(userMsg.images).catch(() => ({}))
                // 系统提示词：扮演模式是"角色卡 + 补充要求"拼出来的，聊天模式就是那一条
                const sysPrompt = settings.mode === 'role'
                    ? personaSystemPrompt(settings.personaCard, settings.systemPrompt)
                    : settings.systemPrompt

                // 上下文压缩：窗口外的消息不是"丢掉"，而是先折成摘要记忆，
                // 再作为一条 system 带上（记忆关掉时退回老行为：直接截断）
                const memOn = !!(settings.memory && settings.memory.on)
                const maxMsgs = settings.maxHistory * 2
                const plan = planCompression(conv.messages, maxMsgs, memOn)
                let memText = memoryText(this.memNotes)
                if (memOn && plan.drop.length) {
                    // 清空记忆时有 floor：比它更早的消息不再折回来，只攒清空之后的新对话
                    const fresh = notesAfter(plan.drop, this.memFloor)
                    const folded = foldMessages(this.memNotes, fresh, { lines: settings.memory.lines })
                    if (folded.added > 0 || folded.dropped > 0) {
                        this.memNotes = folded.notes
                        saveMemory(folded.notes, this.memFloor)
                        memText = memoryText(folded.notes)
                        log('MEM fold +' + folded.added + ' total=' + folded.notes.length)
                    }
                }

                const apiMsgs = buildApiMessages(conv.messages, {
                    systemPrompt: sysPrompt,
                    memoryText: memOn ? memText : '',
                    maxMessages: maxMsgs,
                    imageUrlOf: (path) => urlMap[path] || this.urlCache[path] || null
                })

                // ---- 高德地图：本地认意图 → 查 → 注入 ----
                // 跟联网搜索同一套路子，但有两条硬约束：
                //   1) 扮演模式一律不查（地图是聊天侧的能力，不该在角色对话里插一句"北京晴13度"）
                //   2) 命中地图就不再联网搜索——两边都跑首包要等十几秒，屏幕上什么都不动
                let mapCtx = ''
                let mapUsed = false
                if (settings.mode !== 'role') {
                    try {
                        if (await ensureAmap()) {
                            const mi = parseMapIntent(text)
                            // 设置里关掉「自动识别」后，只有明确说「使用高德地图」才查 ——
                            // 关键词触发会消耗配额，必须留一个能彻底闭嘴的开关
                            if (mi.kind !== 'none' && (mi.forced || amapAutoOn())) {
                                bot.mapping = true
                                this.status = '正在查高德地图…'
                                try {
                                    const mr = await runMapIntent(mi)
                                    if (mr.ok) {
                                        mapCtx = formatMapContext(mr.kind, mr.data)
                                        bot.mapChip = mapChipLabel(mr.kind, mr.data)
                                        bot.mapDetail = formatMapContext(mr.kind, mr.data, { brief: true })
                                        mapUsed = !!mapCtx
                                        log('MAP ' + mi.kind + ' ' + mi.query)
                                    } else {
                                        log('MAP ERR ' + mi.kind + ' ' + mr.error)
                                        this.flash('地图查询没成功：' + mr.error)
                                    }
                                } finally {
                                    bot.mapping = false
                                    this.status = ''
                                }
                            }
                        }
                    } catch (e) {
                        // 地图整条链路任何异常都不能连累对话，降级成"不查"
                        bot.mapping = false
                        this.status = ''
                        log('MAP THROW ' + ((e && e.message) || e))
                    }
                }

                // ---- 联网搜索：先检索，再把资料注入上下文 ----
                // 官方 /v1/tools/search 是纯检索接口，不会自己判断该不该搜，
                // 所以「自动」档靠 lib/search.js 的本地规则判断（零请求、零延迟）。
                const searchMode = normalizeSearchMode(settings.params.searchMode)
                let searchCtx = ''
                if (!mapUsed && shouldSearch(text, searchMode)) {
                    const q = buildSearchQuery(text)
                    bot.searching = true
                    try {
                        const sr = await searchWeb({
                            baseUrl: settings.baseUrl,
                            apiKey: settings.apiKey,
                            query: q,
                            oriQuestion: q,
                            count: settings.params.searchCount,
                            shouldCancel: () => this.cancelled
                        })
                        searchCtx = formatSearchContext(sr.results, { max: settings.params.searchCount })
                        if (searchCtx) bot.sources = searchSources(sr.results, 4)
                        log('SEARCH ' + q + ' -> ' + sr.results.length + '条')
                    } catch (e) {
                        // 搜索失败绝不能连累回答：降级成"不搜直接答"，只提示一句
                        if (e && e.code === 'CANCELLED') throw e
                        log('SEARCH ERR ' + ((e && e.message) || e))
                        this.flash('联网搜索失败，已直接回答：' + ((e && e.message) || '未知错误'))
                    } finally {
                        bot.searching = false
                    }
                }

                // 地图数据和搜索资料都是"这一轮才有的外部事实"，插在最后一条 user 之前。
                // 两者互斥（命中地图就不搜），所以取其一即可
                const built = buildBody(settings.params, injectSearchContext(apiMsgs, mapCtx || searchCtx))
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
                setUiState({ chatBusy: false })
                conv.updatedAt = Date.now()
                saveChats(this.convs)
                this.scrollToBottom()
            }
        },

        stop() {
            this.cancelled = true
        },

        // ---------- 单句操作：重新生成 / 修改内容 ----------
        // 选中 = 点消息正文。头部「思考过程」、来源标签各自有点击行为，
        // 所以把 @click 只挂在正文那层，避免子元素把命中吃掉（本平台老问题）。
        idxOf(id) {
            const list = this.messages
            for (let i = 0; i < list.length; i++) if (list[i].id === id) return i
            return -1
        },

        selectMsg(m) {
            if (this.busy || !m || m.pending) return
            this.selId = this.selId === m.id ? '' : m.id
        },
        clearSel() { this.selId = '' },
        regenSel() { const m = this.selMsg; if (m) this.askRegen(m) },
        editSel() { const m = this.selMsg; if (m) this.askEdit(m) },
        cancelAsk() { this.ask = null },
        askRegen(m) {
            // 只有回答能重抽：提问本身是用户写的那一句，重抽没有意义
            if (!m || m.role !== 'assistant') return
            if (this.busy) { this.flash('正在生成，先点「停止」'); return }
            const plan = planRegenerate(this.messages, m.id)
            if (!plan) { this.flash('这条消息前面没有提问，无法重抽'); return }
            if (plan.tail > 0) { this.ask = { kind: 'regen', id: m.id, tail: plan.tail }; return }
            this.doRegen(m.id)
        },
        askEdit(m) {
            // 只有自己的提问能改：回答是模型生成的，改内容等于伪造记录
            if (!m || m.role !== 'user') return
            if (this.busy) { this.flash('正在生成，先点「停止」'); return }
            const plan = planEdit(this.messages, m.id)
            if (!plan) return
            const self = this
            openTextEditor(String(m.content || ''), { multiLine: true, confirmText: '完成' }).then(function (v) {
                // null = 用户取消，绝不能当成"清空内容"
                if (v === null || v === undefined) return
                if (plan.tail > 0) { self.ask = { kind: 'edit', id: m.id, text: v, tail: plan.tail }; return }
                self.doEdit(m.id, v)
            })
        },
        confirmAsk() {
            const a = this.ask
            if (!a) return
            this.ask = null
            if (a.kind === 'edit') this.doEdit(a.id, a.text)
            else this.doRegen(a.id)
        },
        // 重新生成：
        //   assistant → 删掉它和它之后的一切，用前面最近的一条用户提问重跑
        //   user      → 保留它，删掉它之后的一切（那条回答），用它重跑
        async doRegen(id) {
            const conv = this.conv
            if (!conv) return
            const plan = planRegenerate(conv.messages, id)
            if (!plan) { this.flash('这条消息前面没有提问，无法重抽'); return }
            const prompt = conv.messages[this.idxOf(plan.promptId)]
            if (!prompt) { this.flash('找不到可用的提问'); return }
            conv.messages.splice(plan.keep)
            conv.updatedAt = Date.now()
            this.selId = ''
            log('REGEN idx=' + plan.index + ' role=' + plan.role + ' left=' + conv.messages.length)
            saveChats(this.convs)
            await this.runChat(conv, prompt)
        },
        // 修改内容：
        //   assistant → 只改这段回答的文字（不重跑，适合修错字/补一句）
        //   user      → 改提问原文，然后清掉后面的回答重跑
        async doEdit(id, text) {
            const conv = this.conv
            if (!conv) return
            const plan = planEdit(conv.messages, id)
            if (!plan) return
            const m = conv.messages[plan.index]
            if (!m) return
            m.content = String(text == null ? '' : text)
            m.error = ''
            // 渲染计划按 (id, 长度, pending) 缓存，同长度改写会命中旧结果 → 必须清
            delete planCache[m.id]
            this.selId = ''
            conv.messages.splice(plan.keep)
            conv.updatedAt = Date.now()
            ensureTitle(conv)
            saveChats(this.convs)
            log('EDIT ' + m.role + ' idx=' + plan.index + ' len=' + m.content.length + ' rerun=' + (plan.rerun ? 1 : 0))
            if (plan.rerun) { await this.runChat(conv, m); return }
            this.flash('已修改')
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
            if (this.paper(m)) return {
                backgroundColor: '#f4f2ea',
                borderRadius: '8px',
                paddingLeft: '8px',
                paddingRight: '8px',
                paddingTop: '5px',
                paddingBottom: '5px'
            }
            // 选中态：只给整条消息垫一层浅色底，不改类名（多类叠加优先级不可靠）
            if (this.selId === m.id) {
                return {
                    backgroundColor: '#20262f',
                    borderRadius: '8px',
                    paddingLeft: '8px',
                    paddingRight: '8px',
                    paddingTop: '4px',
                    paddingBottom: '4px'
                }
            }
            return {}
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
            // 扮演模式下回答者的名字就是人设名，不然聊天记录里两个人全叫 DeepSeek
            const who = this.botName()
            return m.pending ? who + ' · 生成中' : who
        },
        roleClass(m) {
            return m.role === 'user' ? 'ix-roleuser' : 'ix-rolebot'
        },
        reasonToggle(m) {
            return this.reasonOpen(m) ? '收起' : '思考过程'
        },
        reasonOpen(m) {
            return reasonOpenSet[openKey(m)] === true
        },
        toggleReason(m) {
            reasonOpenSet[openKey(m)] = !this.reasonOpen(m)
            this.$forceUpdate()
        },
        // 联网来源：默认收起，展开看标题。和「思考过程」同一套开关方式
        srcOpen(m) {
            return srcOpenSet[openKey(m)] === true
        },
        sourcesLabel(m) {
            const n = (m.sources || []).length
            return '已联网 · ' + n + ' 条来源' + (this.srcOpen(m) ? ' ▲' : ' ▼')
        },
        // 一条来源一行：默认标题截成一行 + 域名；设置里选「全部」就显示完整标题（自动折行）。
        // 拼装逻辑在 lib/search.js，有单测。
        srcLine(s, si) {
            return sourceLine(s, si, this.srcFull)
        },
        toggleSources(m) {
            srcOpenSet[openKey(m)] = !this.srcOpen(m)
            this.$forceUpdate()
        },
        // 地图结果：同一套"默认收起、点开看数据"的交互
        mapOpen(m) {
            return mapOpenSet[openKey(m)] === true
        },
        toggleMap(m) {
            mapOpenSet[openKey(m)] = !this.mapOpen(m)
            this.$forceUpdate()
        },
        // 展开后按行渲染。整段塞进一个 <text> 的话换行靠框架自动折，
        // 数据行里有缩进（POI 的地址行），自己按 \n 切开更整齐
        mapLines(m) {
            const t = String(m.mapDetail || '')
            if (!t) return []
            return t.split('\n').filter((x) => x !== '')
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

/* 单句操作条：固定在输入条上方（top 202 / 高 28），滚动不影响命中。
   高度 24px 的按钮（笔上低于 22px 命中率明显变差），按钮间隔 8px。 */
.ix-actbar {
    position: absolute;
    left: 12px;
    /* 输入条 56px 高、贴底 → 它的上沿在 224px。操作条 28px 高，放到 192 就整条落在
       对话区里，不会压住输入条上沿（压住的那 6px 是点不到的） */
    top: 192px;
    flex-direction: row;
    align-items: center;
    height: 28px;
    padding-left: 8px;
    padding-right: 8px;
    border-radius: 8px;
    background-color: #1b1f27;
}

.ix-acthint {
    font-size: 11px;
    color: #8b91a0;
    margin-right: 10px;
}

.ix-act {
    flex-direction: row;
    align-items: center;
    height: 24px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 5px;
    background-color: #2f3540;
    margin-right: 8px;
}

.ix-act-c {
    flex-direction: row;
    align-items: center;
    height: 24px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 5px;
    background-color: #24262c;
    margin-right: 8px;
}

.ix-acttxt {
    font-size: 12px;
    color: #dfe3ea;
}

.ix-act-go {
    flex-direction: row;
    align-items: center;
    height: 24px;
    padding-left: 12px;
    padding-right: 12px;
    border-radius: 5px;
    background-color: #c9483c;
    margin-right: 8px;
}

.ix-acttxt-go {
    font-size: 12px;
    color: #fff4f2;
}

/* 清空确认：半透明遮罩（还能看见要删的是哪一段）+ 居中面板 */
.ix-overlay-dim {
    position: absolute;
    top: 0;
    left: 0;
    flex-direction: column;
    width: 936px;
    height: 280px;
    background-color: rgba(0, 0, 0, 0.55);
}

/* 清空确认框：居中一块面板 */
.ix-confirm {
    position: absolute;
    left: 268px;
    top: 92px;
    width: 400px;
    flex-direction: column;
    padding: 14px;
    border-radius: 10px;
    background-color: #23262d;
}

.ix-confirmtitle {
    font-size: 14px;
    color: #f0f2f6;
    margin-bottom: 6px;
}

.ix-confirmtext {
    font-size: 12px;
    color: #a9aeb8;
    margin-bottom: 12px;
}

.ix-confirmrow {
    flex-direction: row;
    align-items: center;
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

/* 「常开」用琥珀色：它每问都会花钱，视觉上要和「自动」的绿区分开 */
.ix-chip-on-strong {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    background-color: #f59e0b;
    margin-left: 8px;
}

.ix-searching {
    flex-direction: row;
    align-items: center;
    margin-top: 4px;
}
.ix-searchingtxt {
    font-size: 12px;
    color: #7dd3fc;
}
.ix-srcs {
    flex-direction: row;
    align-items: center;
    margin-top: 4px;
}
.ix-maptxt {
    font-size: 11px;
    color: #86efac;
}
.ix-srctxt {
    font-size: 11px;
    color: #7dd3fc;
}
.ix-srclist {
    flex-direction: column;
    margin-top: 2px;
    padding-left: 4px;
}
.ix-srcitem {
    font-size: 11px;
    color: #8a8a99;
    margin-top: 2px;
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
