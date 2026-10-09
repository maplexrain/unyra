# 桌面架构

```
渲染进程 (React, sandbox)
   │  window.mojiNative（preload 经 contextBridge 暴露）
   ▼
主进程 ──┬── llm-proxy://  把所有 AI 请求转发出去（Node fetch，无跨域）
         └── 原生能力       打开/保存文件对话框、窗口控制、图片读写（二进制走单独通道）
```

## 为什么 AI 请求要经主进程

在浏览器里直连各家的 API 会被两道限制卡住，而且都不是配置问题：

1. **CORS**：服务端必须显式放行才能读响应；Command Code 网关的预检只放行
   `Content-Type,Authorization`，而它的版本门禁又要求 `x-command-code-version`
   —— 浏览器永远发不出这个头；
2. **禁止改写的请求头**：`User-Agent` 等由浏览器独占，脚本设不了。

主进程没有这两道限制。渲染层把 `https://<host>/<path>` 改写成
`llm-proxy://<host>/<path>`（见 `src/ai/http.ts`），主进程校验 host 后用 Node fetch
发出、响应流式回传（见 `electron/proxy.ts`）。自定义协议是 Electron 的特权协议，
以 `corsEnabled` 注册后不受同源策略约束。

**只放行白名单**：主进程只转发「内置预设地址 ∪ 用户实际配置地址」，
渲染层通过 `llm-proxy:setHosts` 同步过来（见 `src/ai/settings.ts` 的
`allProviderBaseUrls`）。**它不是一个开放代理**，白名单外的 host 一律 403。

> `http://` 的地址也能用（本地 Ollama / vLLM 与不少内网网关都是明文），代价是那一段链路里
> API Key 与内容是明文——细节见 [ai-providers.md](ai-providers.md) 的「自定义提供商」。

## 窗口与原生能力

窗口是**无边框**的（`frame: false`），标题栏由渲染层自绘：

- 顶栏（`LearnWorkspace` 里的 `Topbar`）带 `-webkit-app-region: drag`，整条可拖动窗口；
  里面的按钮、输入框等交互元素由 CSS 统一声明 `no-drag`，否则点击会被当成拖窗口
- 右侧 `WindowControls` 负责最小化 / 最大化 / 关闭，并订阅主进程推来的最大化状态
  以切换图标；它**只在 Electron 下渲染**，不会在别处出现点不动的假按钮

其他原生能力：

- **尽量只有一个窗口**。学习状态、超级导师设置都做成主窗口里的元素；唯一的例外是**考试窗口**——
  考试要全屏、要挡住主窗口（防翻文档），还要能在主窗口被遮住时独立存在，那三件事在一个窗口里做不到
  （前两者占用文档列，后者是一个弹窗）：整套学习数据在内存里是一份整体，
  两个进程各自读改写同一批文件（页签顺序、教学文档、会话都在同一批文件里）必然会互相覆盖，
  而这类「顺带看一眼」的面板不值得为它背一套跨窗口的同步逻辑
- **窗口尺寸与位置记忆**；**外链一律交给系统浏览器打开**（新窗口、主框架导航、超级文档的
  iframe 三条路都拦——markdown 里的链接没有 target，点下去就是一次主框架导航，不拦整个界面会被
  那个网页顶掉；判定是纯函数，见 `electron/link-core.ts` 与 `tests/linkNav.test.ts`）；
  单实例锁防止双开并发写同一份本地数据
- **壳上的 logo**：窗口图标（任务栏 / Alt+Tab）与托盘图标都用 `public/logo.png`，
  与应用内左上角那个是同一份文件，不另存副本。**任务栏那颗另有出处**：Windows 按
  AppUserModelID 找带这个身份的开始菜单快捷方式、取它的图标，窗口自己的 `icon` 只在
  没有那条快捷方式时才算数（见 `electron/app/identity.ts`）
- **应用身份（AppUserModelID）**：打包版用 `com.moji.guiyi`（与 `electron-builder.yml` 的
  `appId`、安装器建的快捷方式一致），**源码运行用 `com.moji.guiyi.dev`**。分两个身份是因为
  源码运行的 exe 是 node_modules 里的 electron.exe：把开发版固定到任务栏 / 开始菜单时，
  Windows 写下的那条快捷方式目标是 electron.exe、图标是 Electron 原子，而 AUMID 抄的是
  当时那个窗口的——**从此安装版的任务栏图标也变成原子**（2026-10 踩过）
- **托盘**：应用启动即常驻通知区，点它把窗口叫回来（最小化状态会先还原），
  右键菜单里是「显示主窗口 / 收进托盘 / 退出」
- **关窗行为**（设置 → 窗口；**全局设置**，跟机器走、不属于任何用户）：**询问**（默认）/ 直接关闭 /
  最小化到托盘。选「询问」时弹出应用自己的对话框，里面可以勾选「不再询问」——勾了之后按你点的那颗
  按钮（直接关闭或最小化到托盘）把策略记下来，下次不再问。「收进托盘」只隐藏窗口：
  进程、未发完的那一轮回答、界面状态全留着，第一次收起来时会给一个气泡提示

## 模块地图

几个原本上千行的文件已经按职责拆成了目录 + barrel（`agent/sandbox/`、`agent/panel/`、
`learn/{ops,store,graph,exam,groups,reading,tracker,ai}/`、`learn/{explorer,workspace}/`、
`components/settings/`、`lib/annotation/`、`electron/{app,storage}/`、`styles/`）。**原路径继续把原来
的名字转出来**，所以按文件名写的引用照样成立，调用方也一行没改。另有 `shared/ipc.ts`：
渲染层与主进程共用的 IPC 契约类型（以前两侧各写一遍，漏改一侧不报错、只在运行时炸）。
为什么这么分：**只搬家、原路径继续转出、注释跟着代码走**——每条边界守什么，由各目录自己的头注释在守。

- `electron/` —— 主进程：`main.ts`（窗口、托盘、关窗拦截、IPC、生命周期）、
  `web.ts`（抓网页的唯一出口：只读、有上限、不碰内网）与 `web-core.ts`（地址能不能抓、算什么内容、
  按什么编码读——纯逻辑，用例在 `tests/webCore.test.ts`）、`proxy.ts`（`llm-proxy://` 转发，
  AI 请求的唯一出口）与 `proxy-core.ts`（转发目标的解析与白名单判据——纯逻辑，不 import electron，
  因此 Node 探针跑得动）、`storage.ts`（全局设置与本机文件读写，含越界防护；`root`、关窗行为与
  **内置插件的开关**都在这里）、`plugins.ts`（插件目录 `{root}/plugins/` 的扫描、读源码与启用清单
  ——只递源码，执行在渲染层）、`update.ts`（自动更新的状态机：定时检查、后台下载、安装）与 `update-core.ts`（相位、轮询策略、
  失败归类、更新说明整理——纯逻辑因此可在 Node 里测）、`preload.ts`（contextBridge 桥）
- `scripts/` —— `dev.mjs`（Vite + Electron 联合启动与热重启）、`electron-compile.mjs`（esbuild 编译
  主进程）、`build-electron.mjs`（生产构建）、`release.mjs`（发布构建全流程）、
  `agent-ops.test.ts` + `run-agent-ops-test.mjs`（回归探针：esbuild 打包成 ESM 后直接在 Node 里跑）、
  `update.test.ts` + `run-update-test.mjs`（更新链路探针）、`run-tests.mjs`（统一测试入口）、
  `serve-updates.mjs`（本地更新源）、`serve-fake-model.mjs`（本地假模型，把「模型 → execute → 沙箱」
  跑通而不必花钱调真模型）、`verify-release.mjs`（发布之后核对线上那份与本地产物）、
  `topbar-align.mjs` + `topbar-align-entry.tsx`（顶栏对齐探针：
  用**真实组件**加真实 CSS 在 Electron 里量每段文字的基线，差几像素看得见——看截图看不出来）
- `tests/` —— vitest 单元用例（`npm run test:unit`，见 [development.md](development.md)）：
  只放用例，业务代码不放这里
- `src/agent/` —— 框架无关的 Agent 核心：`types` 定义会话片段与事件，`tools` 是唯一那个 `execute`
  工具（模型写一段 JS，经沙箱里的 api 编排一切），`sandboxWorker` / `sandboxRuntime.js` 负责在
  Worker 里跑这段代码并把 api 调用转回宿主，`runtime` 负责「思考 → 工具 → 观察」循环（不设轮次上限）
- `src/agent/persona.ts` —— 导师人格：三种模式的指令文本、共同底线、以及「这一轮要不要补一句」的
  判据（纯函数）；人格以隐藏 user 消息进上下文，不进系统提示词。见 [agent.md](agent.md)
- `src/learn/` —— 学习领域：`types`（`NoteFile` 的一节点多笔记模型、`LearnTab` 页签与
  `LearningState`）/ `groups`（文档区的分组与分割：布局树、页签的移动与落点、关掉之后谁接管焦点，
  纯函数）/ `learning`（学习状态的纯函数：值域校验、错误记忆的累加、检验时间线的裁剪）、
  `reading`（有效阅读的事实：会话、节锚、学习日索引与有界压缩）、`useReadingTracker`（把「真的在读」
  变成增量的采集器）、`attention`（把事实折成档位与建议的纯函数）、`checkin`（打卡：资格、门槛复核、
  连续天数与日历）、`pomodoro`（导师排计划、用户点开始的专注计时）/ `graph`（纯函数 DAG 操作，
  含笔记的增删改与页签的连带处理）/ `notes`（笔记的纯逻辑：取名去重、改名、写入与追加）/
  `tabs`（自由页签的纯逻辑：身份、关闭的落点、默认视图、拖动落点的位移）/ `drafts`（暂存区）/
  `localfiles`（本地文件列表）/ `segments`（文件名 / 目录名的取名规则）/ `files`（磁盘结构，
  内存 ↔ 目录树）/ `store`（持久化与归一化）/ `paths`（沙箱 path 的寻址与报错）/
  `agentOps`（每个 api 怎么落到 store 上）/ `exam`（试卷与判分）/ `examRecords`（考试过程的记录）/
  `useExamBridge`（把考试窗口发来的事件落到 store）/ `ai`（超级导师提示词与就地释义）/
  `images`（消息附件：缩放、落盘、读取、清理）/ `useAgent`（把运行时接到 store，流式渲染）
- `src/user/` —— 用户与画像：`types` / `profile`（归一化与提示词块）/ `store`（用户列表，
  即 `users/` 下的目录 + 数据作用域）/ `session`（登录态，导航守卫已搬到 `lib/route`）/
  `api`（仓储接口，预留远端账号体系）
- `src/components/learn/` —— 学习页的几块界面：`LearnWorkspace`（工作区与顶栏）/
  `ExplorerSidebar`（资源管理器）/ `docTypes`（文档类型的图标与配色，页签栏与侧栏共用一份）/
  `TabBar`（**一格自己的**页签栏）/ `agent/PersonaPicker` / `DocFloat`（右上角悬浮组）/
  `NodeStatePanel` / `NodeNote`（文档渲染与选词菜单）/ `SourceEditor` / `LocalDoc` /
  `ExamCopyView` / `NoteDialog` / `DocOutline` / `ExportDialog`
- `src/components/agent/` —— `AgentPanel.tsx`（agent 栏：消息列表、消息定位条、输入卡片）与
  `ModelPicker.tsx`（右下角的「提供商 · 模型 · 思考等级」三级菜单）
- `src/components/` 其余 —— `WindowControls.tsx`（无边框窗口的自绘窗口控制）、`CloseDialog.tsx`、
  `update/`（`UpdateButton` + `UpdateDialog`；开关、手动检查与进度在设置面板的「更新」分页）
- `src/lib/web/` —— 读网页：`dom.ts`（DOMParser 提取正文那一块）、`page.ts`（树 → markdown、
  标题大纲与每一节的字数、按路径切片——纯函数，用例在 `tests/webPage.test.ts`）
- `src/syntax/` —— 代码块语法高亮（与渲染无关的那一半）：`LanguageAliases`（40 门语言的表与别名）、
  `GrammarRegistry`（TextMate 语法与 oniguruma 引擎的按需加载与缓存）、
  `SyntaxHighlighter`（`highlight(code, languageId) → tokens`，纯逻辑 + 结果缓存）、
  `Theme`（scope → 令牌类型 → `<span class="tok-…">`，颜色交给 CSS 变量）。
  用例在 `tests/syntax.test.ts`，其中一条会真的把 JavaScript 语法跑一遍
- `src/run/RunnerRuntime.js` —— 跑伪编译产物的那个沙箱（纯 JS，被当作字符串塞进 Blob Worker，
  与 agent 的 `agent/sandboxRuntime.js` 同一套路数）。宿主这一半在 `src/lib/codeRun.ts`，
  产物在 `src/lib/codeArtifacts.ts`，「谁来跑工作流」那根线在 `src/lib/docHost.ts`，
  转译本身是内置工作流「伪编译」+ api.code.save / code.silent，菜单在 `src/lib/codeBlockMenu.ts`。
  用例在 `tests/codeRun.test.ts`：它用一个 vm 造的假全局把运行时**真的执行一遍**——那份 .js 是字符串，
  语法错在构建期看不出来
- `src/lib/` —— 渲染与交互支撑：`docScroll`（读到哪儿了）、`copySource`（复制走源文）、
  `sourceMap`（选区 ↔ 源文偏移的双向映射）、`quoteFocus`（引文定位与高亮）、
  `agentFocus`（Ctrl+Q 的落点）、`native`（原生桥的类型与取用）、`localFiles`（外部文件读写的渲染层
  入口）、`route`（导航守卫）、`update`（更新状态的订阅与失败归类）、`storage`（渲染层的落盘入口与写队列）、
  `boot`（启动编排：用户 → 会话 → 该用户的数据）、`userSettings`、`markdown`、`codeHighlight`、
  `sanitize`（消毒白名单：正文与插件共用一份）、`plugins`（**插件宿主**）、
  `renderPlugins`（**Markdown 文档插件**这一类）、`builtinPlugins`（内置的 plot）、`annotation`、
  `clock`、`plot` / `plotExpr`（函数图像与表达式归一化）、`exportDoc` + `export.css`、
  `nodeLink`、`annotationStyle`、`autofill`、`closeBehavior`
- `src/ai/` —— AI 接入层，按协议分文件：`types`（公共契约）、`content`（中立的图片片段 → 各家格式）、
  `providers`（内置提供商注册表）、`settings`（`{ providers[], global }` 与迁移）、
  `http`（渲染层的网络出口，改写地址并同步白名单）、`client`（统一客户端）、
  `anthropic` / `responses` / `commandcode`（另外三种协议）。见 [ai-providers.md](ai-providers.md)

## 扩展方式

- **内置一家服务**：在 `src/ai/providers.ts` 的 `PROVIDERS` 里加一条预设即可（id、显示名、baseUrl、
  推荐模型、控制台地址、协议差异）。设置页会自动出现这一项，主进程的代理白名单也会自动带上它，
  其余代码无需改动。
- **新增一种兼容格式**：在 `src/ai/` 下加一个协议模块（照 `anthropic.ts`：序列化请求 + 解析事件流），
  在 `types.ts` 的 `ProviderProtocol` 与 `COMPAT_META` 里加一个取值，再让 `client.ts` 的两处分派认它。
  用户即可在「新建提供商」时选到它。
- **接入任意一家**：不用改代码——用自定义提供商选一个兼容格式、填地址即可。
- **加一门代码语言**：在 `src/syntax/LanguageAliases.ts` 的 `LANGUAGES` 加一行（id / scopeName /
  显示名 / 别名），再到 `src/syntax/GrammarRegistry.ts` 的 `GRAMMAR_LOADERS` 加一行
  `() => import('@shikijs/langs/<那份语法>')`。两边不一致会被 `tests/syntax.test.ts` 当场指出；
  打包时这门语言自动成为一个独立分包，没人用到就不会被下载。
- **加一种文档语法**：写一个插件即可，不必改应用的代码——认领围栏语言、给 `render`（同步产出 HTML）、
  需要画图的再给 `hydrate`。内置的走 `src/lib/builtinPlugins.ts`，用户装的丢进 `{root}/plugins/`
  并在设置里启用（见 [rendering.md](rendering.md)）。
- **加一个沙箱 api**：四处要一起改——实现在 `src/agent/sandbox/api.ts` 的 `buildApi`
  （各组 `*Ops` 的实现住在 `src/learn/ops/`）、名单在 `src/agent/sandboxWorker.ts` 的 `API_NAMES`
  （不登记的话 Worker 侧不存在这个名字）、用法写进 `src/learn/ai/executeGuide.ts` 的 `EXECUTE_GUIDE`
  （模型唯一的手）、目录加进 `src/agent/apiCatalog.ts`（设置 → 开发者里那份「api 上下文管理」）。
  后两者与前两者的一致性由 agent 探针逐条对账，漏一处就红。
- **想知道某个大文件为什么拆成了小文件**：拆分规矩就三条——**只搬家不重写**、**原路径继续把原来的
  名字转出来**（按文件名写的引用照样成立）、**注释跟着代码走**；各目录的头注释记着各自的职责边界。
