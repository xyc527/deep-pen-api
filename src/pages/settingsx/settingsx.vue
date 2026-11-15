<template>
    <div class="sy-page">
        <div class="sy-top">
            <div class="sy-back" @click="back"><text class="sy-backtxt">返回</text></div>
            <text class="sy-title">{{ sec.title }}</text>
            <text :class="topHintClass">{{ topHint }}</text>
            <div class="sy-mode" @click="toggleSaveMode">
                <text class="sy-modetxt">保存：{{ isAutoSave ? '自动' : '手动' }}</text>
            </div>
            <div v-if="!isAutoSave" :class="saveBtnClass" @click="saveNow">
                <text :class="saveBtnTxtClass">{{ saveBtnLabel }}</text>
            </div>
        </div>

        <scroller class="sy-sc" scroll-direction="vertical">

            <!-- ============ 连接 ============ -->
            <div v-if="has('conn')" class="sy-group">
                <text class="sy-gtitle">连接</text>
                <div class="sy-row" @click="editKey">
                    <text class="sy-label">API Key</text>
                    <text :class="keyClass">{{ keyText }}</text>
                    <text class="sy-hint">点击修改</text>
                </div>
                <div class="sy-row" @click="editBase">
                    <text class="sy-label">服务地址</text>
                    <text class="sy-value">{{ baseUrl }}</text>
                    <text class="sy-hint">点击修改</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">连通性</text>
                    <div class="sy-btn2" @click="test"><text class="sy-btn2txt">测试</text></div>
                    <div class="sy-btn2" @click="scan"><text class="sy-btn2txt">{{ scanning ? '…' : '扫描模型' }}</text></div>
                    <text :class="connStatusClass">{{ connStatus || '点左侧按钮验证 Key 是否可用' }}</text>
                </div>
                <text v-if="isRole" class="sy-note">扮演模式的 Key / 地址是这一份人设专用的，与聊天模式互不影响</text>
            </div>

            <!-- ============ 账户 ============ -->
            <div v-if="has('acct')" class="sy-group">
                <text class="sy-gtitle">账户</text>
                <div class="sy-row">
                    <text class="sy-label">余额</text>
                    <text :class="balValueClass">{{ balanceText }}</text>
                    <div class="sy-btn2" @click="refreshBalance"><text class="sy-btn2txt">{{ balBusy ? '…' : '刷新' }}</text></div>
                    <text :class="balDocClass">{{ balDoc }}</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">计费时段</text>
                    <text :class="periodClass">{{ periodText }}</text>
                    <text class="sy-doc">{{ periodDoc }}</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">节假日</text>
                    <text :class="holClass">{{ holText }}</text>
                    <div class="sy-btn2" @click="refreshHoliday(false)"><text class="sy-btn2txt">{{ holBusy ? '…' : '更新' }}</text></div>
                    <text class="sy-doc">{{ holDoc }}</text>
                </div>
            </div>

            <!-- ============ 界面显示 ============ -->
            <div v-if="has('view')" class="sy-group">
                <text class="sy-gtitle">界面显示</text>
                <div class="sy-row" @click="toggleShowBalance">
                    <text class="sy-label">主页余额</text>
                    <div class="sy-ctl">
                        <div :class="showBalOn ? 'sy-opt-on' : 'sy-opt'"><text :class="showBalOn ? 'sy-opttxt-on' : 'sy-opttxt'">显示</text></div>
                        <div :class="showBalOn ? 'sy-opt' : 'sy-opt-on'"><text :class="showBalOn ? 'sy-opttxt' : 'sy-opttxt-on'">隐藏</text></div>
                    </div>
                    <text class="sy-doc">{{ showBalDoc }}</text>
                </div>
                <div class="sy-row" @click="toggleSourceStyle">
                    <text class="sy-label">来源展开</text>
                    <div class="sy-ctl">
                        <div :class="!srcFullOn ? 'sy-opt-on' : 'sy-opt'"><text :class="!srcFullOn ? 'sy-opttxt-on' : 'sy-opttxt'">单行</text></div>
                        <div :class="srcFullOn ? 'sy-opt-on' : 'sy-opt'"><text :class="srcFullOn ? 'sy-opttxt-on' : 'sy-opttxt'">全部</text></div>
                    </div>
                    <text class="sy-doc">{{ srcStyleDoc }}</text>
                </div>
            </div>

            <!-- ============ 参数（按 GROUP_ORDER 分组） ============ -->
            <template v-if="has('param')">
                <div v-for="(g, gi) in groups" :key="gi" class="sy-group">
                    <text class="sy-gtitle">{{ g.title }}</text>
                    <div v-for="(it, ii) in g.items" :key="ii" class="sy-row">
                        <text class="sy-label">{{ it.label }}</text>
                        <div v-if="it.kind === 'bool'" class="sy-ctl">
                            <div :class="boolClass(it.key, true)" @click="setParam(it.key, true)"><text :class="boolTxtClass(it.key, true)">开</text></div>
                            <div :class="boolClass(it.key, false)" @click="setParam(it.key, false)"><text :class="boolTxtClass(it.key, false)">关</text></div>
                        </div>
                        <div v-else-if="it.kind === 'enum'" class="sy-ctl sy-ctl-wrap">
                            <div v-for="(o, oi) in it.options" :key="oi" :class="enumClass(it.key, o.value)" @click="setParam(it.key, o.value)"><text :class="enumTxtClass(it.key, o.value)">{{ o.label }}</text></div>
                        </div>
                        <div v-else-if="it.kind === 'number'" class="sy-ctl">
                            <div class="sy-step" @click="stepParam(it, -1)"><text class="sy-steptxt">-</text></div>
                            <text class="sy-num">{{ numText(it) }}</text>
                            <div class="sy-step" @click="stepParam(it, 1)"><text class="sy-steptxt">+</text></div>
                        </div>
                        <div v-else class="sy-ctl" @click="editParam(it)">
                            <text :class="textClass(it)">{{ textValue(it) }}</text>
                        </div>
                        <text :class="it.active ? 'sy-doc' : 'sy-doc-off'">{{ it.active ? it.doc : it.reason }}</text>
                    </div>
                </div>
                <div class="sy-group">
                    <text class="sy-gtitle">请求预览</text>
                    <div class="sy-preview"><text class="sy-previewtext">{{ preview }}</text></div>
                </div>
            </template>

            <!-- ============ 提示词 ============ -->
            <div v-if="has('prompt')" class="sy-group">
                <text class="sy-gtitle">{{ isRole ? '人设补充要求' : '系统提示词' }}</text>
                <div class="sy-row" @click="editSystem">
                    <text class="sy-label">{{ isRole ? '补充' : 'System' }}</text>
                    <div class="sy-ctl">
                        <text :class="sysClass">{{ sysText }}</text>
                    </div>
                    <text class="sy-doc">{{ isRole ? '会接在人设卡后面一起作为 system 发送；留空则只用角色卡' : '作为 system 消息置顶发送；留空则不发送' }}</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">历史轮数</text>
                    <div class="sy-ctl">
                        <div class="sy-step" @click="stepHistory(-1)"><text class="sy-steptxt">-</text></div>
                        <text class="sy-num">{{ settings ? settings.maxHistory : 0 }}</text>
                        <div class="sy-step" @click="stepHistory(1)"><text class="sy-steptxt">+</text></div>
                    </div>
                    <text class="sy-doc">最多携带最近 N 轮问答原文（越少越省 token）</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">拍照应用</text>
                    <div class="sy-ctl" @click="cycleCamera">
                        <text class="sy-text">{{ cameraLabel }}</text>
                    </div>
                    <text class="sy-doc">点「拍照」时拉起哪个系统应用</text>
                </div>
            </div>

            <!-- ============ 记忆 ============ -->
            <div v-if="has('memory')" class="sy-group">
                <text class="sy-gtitle">上下文压缩与记忆</text>
                <div class="sy-row" @click="toggleMemory">
                    <text class="sy-label">记忆</text>
                    <div class="sy-ctl">
                        <div :class="memOn ? 'sy-opt-on' : 'sy-opt'"><text :class="memOn ? 'sy-opttxt-on' : 'sy-opttxt'">开</text></div>
                        <div :class="memOn ? 'sy-opt' : 'sy-opt-on'"><text :class="memOn ? 'sy-opttxt' : 'sy-opttxt-on'">关</text></div>
                    </div>
                    <text class="sy-doc">{{ memOn ? '超出历史窗口的对话会压成摘要接着带上，不会整段丢掉' : '超出窗口的对话直接丢弃（老行为）' }}</text>
                </div>
                <div v-if="memOn" class="sy-row">
                    <text class="sy-label">记忆条数</text>
                    <div class="sy-ctl">
                        <div class="sy-step" @click="stepMemory(-1)"><text class="sy-steptxt">-</text></div>
                        <text class="sy-num">{{ memLines }}</text>
                        <div class="sy-step" @click="stepMemory(1)"><text class="sy-steptxt">+</text></div>
                    </div>
                    <text class="sy-doc">最多保留多少条摘要（越少越省 token，超出丢最旧的）</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">当前记忆</text>
                    <text class="sy-value">{{ memStatText }}</text>
                    <div class="sy-btn2" @click="askClearMemory"><text class="sy-btn2txt">清空</text></div>
                </div>
                <div class="sy-preview"><text class="sy-previewtext">{{ memPreview || '（还没有记忆。聊得久了会自动攒出来）' }}</text></div>
                <text v-if="memMsg" class="sy-note2">{{ memMsg }}</text>
            </div>

            <!-- ============ 人设 ============ -->
            <div v-if="has('persona')" class="sy-group">
                <text class="sy-gtitle">当前人设 · {{ personaName }}</text>
                <!-- 切人设的入口只放这里。主界面原来有个芯片能一键换整套档案，
                     陪伴模式下这是低频动作，误触代价却很大（设置、记录、余额、记忆全换） -->
                <div class="sy-row sy-row-auto">
                    <text class="sy-label">切换人设</text>
                    <div class="sy-chips">
                        <div v-for="p in personaOptions" :key="p.id" :class="personaChipClass(p.id)" @click="pickPersona(p.id)">
                            <text :class="personaChipTxtClass(p.id)">{{ p.name }}</text>
                        </div>
                    </div>
                </div>
                <text v-if="personaOptions.length > 1" class="sy-doc-line">点谁就切到谁：设置、记录、余额、记忆整套换，首页的对话也跟着换</text>
                <text v-else class="sy-doc-line">现在只有这一份人设；新建或导入之后可以在这里切换</text>
                <text v-if="switchMsg" class="sy-note2">{{ switchMsg }}</text>
                <div class="sy-row" @click="editPersonaName">
                    <text class="sy-label">名字</text>
                    <div class="sy-ctl"><text class="sy-text">{{ personaName }}</text></div>
                    <text class="sy-doc">点一下改名；切换人设后用哪个名字显示</text>
                </div>
                <div v-for="(r, ri) in cardRows" :key="ri" class="sy-row" @click="editCardField(r.key)">
                    <text class="sy-label">{{ r.label }}</text>
                    <text :class="cardValue(r.key) ? 'sy-value' : 'sy-ph'">{{ cardText(r.key) }}</text>
                    <text class="sy-hint">点击编辑</text>
                </div>
                <text v-if="personaCustomText" class="sy-doc-line">自定义字段（已并入提示词，不在上面逐项编辑）：{{ personaCustomText }}</text>
                <div class="sy-row">
                    <text class="sy-label">操作</text>
                    <div class="sy-btn2" @click="openImportPicker"><text class="sy-btn2txt">导入人设文件</text></div>
                    <div class="sy-btn2" @click="newPersona"><text class="sy-btn2txt">新建人设</text></div>
                    <div class="sy-btn2" @click="askRemovePersona"><text class="sy-btn2txt sy-btn2bad">删除</text></div>
                    <text class="sy-doc">{{ personaDoc }}</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">文件</text>
                    <div class="sy-btn2" @click="doExportPersona"><text class="sy-btn2txt">导出人设</text></div>
                    <div class="sy-btn2" @click="doExportSample"><text class="sy-btn2txt">导出示例</text></div>
                    <text :class="personaFileMsg ? 'sy-doc-off' : 'sy-doc'">{{ personaFileMsg || personaFileDoc }}</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">与谁一致</text>
                    <div class="sy-btn2" @click="askClone('chat')"><text class="sy-btn2txt">复制聊天模式</text></div>
                    <text class="sy-doc">把聊天模式的 Key / 模型 / 参数整包复制过来（是复制，之后各改各的）</text>
                </div>
                <!-- 复制来源要能自己选：只给一个「复制其它人设」时，永远只会复制到列表里第一个人，
                     而且复制成功也没有任何提示，看起来就像没反应 -->
                <div class="sy-row sy-row-auto">
                    <text class="sy-label">复制自人设</text>
                    <div class="sy-chips">
                        <div v-for="p in otherPersonas" :key="p.id" class="sy-btn2 sy-chip" @click="askCloneFrom(p)">
                            <text class="sy-btn2txt">{{ p.name }}</text>
                        </div>
                        <text v-if="!otherPersonas.length" class="sy-doc">只有这一份人设，没有可复制的对象</text>
                    </div>
                </div>
                <text v-if="otherPersonas.length" class="sy-doc-line">点谁的名字，就把谁的 Key / 模型 / 参数整包复制过来（覆盖当前人设，之后再各改各的）</text>
                <text v-if="cloneMsg" class="sy-note2">{{ cloneMsg }}</text>
                <div class="sy-preview"><text class="sy-previewtext">{{ personaPromptPreview }}</text></div>
                <div class="sy-pathbox">
                    <text class="sy-pathtitle">导入 / 导出路径</text>
                    <text class="sy-pathtext">导入：把 .json 角色卡或 .txt 提示词放进 {{ importPath }}，再点上面「导入人设文件」</text>
                    <text class="sy-pathtext">导出：人设和示例都存到 {{ personaPath }}，连电脑打开 Favorite 就能看到</text>
                </div>
            </div>

            <!-- ============ 地图与天气 ============ -->
            <div v-if="has('tool')" class="sy-group">
                <text class="sy-gtitle">高德地图</text>
                <div class="sy-row" @click="editAmapKey">
                    <text class="sy-label">Key</text>
                    <text :class="amapKeyClass">{{ amapKeyText }}</text>
                    <text class="sy-hint">点击修改</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">聊天中使用</text>
                    <div class="sy-btn2" @click="toggleAmapAuto"><text class="sy-btn2txt">{{ amapAuto ? '自动识别 开' : '自动识别 关' }}</text></div>
                    <text class="sy-hint">关了只有说「使用高德地图」才查</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">连通性</text>
                    <div class="sy-btn2" @click="testAmap"><text class="sy-btn2txt">{{ amapBusy ? '…' : '测试' }}</text></div>
                    <div class="sy-btn2" @click="probeWeather"><text class="sy-btn2txt">{{ probeBusy ? '…' : '查天气' }}</text></div>
                    <text :class="amapStatusClass">{{ amapMsg || '填好 Key 后点「测试」验一下' }}</text>
                </div>
                <div v-if="probeText" class="sy-row">
                    <text class="sy-label">结果</text>
                    <text class="sy-value">{{ probeText }}</text>
                </div>
                <text class="sy-note">必须是「Web服务」类型的 Key（不是 Web端 JS API）。个人开发者有每日免费额度，用完次日 0 点恢复，不用充钱</text>
                <text class="sy-note">申请：lbs.amap.com → 控制台 → 应用管理 → 创建应用 → 添加 Key，服务平台选「Web服务」</text>
            </div>

            <!-- ============ 数据与备份 ============ -->
            <div v-if="has('data')" class="sy-group">
                <text class="sy-gtitle">导出</text>
                <div class="sy-row">
                    <text class="sy-label">存两个文件</text>
                    <div class="sy-btn2" @click="doExport"><text class="sy-btn2txt">{{ archBusy ? '…' : '导出到 userdisk' }}</text></div>
                    <text class="sy-doc">settings.json + records.json 放进 {{ exportPath }}/&lt;档案&gt;/</text>
                </div>
                <text v-if="archMsg" class="sy-note2">{{ archMsg }}</text>

                <text class="sy-gtitle" style="margin-top: 8px;">导入存档</text>
                <div v-if="!exports.length" class="sy-row">
                    <text class="sy-label">没有存档</text>
                    <text class="sy-doc">点上面「导出到 userdisk」，或把存档目录拷进来</text>
                </div>
                <div v-for="(e, ei) in exports" :key="'x' + ei" class="sy-row" @click="askImportArchive(e)">
                    <text class="sy-value">{{ e.name }}</text>
                    <text class="sy-doc">{{ e.sessions }} 个对话 · {{ f2(e.at) }}</text>
                    <text class="sy-hint">{{ e.hasSettings && e.hasRecords ? '点此导入' : '缺文件' }}</text>
                </div>

                <text class="sy-gtitle" style="margin-top: 8px;">导入人设文件</text>
                <div class="sy-row">
                    <text class="sy-label">目录</text>
                    <text class="sy-value">{{ importPath }}</text>
                    <div class="sy-btn2" @click="refreshArchives"><text class="sy-btn2txt">{{ archBusy ? '…' : '刷新' }}</text></div>
                </div>
                <div v-if="!imports.length" class="sy-row">
                    <text class="sy-label">没有文件</text>
                    <text class="sy-doc">把 .json 角色卡或 .txt 提示词放进去，再点「刷新」</text>
                </div>
                <div v-for="(f, fi) in imports" :key="'i' + fi" class="sy-row" @click="askImportPersonaFile(f)">
                    <text class="sy-value">{{ f.name }}</text>
                    <text class="sy-doc">点击导入为新的人设</text>
                </div>
            </div>

            <!-- ============ 诊断 ============ -->
            <div v-if="has('diag')" class="sy-group">
                <text class="sy-gtitle">诊断</text>
                <div class="sy-row">
                    <text class="sy-label">写入自检</text>
                    <div class="sy-btn2" @click="runSelfTest"><text class="sy-btn2txt">{{ diagBusy ? '…' : '运行' }}</text></div>
                    <text class="sy-doc">建目录 → 写测试文件 → 读回比对</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">版本</text>
                    <div class="sy-ctl"><text class="sy-text">{{ appVer }}</text></div>
                    <text class="sy-doc">数据目录 {{ dataDir }}</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">写入通道</text>
                    <div class="sy-ctl"><text class="sy-text">{{ writeChan }}</text></div>
                    <text class="sy-doc">fs / shell，自动挑可用的</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">宿主存储</text>
                    <div class="sy-ctl"><text class="sy-text">{{ storeChan }}</text></div>
                    <text class="sy-doc">jsapi.storage；设置与会话也镜像一份</text>
                </div>
                <div class="sy-row">
                    <text class="sy-label">日志</text>
                    <div class="sy-btn2" @click="refreshDiag"><text class="sy-btn2txt">刷新</text></div>
                    <text class="sy-doc">最近 10 行</text>
                </div>
                <div class="sy-preview"><text class="sy-logtext">{{ diagMsg }}</text></div>
                <div class="sy-preview"><text class="sy-logtext">{{ logTailText }}</text></div>
            </div>
        </scroller>

        <!-- 选择层：先把 import 目录里的文件列出来，让用户自己点哪一个。
             以前是「扫到什么就自动导入什么」（只有一个文件时直接弹确认），
             放错文件时用户没有选择权，也看不到目录里到底有什么 -->
        <div v-if="pickOpen" class="sy-overlay">
            <div class="sy-pick">
                <text class="sy-confirmtitle">选择要导入的文件</text>
                <text class="sy-pickdir">{{ importPath }}</text>
                <div v-for="(f, pi) in pickShown" :key="'p' + pi" class="sy-pickrow" @click="pickFile(f)">
                    <text class="sy-pickname">{{ f.name }}</text>
                    <text class="sy-pickgo">导入</text>
                </div>
                <text v-if="!pickFiles.length" class="sy-pickempty">这个目录里还没有文件。把 .json 角色卡或 .txt 提示词拷进来，再点「刷新」</text>
                <text v-else-if="pickFiles.length > pickShown.length" class="sy-pickempty">还有 {{ pickFiles.length - pickShown.length }} 个没显示，去「数据与备份」页看全部</text>
                <div class="sy-confirmrow" style="margin-top: 8px;">
                    <div class="sy-btn-c" @click="closePick"><text class="sy-btnctxt">取消</text></div>
                    <div class="sy-btn2" @click="reloadPick"><text class="sy-btn2txt">{{ pickBusy ? '…' : '刷新' }}</text></div>
                </div>
            </div>
        </div>

        <!-- 确认层：删除 / 导入 / 清空这类会丢数据的操作都要问一次 -->
        <div v-if="ask" class="sy-overlay">
            <div class="sy-confirm">
                <text class="sy-confirmtitle">{{ ask.title }}</text>
                <text class="sy-confirmtext">{{ ask.text }}</text>
                <div class="sy-confirmrow">
                    <div class="sy-btn-c" @click="cancelAsk"><text class="sy-btnctxt">取消</text></div>
                    <div class="sy-btn-go" @click="confirmAsk"><text class="sy-btngotxt">{{ ask.ok || '确定' }}</text></div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import {
    loadSettings, getLastSaveInfo, loadBalance, saveBalance, loadChats, saveChats,
    loadMemory, saveMemory, clearMemory, selfTestWrite, savePersonaCard, renamePersona,
    addPersona, removePersona, switchPersona, cloneProfileInto, readOtherProfile, getProfileKey
} from '../../services/store.js'
import { openTextEditor } from '../../services/ime.js'
import { navTo, deviceInfo, log, logTail, appDir, writeBackend } from '../../services/platform.js'
import { storageKind, storageSelfTest } from '../../services/storage.js'
import { APP_VERSION } from '../../lib/appversion.js'
import { listModels, testConnection, fetchBalance } from '../../services/api.js'
import { PARAMS, PARAM_MAP, defaultParams, clampNumber, buildBody, describeBody, modelOptions } from '../../lib/params.js'
import { maskKey, normalizeBaseUrl, isReady, settingsSignature } from '../../lib/settings.js'
import { describePeriod, setTimeSkew, nowMs, formatRemain, holidayTableYears } from '../../lib/peak.js'
import { restoreHoliday, ensureHoliday, holidaySummary } from '../../services/holiday.js'
import { balanceDetailText, balanceLevel, balanceSplitText, updatedAgo } from '../../lib/balance.js'
import { CAMERA_APPS } from '../../services/media.js'
import { sectionById, hasGroup } from '../../lib/sections.js'
import { getSection, publishChats, publishMemory, getUiState } from '../../lib/uistate.js'
import { MAX_PERSONAS, connectionOnly } from '../../lib/profile.js'
import { personaSystemPrompt, parsePersonaFile, cardIsEmpty, CARD_ROWS, normalizeCard } from '../../lib/persona.js'
import { memoryText, memorySummary } from '../../lib/memory.js'
import { stampText, EXPORT_DIR, IMPORT_DIR, PERSONA_DIR } from '../../lib/archive.js'
import { exportProfile, listExports, readExport, listImportFiles, readImportFile, ensureArchiveDirs, exportPersonaCard, exportPersonaSample } from '../../services/archive.js'
import { amapKey, setAmapKey, testAmapKey, weather, setAmapAuto, amapAutoOn } from '../../services/amap.js'
import { weatherLine } from '../../lib/amap.js'
import { baseData, baseComputed, baseMethods } from '../settings/core.js'

const GROUP_TITLES = {
    core: '模型与思考',
    web: '联网搜索',
    sampling: '采样与长度',
    output: '输出与结构',
    experimental: '实验特性'
}

const GROUP_ORDER = ['core', 'web', 'sampling', 'output', 'experimental']

export default {
    name: 'settingsx',
    data() {
        return Object.assign(baseData(), {
            sec: { id: 'conn', title: '设置', groups: [] },
            connStatus: '',
            connOk: false,
            scanning: false,
            bal: null,
            balBusy: false,
            balMsg: '',
            period: null,
            nowTick: Date.now(),
            tickTimer: null,
            holBusy: false,
            holMsg: '',
            holInfo: null,
            appVer: APP_VERSION,
            dataDir: '',
            storeChan: '',
            diagBusy: false,
            diagMsg: '',
            logTailText: '',
            // 记忆
            notes: [],
            memPreview: '',
            memStat: { count: 0, chars: 0 },
            memMsg: '',
            // 存档
            exports: [],
            imports: [],
            archBusy: false,
            archMsg: '',
            personaFileMsg: '',
            cloneMsg: '',
            // 切人设的回执（写 archMsg 的话只有数据页能看到，和复制人设同一个坑）
            switchMsg: '',
            switchBusy: false,
            // 地图与天气：Key 不在 settings 里（设备级配置，切人设不丢），单独从 store 读
            amapKey: '',
            amapMsg: '',
            amapOk: false,
            amapBusy: false,
            amapAuto: true,
            probeBusy: false,
            probeText: '',
            // 选择层（导入人设时列出目录里的文件）
            pickOpen: false,
            pickFiles: [],
            pickBusy: false,
            // 确认层
            ask: null,
            // 角色卡字段：名字单独用上面那一行（改名会同步卡内名字），这里不再重复
            cardRows: CARD_ROWS.filter((r) => r.key !== 'name')
        })
    },
    computed: Object.assign({}, baseComputed, {
        isRole() {
            return !!(this.settings && this.settings.mode === 'role')
        },
        topHint() {
            if (this.saveMsg) return this.saveMsg
            if (!this.isAutoSave && this.dirty) return '有改动未保存'
            if (!this.settings) return '读取中…'
            return this.isRole ? ('扮演 · ' + (this.settings.personaName || '人设')) : '聊天模式'
        },
        topHintClass() {
            if (this.saveMsg && this.saveMsg.indexOf('失败') >= 0) return 'sy-sub-bad'
            if (this.leaveWarn || (!this.isAutoSave && this.dirty)) return 'sy-sub-warn'
            return 'sy-sub'
        },
        writeChan() {
            return writeBackend() || '无可用接口'
        },
        // ---------- 连接 ----------
        keyText() {
            const k = this.settings ? this.settings.apiKey : ''
            return k ? maskKey(k) : '（未填写，点击输入）'
        },
        keyClass() {
            const k = this.settings ? this.settings.apiKey : ''
            return k ? 'sy-value' : 'sy-ph'
        },
        baseUrl() {
            return this.settings ? this.settings.baseUrl : ''
        },
        connStatusClass() {
            return this.connOk ? 'sy-ok' : 'sy-hint'
        },
        // ---------- 地图与天气 ----------
        amapKeyText() {
            if (!this.amapKey) return '（未填写，点击输入）'
            const s = String(this.amapKey)
            return s.length <= 8 ? s.slice(0, 2) + '****' : s.slice(0, 4) + '****' + s.slice(-4)
        },
        amapKeyClass() {
            return this.amapKey ? 'sy-value' : 'sy-ph'
        },
        amapStatusClass() {
            return this.amapOk ? 'sy-ok' : 'sy-hint'
        },
        // ---------- 账户 ----------
        balanceText() {
            return balanceDetailText(this.bal)
        },
        balValueClass() {
            if (!this.bal || !this.bal.at) return 'sy-ph'
            const lv = balanceLevel(this.bal.total, this.bal.available)
            if (lv === 'empty' || lv === 'critical') return 'sy-badnum'
            if (lv === 'low') return 'sy-warnnum'
            return 'sy-oknum'
        },
        balDoc() {
            if (this.balMsg) return this.balMsg
            if (!this.bal || !this.bal.at) return '点「刷新」查询 GET /user/balance'
            return balanceSplitText(this.bal) + ' · ' + updatedAgo(this.bal.at, this.nowTick)
        },
        balDocClass() {
            return this.balMsg ? 'sy-doc-off' : 'sy-doc'
        },
        showBalOn() {
            return !this.settings || this.settings.showBalance !== false
        },
        showBalDoc() {
            return this.showBalOn
                ? '点这一行切换；顶栏显示余额与峰谷，后台每 5 分钟查一次'
                : '点这一行切换；顶栏不显示，也停止自动查余额'
        },
        srcFullOn() {
            return !!(this.settings && this.settings.sourceStyle === 'full')
        },
        srcStyleDoc() {
            return this.srcFullOn
                ? '点这一行切换；完整标题，长标题会折行'
                : '点这一行切换；标题截成一行，条目不挡正文'
        },
        periodText() {
            const p = this.period
            if (!p) return '计算中'
            if (!p.remainMs) return p.label + ' · 近期无峰时'
            return p.label + ' · ' + (p.peak ? '转谷 ' : '转峰 ') + formatRemain(p.remainMs)
        },
        periodClass() {
            return this.period && this.period.peak ? 'sy-warnnum' : 'sy-oknum'
        },
        periodDoc() {
            const p = this.period
            if (!p) return ''
            return p.reasonText
        },
        holText() {
            const i = this.holInfo
            if (!i) return '读取中'
            if (i.source === 'builtin') return '内置表'
            return i.years.length ? i.years.join('/') + ' 年' : '内置表'
        },
        holClass() {
            const i = this.holInfo
            if (!i || i.source === 'builtin') return 'sy-hint'
            return 'sy-ok'
        },
        holDoc() {
            if (this.holMsg) return this.holMsg
            const i = this.holInfo
            if (!i) return ''
            if (i.source === 'builtin') {
                return '还没从网络取过；内置 ' + holidayTableYears().join('/') + ' 年'
            }
            return i.text
        },
        // ---------- 参数 ----------
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
                    let options = def.options
                    let doc = def.doc
                    if (def.key === 'model') {
                        options = this.modelOpts
                        const ms = (this.settings && this.settings.models) ? this.settings.models : []
                        doc = ms.length
                            ? '扫描结果 ' + ms.length + ' 个：' + ms.map((m) => m.id).join('、')
                            : '还没扫描过，当前用内置清单'
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
        preview() {
            if (!this.settings) return ''
            try {
                const built = buildBody(this.settings.params, [{ role: 'user', content: 'hi' }])
                return describeBody(built.body)
            } catch (e) {
                return String(e)
            }
        },
        // ---------- 提示词 ----------
        sysText() {
            const s = this.settings ? this.settings.systemPrompt : ''
            return s ? (s.length > 46 ? s.slice(0, 46) + '…' : s) : '（空，点击编辑）'
        },
        sysClass() {
            const s = this.settings ? this.settings.systemPrompt : ''
            return s ? 'sy-inl' : 'sy-inl-ph'
        },
        cameraLabel() {
            const id = this.settings && this.settings.params.cameraAppid
            for (let i = 0; i < CAMERA_APPS.length; i++) if (CAMERA_APPS[i].appid === id) return CAMERA_APPS[i].name
            return CAMERA_APPS[0].name
        },
        // ---------- 记忆 ----------
        memOn() {
            return !!(this.settings && this.settings.memory && this.settings.memory.on)
        },
        memLines() {
            return this.settings && this.settings.memory ? this.settings.memory.lines : 24
        },
        memStatText() {
            const s = this.memStat
            return s.count ? (s.count + ' 条 · ' + s.chars + ' 字') : '空'
        },
        // ---------- 人设 ----------
        personaName() {
            return (this.settings && this.settings.personaName) || '（未选择）'
        },
        personaDoc() {
            const n = ((this.settings && this.settings.personas) || []).length
            return '共 ' + n + '/' + MAX_PERSONAS + ' 个人设；切换人设时设置和记录一起换'
        },
        personaCard() {
            return (this.settings && this.settings.personaCard) || {}
        },
        // 标准字段之外的自定义键（好感度规则 / 扮演规则…）：让用户确认没被丢掉
        personaCustomText() {
            const c = this.personaCard
            const ks = c.customKeys || []
            return ks.join('、')
        },
        // 当前人设以外的人设：复制来源的候选（不含自己）
        otherPersonas() {
            const list = (this.settings && this.settings.personas) || []
            const cur = this.settings && this.settings.personaId
            return list.filter((p) => p.id !== cur)
        },
        // 全部人设：切换用的芯片（otherPersonas 不含自己，不能复用）
        personaOptions() {
            return (this.settings && this.settings.personas) || []
        },
        // 路径提示统一从 archive.js 的常量取，改目录时不会漏改文案
        importPath() {
            return IMPORT_DIR + '/'
        },
        // 弹层只有这么高，最多摆 4 个；再多就让用户去数据页
        pickShown() {
            return (this.pickFiles || []).slice(0, 4)
        },
        exportPath() {
            return EXPORT_DIR
        },
        personaPath() {
            return PERSONA_DIR + '/'
        },
        personaFileDoc() {
            return '存到 ' + PERSONA_DIR + '/'
        },
        personaPromptPreview() {
            if (!this.isRole) return ''
            const t = personaSystemPrompt(this.personaCard, this.settings.systemPrompt)
            return t.length > 320 ? t.slice(0, 320) + '…' : t
        }
    }),
    mounted() {
        this.sec = sectionById('chat', getSection())
        this.load()
    },
    unmounted() {
        this.coreUnsubscribe()
        this.stopTick()
    },
    methods: Object.assign({}, baseMethods, {
        has(group) {
            return hasGroup(this.sec, group)
        },

        async load() {
            try {
                await this.loadInner()
            } catch (e) {
                log('settingsx load ERR ' + ((e && e.message) || e))
            }
        },
        async loadInner() {
            this.exitTarget = 'settings'
            await this.coreLoad()
            this.sec = sectionById(this.isRole ? 'role' : 'chat', getSection())
            this.coreSubscribe()
            this.refreshDiag()
            const dev = deviceInfo()
            if (dev.model) log('settingsx ' + this.sec.id + ' ' + dev.model + ' ' + dev.version)
            // 只有这两页需要余额 / 时段 / 节假日 —— 别的分类页不查，省得每次进设置都发请求
            const cached = await loadBalance()
            if (cached) {
                this.bal = cached
                setTimeSkew(cached.skew)
            }
            if (this.has('acct')) {
                await restoreHoliday()
                this.holInfo = holidaySummary()
                this.tickPeriod()
                this.startTick()
                if (isReady(this.settings) && !this.bal) this.refreshBalance()
                this.refreshHoliday(true)
            }
            // 记忆 / 存档只在对应页读
            if (this.has('tool')) {
                this.amapKey = await amapKey()
                this.amapAuto = amapAutoOn()
            }
            if (this.has('memory') || this.has('data')) await this.reloadMemory()
            if (this.has('data')) await this.refreshArchives()
        },

        // ---------- 记忆 ----------
        async reloadMemory() {
            const list = await loadMemory()
            this.notes = list
            this.memStat = memorySummary(list)
            const text = memoryText(list)
            this.memPreview = text.length > 340 ? text.slice(0, 340) + '…' : text
        },
        toggleMemory() {
            const on = !this.memOn
            this.apply({ memory: Object.assign({}, this.settings.memory, { on: on }) })
            log('memory ' + (on ? 'on' : 'off'))
        },
        stepMemory(dir) {
            let v = this.memLines + dir * 6
            if (v < 6) v = 6
            if (v > 60) v = 60
            this.apply({ memory: Object.assign({}, this.settings.memory, { lines: v }) })
        },
        askClearMemory() {
            if (!this.memStat.count) { this.memMsg = '当前没有记忆可清空'; return }
            this.memMsg = ''
            this.ask = {
                kind: 'memory',
                title: '清空记忆？',
                text: '会删掉这 ' + this.memStat.count + ' 条压缩记忆。后面的对话不受影响，但模型会忘掉更早的内容。',
                ok: '清空'
            }
        },

        // ---------- 连接 ----------
        // ---------- 地图与天气 ----------
        async editAmapKey() {
            const cur = this.amapKey || ''
            const text = await openTextEditor(cur, { multiLine: false, confirmText: '确定', maxlength: 64 })
            if (text === null || text === undefined) return
            const key = String(text).trim()
            this.amapOk = false
            this.probeText = ''
            const r = await setAmapKey(key)
            this.amapKey = r.key
            if (!r.saved) { this.amapMsg = '写入失败，重启后可能丢失'; return }
            this.amapMsg = key ? '已保存，点「测试」验一下' : '已清空'
        },

        async toggleAmapAuto() {
            if (!this.amapKey) { this.amapMsg = '先填 Key'; return }
            const r = await setAmapAuto(!this.amapAuto)
            this.amapAuto = r.auto
            this.amapMsg = r.saved
                ? (r.auto ? '聊天里会自动识别天气/地点/路线' : '已关：只有说「使用高德地图」才查')
                : '写入失败，重启后可能丢失'
        },

        async testAmap() {
            if (this.amapBusy) return
            const key = this.amapKey || ''
            if (!key) { this.amapOk = false; this.amapMsg = '先填 Key'; return }
            this.amapBusy = true
            this.amapMsg = '正在测…'
            try {
                const r = await testAmapKey(key)
                this.amapOk = !!r.ok
                if (r.ok && r.sample) {
                    this.amapMsg = '可用 · ' + (r.sample.city || '') + ' ' + (r.sample.weather || '') + ' ' + (r.sample.temperature || '') + '°C'
                } else {
                    this.amapMsg = r.error || '测试失败'
                }
            } catch (e) {
                this.amapOk = false
                this.amapMsg = '测试出错：' + ((e && e.message) || '未知')
            } finally {
                this.amapBusy = false
            }
        },

        // 顺手查一次天气：既验证 Key，也验证"解析 + 取数"整条链是通的
        async probeWeather() {
            if (this.probeBusy) return
            if (!this.amapKey) { this.amapMsg = '先填 Key'; return }
            this.probeBusy = true
            this.probeText = ''
            try {
                const r = await weather({ city: '110000' })
                if (!r.ok || !r.now) {
                    this.amapOk = false
                    this.amapMsg = r.error || '没拿到天气'
                } else {
                    this.amapOk = true
                    this.amapMsg = '能用'
                    const rows = []
                    rows.push(weatherLine(r.now))
                    if (r.now.humidity) rows.push('湿度 ' + r.now.humidity + '%')
                    this.probeText = rows.join(' · ')
                }
            } catch (e) {
                this.probeText = ''
                this.amapMsg = '查询出错：' + ((e && e.message) || '未知')
            } finally {
                this.probeBusy = false
            }
        },

        async editKey() {
            if (!this.settings) return
            const text = await openTextEditor(this.settings.apiKey || '', { multiLine: false, confirmText: '确定', maxlength: 200 })
            if (text === null || text === undefined) return
            const key = String(text).trim()
            this.connOk = false
            this.apply({ apiKey: key })
            if (!this.isAutoSave) { this.connStatus = '已修改，点右上「保存」生效'; return }
            const disk = await loadSettings()
            if (!disk || disk.apiKey !== key) { this.saveMsg = '保存失败：Key 未写入'; return }
            this.connStatus = isReady(this.settings) ? '已保存，建议点「测试」验证' : 'Key 太短，仍不可用'
        },
        async editBase() {
            if (!this.settings) return
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
                this.connStatus = list.length ? ('已刷新：' + list.length + ' 个模型') : '接口返回空列表'
            } catch (e) {
                this.connStatus = (e && e.message) || '扫描失败'
            } finally {
                this.scanning = false
            }
        },
        applyModels(list) {
            const arr = (list || []).filter((m) => m && m.id)
                .map((m) => ({ id: String(m.id), label: String(m.label || m.id) }))
            const ids = arr.map((m) => m.id)
            const p = Object.assign({}, this.settings.params)
            if (ids.length && ids.indexOf(p.model) < 0) p.model = ids[0]
            // 整体换对象：Weex 对深层属性就地改写的派发不稳
            this.apply({ models: arr, params: p })
        },

        // ---------- 账户 ----------
        toggleShowBalance() {
            this.apply({ showBalance: !this.showBalOn })
            log('showBalance ' + !this.showBalOn)
        },
        toggleSourceStyle() {
            const next = this.srcFullOn ? 'single' : 'full'
            this.apply({ sourceStyle: next })
            log('sourceStyle ' + next)
        },
        async refreshBalance() {
            if (this.balBusy) return
            if (!isReady(this.settings)) { this.balMsg = '先填 API Key 再查余额'; return }
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
            } catch (e) {
                this.balMsg = (e && e.message) || '余额查询失败'
            } finally {
                this.balBusy = false
            }
        },
        tickPeriod() {
            this.period = describePeriod(nowMs())
            this.nowTick = Date.now()
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
            this.setParam(it.key, clampNumber(def, cur + dir * step))
        },
        numText(it) {
            const v = this.settings ? this.settings.params[it.key] : 0
            if (it.key === 'maxTokens' && !Number(v)) return '自动'
            if (it.key === 'topLogprobs' && !Number(v)) return '0'
            return String(v)
        },
        boolClass(key, val) {
            return (this.settings.params[key] === true) === val ? 'sy-opt-on' : 'sy-opt'
        },
        boolTxtClass(key, val) {
            return (this.settings.params[key] === true) === val ? 'sy-opttxt-on' : 'sy-opttxt'
        },
        enumClass(key, val) {
            return this.settings.params[key] === val ? 'sy-opt-on' : 'sy-opt'
        },
        enumTxtClass(key, val) {
            return this.settings.params[key] === val ? 'sy-opttxt-on' : 'sy-opttxt'
        },
        textValue(it) {
            const v = this.settings.params[it.key]
            if (!v) return '（空，点击编辑）'
            return String(v).length > 30 ? String(v).slice(0, 30) + '…' : String(v)
        },
        textClass(it) {
            return this.settings.params[it.key] ? 'sy-inl' : 'sy-inl-ph'
        },
        async editParam(it) {
            const cur = String(this.settings.params[it.key] || '')
            const text = await openTextEditor(cur, { multiLine: it.key === 'stopText', confirmText: '确定', maxlength: 600 })
            if (text === null || text === undefined) return
            this.setParam(it.key, String(text))
        },
        async editSystem() {
            if (!this.settings) return
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

        // ---------- 人设 ----------
        cardValue(key) {
            if (key === 'name') return this.personaName
            return this.personaCard[key] || ''
        },
        cardText(key) {
            const v = this.cardValue(key)
            if (!v) return '（空，点击编辑）'
            const s = String(v).replace(/\s+/g, ' ')
            return s.length > 34 ? s.slice(0, 34) + '…' : s
        },
        async editPersonaName() {
            const text = await openTextEditor(this.personaName === '（未选择）' ? '' : this.personaName, {
                multiLine: false, confirmText: '确定', maxlength: 24
            })
            if (text === null || text === undefined) return
            if (!renamePersona(this.settings.personaId, String(text))) { this.saveMsg = '改名失败'; return }
            await this.reloadProfile()
        },
        async editCardField(key) {
            const cur = key === 'name' ? this.personaName : String(this.personaCard[key] || '')
            const multi = key !== 'name'
            const text = await openTextEditor(cur, {
                multiLine: multi, confirmText: multi ? '完成' : '确定',
                maxlength: key === 'description' ? 1200 : 600
            })
            if (text === null || text === undefined) return
            const card = Object.assign({}, this.personaCard)
            card[key] = String(text)
            if (!savePersonaCard(this.settings.personaId, card)) { this.saveMsg = '保存角色卡失败'; return }
            await this.reloadProfile()
        },
        async reloadProfile() {
            const s = await loadSettings()
            if (!s) return
            this.settings = Object.assign({}, s, {
                params: Object.assign({}, s.params),
                memory: Object.assign({}, s.memory)
            })
            this.savedSig = settingsSignature(s)
            this.dirty = false
        },
        // 新人设只沿用连接（Key / 地址 / 模型清单），其余全默认 —— 见 lib/profile.js 的说明
        seedSettings() {
            const src = readOtherProfile('chat')
            return src ? connectionOnly(src) : {}
        },
        newPersona() {
            const n = (this.settings.personas || []).length
            if (n >= MAX_PERSONAS) { this.archMsg = '最多 ' + MAX_PERSONAS + ' 个人设'; return }
            const id = addPersona({ name: '人设 ' + (n + 1), settings: this.seedSettings() })
            if (!id) { this.archMsg = '新建失败'; return }
            switchPersona(id)
            this.load()
        },
        askRemovePersona() {
            const n = (this.settings.personas || []).length
            if (n <= 1) { this.archMsg = '至少要留一个人设'; return }
            this.ask = {
                kind: 'remove',
                title: '删除人设「' + this.personaName + '」？',
                text: '它的设置会一起删掉；它自己的对话记录文件会保留在设备上（不会显示出来）。',
                ok: '删除'
            }
        },
        // ---------- 切人设（唯一的切换入口，主界面不放） ----------
        personaChipClass(id) {
            return this.settings && this.settings.personaId === id ? 'sy-opt-on' : 'sy-opt'
        },
        personaChipTxtClass(id) {
            return this.settings && this.settings.personaId === id ? 'sy-opttxt-on' : 'sy-opttxt'
        },
        async pickPersona(id) {
            if (this.switchBusy) return
            const cur = this.settings ? this.settings.personaId : ''
            this.switchMsg = ''
            if (!id || id === cur) return
            // 首页还在收回答时换档案，这一轮的分片会写进另一个人的对话里
            if (getUiState().chatBusy) { this.switchMsg = '首页正在收回答，等这条结束再切'; return }
            this.switchBusy = true
            try {
                const flat = switchPersona(id)
                if (!flat) { this.switchMsg = '切换失败：写入被拒绝'; return }
                // 重读整套设置（同时广播给首页，那边按 profileTag 变化重载对话）
                await this.load()
                this.cloneMsg = ''
                this.switchMsg = '已切到人设「' + this.personaName + '」'
                log('persona switch ' + id)
            } finally {
                this.switchBusy = false
            }
        },
        askClone(target) {
            this.ask = {
                kind: 'clone',
                target: target,
                title: '用聊天模式的设置覆盖当前人设？',
                text: 'Key / 服务地址 / 参数 / 提示词全部复制过来，现有设置会被覆盖（对话记录不受影响）。',
                ok: '覆盖'
            }
        },
        askCloneFrom(p) {
            if (!p || !p.id) return
            this.cloneMsg = ''
            this.ask = {
                kind: 'clone',
                target: 'persona:' + p.id,
                name: p.name,
                title: '用「' + p.name + '」的设置覆盖当前人设？',
                text: 'Key / 服务地址 / 参数 / 提示词全部复制过来，当前人设的设置会被覆盖（对话记录不受影响）。',
                ok: '覆盖'
            }
        },
        // 导出当前人设：一个 .json 角色卡，能拷走、能再导回来
        async doExportPersona() {
            if (this.archBusy) return
            this.archBusy = true
            this.personaFileMsg = '正在导出…'
            try {
                ensureArchiveDirs()
                const r = await exportPersonaCard({ name: this.personaName, card: this.personaCard })
                this.personaFileMsg = r.ok
                    ? ('已导出 ' + r.path + '（' + r.bytes + ' 字节）')
                    : ('导出失败：' + r.error)
            } catch (e) {
                this.personaFileMsg = '导出失败：' + ((e && e.message) || e)
            } finally {
                this.archBusy = false
            }
        },
        // 导出一个带说明的示例角色卡：不知道字段怎么写时照着改
        async doExportSample() {
            if (this.archBusy) return
            this.archBusy = true
            this.personaFileMsg = '正在导出…'
            try {
                ensureArchiveDirs()
                const r = await exportPersonaSample()
                this.personaFileMsg = r.ok
                    ? ('示例已存 ' + r.path)
                    : ('导出失败：' + r.error)
            } catch (e) {
                this.personaFileMsg = '导出失败：' + ((e && e.message) || e)
            } finally {
                this.archBusy = false
            }
        },
        // 导入人设：先把目录里的文件列出来让用户选，不替用户决定导哪个
        async openImportPicker() {
            await this.loadPickFiles()
            this.pickOpen = true
        },
        async reloadPick() {
            await this.loadPickFiles()
        },
        async loadPickFiles() {
            if (this.pickBusy) return
            this.pickBusy = true
            try {
                ensureArchiveDirs()
                this.pickFiles = await listImportFiles()
                // 顺手同步给「数据与备份」页，切过去就是同一份列表
                this.imports = this.pickFiles
            } catch (e) {
                this.pickFiles = []
                log('导入目录读取失败 ' + ((e && e.message) || e))
            } finally {
                this.pickBusy = false
            }
        },
        closePick() {
            this.pickOpen = false
        },
        pickFile(f) {
            this.pickOpen = false
            this.askImportPersonaFile(f)
        },
        async askImportPersonaFile(f) {
            this.ask = {
                kind: 'personaFile',
                path: f.path,
                title: '导入「' + f.name + '」？',
                text: '会新建一个人设（不改动当前这个）。人设数量有上限，满了要先删。',
                ok: '导入'
            }
        },

        // ---------- 数据与备份 ----------
        async refreshArchives() {
            if (this.archBusy) { log('archive 刷新被跳过（正在忙）'); return }
            this.archBusy = true
            try {
                ensureArchiveDirs()
                this.exports = await listExports()
                this.imports = await listImportFiles()
                log('archive 存档 ' + this.exports.length + ' 个 · 可导入文件 ' + this.imports.length + ' 个')
            } catch (e) {
                log('archive 刷新失败 ' + ((e && e.message) || e))
            } finally {
                this.archBusy = false
            }
        },
        async doExport() {
            if (this.archBusy) return
            this.archBusy = true
            this.archMsg = '正在导出…'
            try {
                const convs = await loadChats()
                const notes = await loadMemory()
                const r = await exportProfile({
                    profileKey: getProfileKey(),
                    name: this.isRole ? this.personaName : '聊天模式',
                    mode: this.isRole ? 'role' : 'chat',
                    personaId: this.settings.personaId,
                    card: this.personaCard,
                    settings: this.settings,
                    personaPrompt: this.isRole ? personaSystemPrompt(this.personaCard, this.settings.systemPrompt) : '',
                    convs: convs,
                    notes: notes
                })
                this.archMsg = r.ok
                    ? ('已导出：' + r.folder + '（' + Math.round(r.bytes / 1024) + ' KB）')
                    : ('导出失败：' + r.error)
            } catch (e) {
                this.archMsg = '导出失败：' + ((e && e.message) || e)
            } finally {
                this.archBusy = false
            }
            // 必须放在 finally 之后：archBusy 还挂着时调 refreshArchives
            // 会被它自己的 `if (this.archBusy) return` 挡掉，列表永远是空的
            await this.refreshArchives()
        },
        askImportArchive(e) {
            if (!e.hasSettings && !e.hasRecords) { this.archMsg = '这个目录里没有可导入的文件'; return }
            this.ask = {
                kind: 'archive',
                folder: e.folder,
                title: '导入「' + e.name + '」？',
                text: '设置' + (e.hasSettings ? '' : '（缺）') + ' + ' + e.sessions + ' 个对话' + (e.hasRecords ? '' : '（缺记录）')
                    + ' 会覆盖当前档案，现有内容不保留。',
                ok: '覆盖导入'
            }
        },
        askImportPersonaFileRow(f) {
            this.askImportPersonaFile(f)
        },
        // ---------- 确认层 ----------
        cancelAsk() {
            this.ask = null
        },
        async confirmAsk() {
            const a = this.ask
            this.ask = null
            if (!a) return
            if (a.kind === 'memory') {
                clearMemory()
                await this.reloadMemory()
                this.memMsg = '记忆已清空'
                return
            }
            if (a.kind === 'remove') {
                if (!removePersona(this.settings.personaId)) { this.archMsg = '删除失败'; return }
                await this.load()
                return
            }
            if (a.kind === 'clone') {
                // 回执统一走 cloneMsg：archMsg 只显示在「数据与备份」那一页，
                // 人设页原地复制完看不到任何变化，就成了「点了没反应」
                this.cloneMsg = ''
                if (a.target === 'chat') {
                    const src = readOtherProfile('chat')
                    if (!src) { this.cloneMsg = '复制失败：读不到聊天模式的设置'; return }
                    if (!cloneProfileInto(src)) { this.cloneMsg = '复制失败：写入被拒绝'; return }
                    await this.load()
                    this.cloneMsg = '已用「聊天模式」的设置覆盖当前人设'
                } else {
                    const id = String(a.target || '').replace(/^persona:/, '')
                    const src = readOtherProfile('role', id)
                    if (!src) { this.cloneMsg = '复制失败：读不到那个人设'; return }
                    if (!cloneProfileInto(src)) { this.cloneMsg = '复制失败：写入被拒绝'; return }
                    await this.load()
                    this.cloneMsg = '已把「' + (a.name || '那个人设') + '」的 Key / 模型 / 参数复制过来'
                }
                return
            }
            if (a.kind === 'archive') {
                await this.doImportArchive(a.folder)
                return
            }
            if (a.kind === 'personaFile') {
                await this.doImportPersonaFile(a.path)
            }
        },

        async doImportArchive(folder) {
            this.archBusy = true
            try {
                const r = await readExport(folder)
                if (!r.ok) { this.archMsg = '导入失败：' + r.error; return }
                if (r.settings) {
                    const s = cloneProfileInto(r.settings)
                    if (!s) { this.archMsg = '设置写入失败'; return }
                }
                if (r.convs) {
                    saveChats(r.convs)
                    // 首页（已经活着的实例）不会自己重读，得广播一声
                    publishChats()
                }
                if (r.notes) {
                    // 覆盖成存档里那份记忆：水位归零，存档的对话照常可以折进来
                    saveMemory(r.notes, 0)
                    publishMemory()
                }
                await this.load()
                const n = r.convs ? r.convs.length : 0
                this.archMsg = '已导入：设置' + (r.settings ? ' ✓' : ' –') + ' · ' + n + ' 个对话 · '
                    + (r.notes ? r.notes.length : 0) + ' 条记忆'
            } catch (e) {
                this.archMsg = '导入失败：' + ((e && e.message) || e)
            } finally {
                this.archBusy = false
            }
        },

        async doImportPersonaFile(path) {
            this.archBusy = true
            try {
                const text = await readImportFile(path)
                if (!text) { this.importNote('读不到这个文件'); return }
                const parsed = parsePersonaFile(text, path)
                if (!parsed.ok) { this.importNote('解析失败：' + parsed.error); return }
                const n = (this.settings.personas || []).length
                if (n >= MAX_PERSONAS) { this.importNote('人设已满 ' + MAX_PERSONAS + ' 个，先删一个'); return }
                const id = addPersona({ name: parsed.name, card: parsed.card, settings: this.seedSettings() })
                if (!id) { this.importNote('新建人设失败'); return }
                switchPersona(id)
                await this.load()
                // 自定义字段（好感度规则等）有没有被吃进来，回执里直接说清楚
                const cks = (parsed.card && parsed.card.customKeys) || []
                this.importNote('已导入人设「' + parsed.name + '」，并切了过去'
                    + (cks.length ? '；自定义字段：' + cks.join('、') : ''))
            } catch (e) {
                this.importNote('导入失败：' + ((e && e.message) || e))
            } finally {
                this.archBusy = false
            }
        },
        // 导入回执要同时写两处：人设页的「文件」行和数据页的提示区，
        // 只写 archMsg 的话在人设页点完导入什么都看不到（和复制人设那次同一个坑）
        importNote(msg) {
            this.personaFileMsg = msg
            this.archMsg = msg
        },

        f2(at) {
            return at ? stampText(at) : '时间未知'
        },

        // ---------- 诊断 ----------
        refreshDiag() {
            this.logTailText = logTail(10) || '(日志为空)'
            this.dataDir = appDir()
            this.storeChan = storageKind()
        },
        async runSelfTest() {
            if (this.diagBusy) return
            this.diagBusy = true
            this.diagMsg = '正在自检…'
            const r = await selfTestWrite()
            const st = await storageSelfTest()
            this.diagBusy = false
            const fileText = r.ok
                ? '文件：可写、读回一致'
                : ('文件：' + (r.step === 'write' ? '写入失败' : (r.step === 'read' ? '写入成功但读不回来' : '读回内容不一致')) + ' \n' + r.error)
            const stText = st.ok
                ? ('宿主存储：' + st.kind + ' 读写一致')
                : ('宿主存储：' + (st.kind === 'none' ? '不可用（该固件没有 jsapi.storage）' : st.error))
            this.diagMsg = fileText + '\n' + stText + '\n' + r.dir
            this.refreshDiag()
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
.sy-page {
    width: 936px;
    height: 280px;
    flex-direction: column;
    background-color: #16161a;
}

.sy-top {
    height: 40px;
    flex-direction: row;
    align-items: center;
    padding-left: 14px;
    padding-right: 14px;
    background-color: #1e1e24;
}

/* 返回键用 div 承载 padding：<text> 的 padding 不进命中测试 */
.sy-back {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 12px;
    padding-right: 12px;
    margin-right: 10px;
    border-radius: 6px;
    background-color: #2a2a33;
    border-width: 1px;
    border-color: #3a3a46;
}

.sy-backtxt {
    font-size: 12px;
    color: #c9c9d4;
}

.sy-title {
    font-size: 15px;
    color: #e8e8ee;
    margin-right: 12px;
}

.sy-sub {
    font-size: 11px;
    color: #6d6d7c;
    flex: 1;
}

.sy-sub-warn {
    font-size: 11px;
    color: #fbbf24;
    flex: 1;
}

.sy-sub-bad {
    font-size: 11px;
    color: #f87171;
    flex: 1;
}

.sy-mode {
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

.sy-modetxt {
    font-size: 11px;
    color: #c9c9d4;
}

.sy-save-on {
    flex-direction: row;
    align-items: center;
    height: 24px;
    padding-left: 12px;
    padding-right: 12px;
    border-radius: 6px;
    background-color: #fbbf24;
}

.sy-savetxt-on {
    font-size: 12px;
    color: #201704;
}

.sy-save-off {
    flex-direction: row;
    align-items: center;
    height: 24px;
    padding-left: 12px;
    padding-right: 12px;
    border-radius: 6px;
    background-color: #2a2a33;
}

.sy-savetxt-off {
    font-size: 12px;
    color: #6d6d7c;
}

.sy-sc {
    height: 240px;
    padding-left: 12px;
    padding-right: 12px;
}

.sy-group {
    flex-direction: column;
    margin-top: 8px;
    margin-bottom: 4px;
}

.sy-gtitle {
    font-size: 12px;
    color: #7cc4ff;
    margin-bottom: 4px;
}

.sy-row {
    flex-direction: row;
    align-items: center;
    height: 40px;
    background-color: #1c1c22;
    border-radius: 6px;
    padding-left: 10px;
    padding-right: 10px;
    margin-bottom: 4px;
}

/* 复制来源那一行：人数不定，高度交给内容（芯片换行要能撑开） */
.sy-row-auto {
    height: auto;
    min-height: 40px;
    align-items: center;
    padding-top: 6px;
    padding-bottom: 6px;
}

.sy-chips {
    flex-direction: row;
    flex-wrap: wrap;
    /* 必须给固定宽度：只写 flex:1 时这个容器会被压成 0 宽，
       芯片能画出来却接收不到触摸（本平台无宽度容器不传递事件） */
    width: 790px;
}

.sy-chip {
    margin-bottom: 2px;
}

.sy-doc-line {
    font-size: 10px;
    color: #6d6d7c;
    margin-left: 10px;
    margin-bottom: 4px;
    line-height: 15px;
}

.sy-label {
    font-size: 13px;
    color: #c8c8d4;
    width: 92px;
}

.sy-ctl {
    flex-direction: row;
    align-items: center;
    margin-right: 10px;
}

.sy-ctl-wrap {
    flex-wrap: wrap;
}

.sy-btn2 {
    flex-direction: row;
    align-items: center;
    height: 26px;
    background-color: #26262f;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 5px;
    margin-right: 8px;
}

.sy-btn2txt {
    font-size: 12px;
    color: #7cc4ff;
}

.sy-btn2bad {
    color: #f08a83;
}

.sy-opt {
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

.sy-opt-on {
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

.sy-opttxt {
    font-size: 12px;
    color: #9a9aa8;
}

.sy-opttxt-on {
    font-size: 12px;
    color: #0d1a12;
}

.sy-step {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 26px;
    background-color: #26262f;
    border-radius: 5px;
}

.sy-steptxt {
    font-size: 16px;
    color: #cfd6e4;
}

.sy-num {
    font-size: 13px;
    color: #e4e4ec;
    width: 62px;
    text-align: center;
}

.sy-text {
    font-size: 13px;
    color: #e4e4ec;
}

/* 放进 .sy-ctl 里的文本专用：sy-ph / sy-value 带 flex:1，
   而 sy-ctl 自己没有宽度，flex:1 的子节点会把父容器压成 0 宽 ——
   于是「（空，点击编辑）」既看不见也点不中。这里给固定宽度。 */
.sy-inl {
    font-size: 13px;
    color: #e4e4ec;
    width: 200px;
    lines: 1;
    text-overflow: ellipsis;
}

.sy-inl-ph {
    font-size: 13px;
    color: #6d6d7c;
    width: 200px;
    lines: 1;
}

.sy-value {
    font-size: 13px;
    color: #9fe1cb;
    flex: 1;
    lines: 1;
    text-overflow: ellipsis;
}

.sy-ph {
    font-size: 13px;
    color: #6d6d7c;
    flex: 1;
    lines: 1;
}

.sy-hint {
    font-size: 11px;
    color: #6d6d7c;
}

.sy-ok {
    font-size: 11px;
    color: #4ade80;
    flex: 1;
    lines: 1;
}

.sy-oknum {
    font-size: 13px;
    color: #4ade80;
}

.sy-warnnum {
    font-size: 13px;
    color: #f0b866;
}

.sy-badnum {
    font-size: 13px;
    color: #f08a83;
}

.sy-doc {
    font-size: 10px;
    color: #6d6d7c;
    flex: 1;
    lines: 1;
}

.sy-doc-off {
    font-size: 10px;
    color: #b8863a;
    flex: 1;
    lines: 1;
}

.sy-note {
    font-size: 10px;
    color: #5d5d6c;
    margin-left: 10px;
    margin-bottom: 4px;
}

.sy-note2 {
    font-size: 10px;
    color: #9fe1cb;
    margin-left: 10px;
    margin-bottom: 6px;
}

.sy-preview {
    flex-direction: row;
    background-color: #1c1c22;
    border-radius: 6px;
    padding: 8px;
    margin-bottom: 4px;
}

.sy-previewtext {
    font-size: 11px;
    color: #9fe1cb;
}

/* 导入 / 导出路径提示：放在人设页最下面，一眼能看到文件该往哪放 */
.sy-pathbox {
    flex-direction: column;
    background-color: #1c1c22;
    border-radius: 6px;
    padding: 8px 10px;
    margin-top: 6px;
}

.sy-pathtitle {
    font-size: 11px;
    color: #8f8f9e;
    margin-bottom: 4px;
}

.sy-pathtext {
    font-size: 10px;
    color: #7f95a8;
    line-height: 15px;
}

.sy-logtext {
    font-size: 9px;
    color: #8f8f9e;
}

/* 确认层：全屏覆盖层必须 position:absolute（本平台把 fixed 当静态定位） */
.sy-overlay {
    position: absolute;
    left: 0;
    top: 0;
    width: 936px;
    height: 280px;
    background-color: rgba(0, 0, 0, 0.62);
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.sy-confirm {
    width: 460px;
    flex-direction: column;
    background-color: #1e1e24;
    border-radius: 10px;
    padding: 14px;
    border-width: 1px;
    border-color: #3a3a46;
}

.sy-confirmtitle {
    font-size: 14px;
    color: #f0b866;
    margin-bottom: 8px;
}

.sy-confirmtext {
    font-size: 12px;
    color: #c9c9d4;
    margin-bottom: 12px;
    line-height: 18px;
}

.sy-confirmrow {
    flex-direction: row;
    justify-content: flex-end;
}

.sy-btn-c {
    flex-direction: row;
    align-items: center;
    height: 28px;
    padding-left: 14px;
    padding-right: 14px;
    border-radius: 6px;
    background-color: #2a2a33;
    margin-right: 8px;
}

.sy-btnctxt {
    font-size: 12px;
    color: #c9c9d4;
}

.sy-btn-go {
    flex-direction: row;
    align-items: center;
    height: 28px;
    padding-left: 14px;
    padding-right: 14px;
    border-radius: 6px;
    background-color: #f08a83;
}

.sy-btngotxt {
    font-size: 12px;
    color: #2a0d0b;
}

/* 导入选择层：列出 import 目录里的文件，点哪一个导哪一个 */
.sy-pick {
    width: 520px;
    flex-direction: column;
    background-color: #1e1e24;
    border-radius: 10px;
    padding: 14px;
    border-width: 1px;
    border-color: #3a3a46;
}

.sy-pickdir {
    font-size: 11px;
    color: #7f95a8;
    margin-bottom: 10px;
}

.sy-pickrow {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    background-color: #26262f;
    border-radius: 6px;
    padding-left: 10px;
    padding-right: 10px;
    margin-bottom: 4px;
}

.sy-pickname {
    width: 380px;
    font-size: 12px;
    color: #e6e6ee;
}

.sy-pickgo {
    font-size: 12px;
    color: #7cc4ff;
}

.sy-pickempty {
    width: 480px;
    font-size: 12px;
    color: #8f8f9e;
    line-height: 18px;
    margin-bottom: 4px;
}
</style>
