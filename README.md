# deep-pen-api

运行在有道词典笔上的 **DeepSeek 客户端**，Falcon 小程序框架（HaaS UI）。

不走任何第三方反代，直连 `api.deepseek.com` 官方端点，用你自己的 API Key。

- 逻辑分辨率 **936 × 280**（横屏小屏）
- 运行时 QuickJS，Vue 3 SFC，构建产物为 `.amr` 安装包
- 单测 **294 项断言**（纯函数全部可在 Node 下跑，不需要设备）

## 功能

**对话**

- SSE 流式输出。QuickJS 没有流式 `fetch`，用 `curl -N` 落盘 + 增量轮询实现；
  API Key 通过 `-H @file` 传入，不出现在 `ps` 命令行里
- 多轮历史，可切换 / 重命名 / 删除
- 三个可调档位（思考开关、推理强度、联网开关）直接挂在顶栏芯片上
- 图片输入：调起系统相机/相册，新照片增量并入，不重复加载

**渲染**

- Markdown 渲染成"扁平 run"列表：这台设备的 `<text>` 不能有元素子节点
  （带 measure 的节点加子节点会让 `libfalcon.so` 断言失败并 abort 整个进程），
  所以行内样式必须拍平成同级 `<text>`，由父级 `flex-wrap` 换行
- LaTeX 走固件内置引擎（`<richtext><latex/></richtext>`，与 `<text>` 同级）。
  该引擎能排分式、根式、积分、求和、极限、希腊字母、上下标、`\mathbb`、
  `\begin{cases}`、`\begin{pmatrix}`，但**字号固定 34px 不可缩放、忽略 CSS color**；
  因此"整行放得下"才用原生公式，放不下才退化成独立块
- 裸公式兜底：模型偶尔不输出 `$` 时按启发式识别（无汉字、含 `\frac`/`\int` 等命令、
  去掉命令后多字母词极少），仍能正常出图

**账户**

- 余额：`GET /user/balance`，顶栏显示为 `¥3.85·谷` 一个芯片，点一下强刷
- 峰谷时段：DeepSeek 没有"当前时段"接口，规则是**工作日（非法定节假日）**
  9:00–12:00、14:00–18:00 峰价，其余半价。本地按北京时间算，并用余额响应头
  的 `Date` 校准设备时钟（笔的时钟不可信）
- 法定节假日：联网取 `holiday-cn` 数据（多源回退），缓存 30 天，用于判断
  "今天到底算不算工作日"
- 主页是否显示余额芯片：「设置 → 账户」里可开关，关掉后连自动查询一起停

## 目录结构

```
src/
  app.js / app.json          入口与页面注册
  pages/
    index/                   首页：对话、顶栏芯片、发送
    settings/                设置：API Key、模型、参数、账户
    setup/                   首次配置引导
    latexlab/                公式诊断页（36 条语料，用来验证固件 LaTeX 能力边界）
  lib/                       纯函数，可直接在 Node 下单测
    latex.js                 LaTeX 预处理：块识别、裸公式兜底、间距收紧
    md.js                    Markdown → 扁平 run
    sse.js                   SSE 解析（跨轮询保留半截事件）
    settings.js              设置结构 + 归一化（含默认值与钳制）
    balance.js               余额文案与分级配色
    peak.js                  峰谷时段判定（不读设备时区）
    holiday.js               节假日数据解析
    uistate.js               跨页面状态广播
    chat.js / photos.js / text.js / params.js
  services/                  有副作用的一层
    api.js                   curl 封装：流式补全、余额、节假日
    platform.js              fs / global / $falcon / $dataDir 差异收敛
    store.js                 本地存储：settings / chats / balance / holiday
    ime.js                   系统输入法（独立 mini-app，startTextEdit + 回调）
    media.js                 相机与相册
scripts/
  build.js                   审计 → 单测 → rollup → qjsc → manifest → amr
  bump.js                    版本号
  audit-text-nesting.js      静态检查 <text> 里是否嵌了元素（会炸进程的那条）
test/run.mjs                 294 项断言
```

## 构建

```bash
npm install
npm test            # 纯函数单测，无需设备
npm run build       # 开发包
npm run build:prod  # 生产包
```

产物固定为 `<appid>.<版本>.amr`（appid `8000000000182399`，版本下划线连接），
在项目根目录。装到设备：

```bash
adb connect <ip>:5555
adb shell "miniapp_cli install <appid>.<版本>.amr"
adb shell "miniapp_cli start <appid>"
```

> 版本号不变时新旧包同名，设备上分不清装的是哪一版。**改代码先 `npm run bump`**
> （默认 patch +1），`build:prod` 开头会打印实际出包名。

`scripts/build.js` 会在构建前自动给 `aiot-vue-cli` 打兼容补丁、补
`falcon-ui` 缺失的 theme 文件 —— 这两步原本要手工做，重装 `node_modules`
就会失效且报错难懂。

## 第三方组件与外部数据

这一节把"哪些东西不是本项目写的"逐项说清。区分三类：**直接依赖**（装进来用）、
**对别人代码打的补丁**（修别人的包）、**仅参考思路/结论**（没有复制代码）。

### 1. 直接依赖（npm 公共包，未修改其源码）

| 包 | 版本 | 许可 | 在本项目里做什么 |
|---|---|---|---|
| `vue` | 3.5.44 | MIT | 页面框架（SFC） |
| `@vue/compiler-sfc` | 3.5.44 | MIT | 模板/脚本编译 |
| `aiot-vue-cli` | 1.0.32 | MIT | **构建主力**：rollup 打包、qjsc 预编译、manifest 生成、amr 打包全走它 |
| `falcon-ui` | 0.0.17 | MIT | 控件与基础样式（本项目样式绝大多数仍为自写） |
| `@rollup/plugin-typescript` | 12.3.0 | MIT | 让 CLI 的 rollup 能编译 TS（补丁里注入） |
| `rollup` | 2.80.0 | MIT | 打包器（由 `aiot-vue-cli` 带入，未在 package.json 直接声明） |
| `typescript` | 5.9.3 | Apache-2.0 | 类型生成（`scripts/type_gen.js`） |

`aiot-vue-cli` 的包描述为"阿里云 IoT 小程序构建工具"，与词典笔所用的 HaaS UI /
Falcon 运行时同源；`falcon-ui` 是其配套 UI 包。两者在 npm 上公开发布。

### 2. 对工具链打的补丁（`scripts/patch-cli.sh`）

这个脚本里那几条 `sed` **不是本项目原创**：脚本注释已写明"与官方 CI 用的补丁一致"，
本项目只是把它固化成幂等脚本、并在构建前自动执行。改的四处均为兼容性修复：

1. `cli-libs/index.js`：把 CLI 自带的 Vue2 `vue-template-compiler` 换成 `@vue/compiler-sfc`
   （否则与 vue 3.5 版本不匹配，`require` 当场抛错）
2. `web-loaders/falcon-vue-loader/lib/parser.js`：`compiler.parseComponent()` → `compiler.parse().descriptor`
3. 同上 `template-compiler/index.js`：`compiler.compile` → `compiler.compileTemplate`
4. `src/libs/rollup.config.js`：注入 `@rollup/plugin-typescript`，并把 `defineComponent` 替换为空

另外脚本会补一个 `falcon-ui/src/styles/theme-default/theme.config.js`（内容 `export default {}`）。
这一条是**本项目的绕行**，不是官方提供：CLI 里 `theme || 'theme-default'` 让空字符串也绕不过去，
而本应用不消费 `FALCON_THEME` 变量，空对象等价。

### 3. 平台知识来源

- **HaaS UI（有道词典笔 OS）开发文档** —— [docs.posc.net](https://docs.posc.net)，
  由社区 **PenOSCrack（POSC）** 维护整理，**不是有道官方发布的文档**
  （该文档自述"由杭八识文档改编，深度化适配网易有道词典笔 OS"）。
  页面注册、生命周期、JSAPI 清单、真机安装/启动指令、PStore 授权与签名校验等平台事实，
  主要以它为依据；本项目**只参考其中的平台事实与接口清单，未复制文档正文**，也未随仓库分发。
  本项目里"`<text>` 不能有元素子节点""固件内置 LaTeX 字号固定 34px""从子页面返回不触发 `onShow`"
  这类结论，是在该文档基础上到真机上逐条实测确认的；**文档与固件实际行为不一致时以实测为准**
  （差异见下文「已知限制」与源码里的实测注释）。
- **[haasui-falcon-app](https://github.com/Magniswan/haasui-falcon-app)**：词典笔 Falcon 小程序
  开发参考。`src/services/ime.js` 的输入法接入路径（`global.startTextEdit` +
  `textEditFinished` 双通道回传）参考其输入法章节，以及 `templates/jsapi` 里
  KeyInput/KeyCodes 的说明。**仅参考结论与调用约定，未复用其代码**（该仓库未声明许可）。
- **[Deepseek-Pen](https://github.com/chezixiang/Deepseek-Pen)**：同为词典笔上的 DeepSeek 客户端，
  可作为形态参照。`src/services/media.js` 里对比过它的拍照实现
  （`camera.js`：v4l2 + gstreamer + kmssink 直接驱动 `/dev/video29`），本项目最终选择了
  "拉起系统拍照应用 + 返回后重扫相册"这条更轻的路。
  ⚠️ **未复制其任何代码**：该仓库为 **GPL-3.0**，与本项目 MIT 不兼容，故只作思路参考。

### 4. 外部数据与服务

| 来源 | 用途 | 说明 |
|---|---|---|
| [holiday-cn](https://github.com/NateScarlet/holiday-cn)（MIT） | 法定节假日 / 调休补班 | 主源，经 jsDelivr CDN 取当年 JSON；数据由该项目自动抓取国务院公告生成 |
| [timor.tech](https://timor.tech/api/holiday/) | 同上 | 备用源（需带浏览器 UA）。两个源在 2026 年数据上一致，互为兜底 |
| 国务院办公厅节假日安排公告 | 数据原始依据 | 上述两个源的上游 |
| DeepSeek 官方 API 文档（api-docs.deepseek.com） | 参数模型、余额接口 | 参数项与可选值对齐官方文档；余额为 `GET /user/balance` |
| DeepSeek 官方计费说明 | 峰谷时段规则 | 官方**没有**"当前时段"接口，故按规则本地推算（工作日 9–12 / 14–18 峰价，其余半价） |

节假日数据只在"判断今天是工作日还是节假日"时使用，不做二次分发；缓存 30 天，
无网络时可回退到内置规则。

## 鸣谢

- **有道 / HaaS UI 团队**：提供词典笔上的 Falcon 小程序运行时与 SDK（宿主固件侧）
- **PenOSCrack（POSC）社区**：维护 docs.posc.net 上那套 HaaS UI 开发文档。这类封闭小设备上
  几乎没有官方公开的完整资料，这套社区文档是外部开发者入门的主要入口
- **`aiot-vue-cli` 与 `falcon-ui` 的作者**：构建链与控件基础，没有它们这个项目得从手工拼 amr 开始
- **NateScarlet**：`holiday-cn` 常年维护中国法定节假日数据，让峰谷判定不必自己啃公告
- **timor.tech**：提供了免费的备用节假日接口
- **chezixiang / Deepseek-Pen** 与 **Magniswan / haasui-falcon-app**：在词典笔这类冷门平台上
  的探索，为输入法、拍照、构建等细节提供了参照

如果你认为本项目某处引用不当或遗漏了出处，请开 issue，我会尽快更正。

## 已知限制

- 原生公式字号固定 34px，长公式只能滚动，无法缩小塞进一行
- 固件不识别 `\\[4pt]` 这类行距参数，矩阵换行会漏出字面量，已在预处理里剥掉
- 这个固件**从子页面返回时不触发首页 `onShow`**，页面实例会带着旧数据继续活着。
  跨页改动靠 `lib/uistate.js`（模块单例 + 订阅广播）通知，不能依赖 `onShow`
- 设备上 `fs.writeFile` 是同步的，`await` 反而卡住事件循环

## 声明

非官方项目，与 DeepSeek、有道均无关联。"DeepSeek"、"有道"、"词典笔"等名称与商标
归各自权利人所有，此处仅作兼容性说明之用。使用需自备 API Key，费用自理。

本仓库**只包含代码**：不含任何人的 API Key、不含节假日原始数据、不含平台开发文档或其副本
（上文提到的社区文档与厂商资料均未随仓库分发）。
上文列出的第三方组件与数据遵循各自许可（MIT / Apache-2.0），本项目自身的代码为 MIT。

## License

MIT
