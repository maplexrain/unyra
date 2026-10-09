# 打包与发布

构建产物、反篡改开关、自动更新的完整链路与日常发布流程。

## 打包

```bash
npm run release:win   # = node scripts/release.mjs：类型检查 → 渲染层 → 主进程（压缩、无 sourcemap）→ NSIS 安装包
npm run icons         # 从 public/logo.svg 重新生成 logo.png 与安装包图标（换 logo 时跑）
```

产物在 `release/`（已 gitignore）：

| 文件 | 说明 |
| --- | --- |
| `Unyra-<版本>-Setup.exe` | 安装向导：可改安装目录、装进当前用户（不弹 UAC）、建桌面与开始菜单快捷方式 |
| `Unyra-<版本>-Setup.exe.blockmap` | 增量下载用：客户端只下变了的那几块（缺了不会出错，只是每次全量下） |
| `latest.yml` | 更新元数据：版本号 + 安装包 sha512。**客户端更新的唯一依据** |
| `win-unpacked/` | 免安装的整份程序，里面的 `归一 Unyra.exe` 双击即可运行 |

前三个是要传上去的，见下文「日常发布」。

几条定下来的事（配置见 `electron-builder.yml`，每条都写了为什么）：

- **只装三样**：`dist/`（vite 打好的渲染层）、`dist-electron/`（esbuild 打好的主进程与 preload）、`package.json`。
  `node_modules` 被显式排掉——运行时一个 npm 包都不需要（三个产物里出现过的 `require` 只有 `electron`
  与 `node:` 内置模块），不排掉的话挂在 `dependencies` 上的 react / marked / katex 会整份进包。asar 因此约 4 MB。
- **用户数据目录不变**：`electron/main.ts` 里用 `app.setPath('userData', %APPDATA%\unyra)` **钉死**，
  所以安装版与 `npm run dev` 用的是同一份目录——教学文档、对话、资源都在那里，卸载器也不会删它
  （`deleteAppDataOnUninstall: false`）。为什么不靠 `app.getName()` 的默认值：它取的是打包时那份
  `package.json` 里的 `productName`／`name`，改一次显示名就可能换目录、让老用户的数据「凭空消失」。
  `productName: 归一 Unyra` 因此只影响安装向导、快捷方式与控制面板里的显示名。
  v0.4.9 起目录从 `%APPDATA%\moji-notes` 改名而来：首次启动整份同盘改名搬过来，搬不动就退回老目录。
- **图标**：矢量原稿是 `public/logo.svg`，`npm run icons` 把它光栅化成两份位图——
  `public/logo.png`（256²，运行时：窗口图标、托盘、界面标志、favicon 共用这一份）与
  `build/icon.png`（1024²，electron-builder 由它生成 exe 与安装包的多尺寸 .ico）。
  为什么要生成而不是直接放位图：nativeImage 与 electron-builder 都不吃 SVG，而换 logo 时
  只需改一个 SVG。生成物要一起提交，构建不依赖这个脚本（它用 Electron 自己渲染，零新依赖）。
  ⚠️ **任务栏那颗图标另有出处**：Windows 按 AppUserModelID 去找带这个身份的**开始菜单快捷方式**，
  取它的图标；窗口自己的 `icon` 只在「没有那条快捷方式」时才算数。所以 `electron-builder.yml` 的
  `appId` 必须与运行时设的 AUMID 逐字一致（`electron/app/identity.ts`，用例钉着），
  而源码运行另用 `.dev` 后缀的身份——不分的话，把开发版固定到开始菜单会写下一条
  「目标 electron.exe、图标＝Electron 原子」的快捷方式，**安装版的任务栏图标也跟着变成原子**
  （2026-10 真踩过：用户开始菜单里多出一条「Electron」，删掉它图标立刻恢复）。
  ⚠️ 界面里引用图标必须是**相对路径**（`./logo.png`）：打包后页面以 `file://` 加载，
  绝对路径会解析到文件系统根目录而裂图，而开发时 Vite 服务 public/ 一切正常——
  这个差异只在打包后才暴露（踩过一次，见 `components/Logo.tsx`）。
- **未签名**：没有配代码签名证书，Windows SmartScreen 首次运行会提示「未知发布者」。
  要消掉得买证书，然后在 `electron-builder.yml` 里补 `win.certificateFile` / `certificatePassword`
  （或用 `CSC_LINK` / `CSC_KEY_PASSWORD` 环境变量）。

> 安装版与开发版共用一个数据目录，也因此**共用单实例锁**：`npm run dev` 开着的时候，双击安装版不会起新窗口
> （它会自己退出）。要两个同时跑，给其中一个加 `--user-data-dir=<另一个目录>`。

## 反篡改：改一个字节就起不来

**每次构建出来的安装包是同一份**，不含任何按买家定制的内容。这里做的是「让改包变难」：

- 发布构建（`npm run release:win`）里主进程 **压缩、不带 sourcemap**，包里也排除任何 `.map`
  （此前 `main/preload/proxy` 三个 `.map` 都在包内，等于附赠源码）；开发构建仍保留 sourcemap，
  因为线上问题要能查。
- `electron-builder.yml` 打开了三个反篡改开关（Electron fuses）：

- `enableEmbeddedAsarIntegrityValidation` + `onlyLoadAppFromAsar`：**app.asar 被改过一个字节就起不来**。
  实测（改掉 asar 中间一个字节）：进程当场退出，`FATAL:electron/shell/browser/net/asar/asar_file_validator.cc:
  Failed to validate block while ending ASAR file stream`——窗口、数据都没有。
  这堵死的是最省事的那种「解包 → 改判断 → 重打包」；
- `enableNodeOptionsEnvironmentVariable` / `runAsNode` / `enableNodeCliInspectArguments` 全关：
  堵掉 `NODE_OPTIONS`、`ELECTRON_RUN_AS_NODE`、`--inspect` 三条注入路子。

代价：**改完 asar 必须重新打包**（不能再手工往包里塞文件）；`npm run dev` 不受影响——
fuses 只改打包产物，开发跑的是 `node_modules` 里的 electron。

**它挡不住什么**（别当万能药）：会改 exe、会重打包的人仍然绕得过去——上面的开关只是把
「改一个判断」从几分钟变成一道工序；混淆只能再抬高一档。

顺带：`electronDist: node_modules/electron/dist` 让打包不再去 GitHub 下那份 110 MB 的 electron zip——
国内网络实测会 `ETIMEDOUT` 直接把打包打挂。

## 自动更新

装好之后不用管它：应用起来几秒后在后台问一次更新源，有新版本就自己下好，
**下载完**顶栏才出现一个「↻ 更新」入口（下载期间界面上什么都不显示）。鼠标经过它能看到
这一版的更新说明，点一下才弹确认，确认后应用关闭、静默安装、装完自动重新打开。

### 什么时候去问更新源

- 应用起来 **3 秒后**一次（给首屏与数据载入让路）；
- 之后**每 5 分钟**一次（`POLL_INTERVAL_MS`）：这个应用会被长期开着（关窗还能收进托盘，
  进程一直活着），只在启动时查一次的话，挂着跑一天的人永远等不到新版本；
- 用户点「检查最新版本」时，任何时候都问。

前两条属于「自动」，受设置里那个开关控制；判据是 `update-core.ts` 的 `shouldCheck()`——
纯函数，测试里钉住了「关掉之后连请求都不发」「正在下载时不重复问」这些分支。

状态机（`electron/update.ts`）：

| 状态 | 含义 | 界面上 |
| --- | --- | --- |
| `disabled` | 这个构建不参与自动更新（开发运行、非 Windows） | 什么都不显示 |
| `idle` | 还没查过，或已是最新 | 什么都不显示 |
| `checking` | 正在问更新源 | 什么都不显示 |
| `available` | 查到了新版本，还没开始下 | 设置 → 更新里给一个「下载」按钮 |
| `downloading` | 后台下载中 | 顶栏**什么都不显示**；设置 → 更新里有进度条 |
| `ready` | 下载完成、校验通过 | 顶栏出现「↻ 更新」 |
| `installing` | 用户点了「立即更新」 | 关掉应用去装 |
| `error` | 出错了 | 设置 → 更新里说明原因；下一次轮询会自己再试 |

「下载期间不显示任何东西」是刻意的：用户看到那颗按钮时，包已经躺在本地了，
点下去是「确认安装」而不是「开始等几分钟」。进度只画在**设置 → 更新**那一页——
那是用户特意打开来看的地方，顶栏则全程安静。

### 设置 → 更新

- **开关：自动检查并下载更新**（全局设置，存在 `global.yaml`，跟机器走）。
  关掉之后启动检查与轮询都不发请求，但「检查最新版本」随时仍然可用——
  不打扰必须包括不产生网络请求；
- **检查最新版本**：手动那一下任何时候都有效；
- **安装包与进度**：新版本的文件名、体积、已下载字节、速度与百分比（十进制单位，
  与发布页上 GitHub 显示的口径一致）。

## 分发

```
本仓库  maplexrain/unyra（开源）
      │  构建 + npm run release:publish
      ▼
Releases  maplexrain/unyra/releases    ← 安装包 + latest.yml，谁都能下
      │  electron-updater（匿名 HTTPS，不需要 token）
      ▼
用户机器 ──── 更新：下好，等你点
```

安装包是公开的：谁都能下载、安装、升级。用户数据与教学文档都在 `%APPDATA%\unyra`，
**不在安装目录里**，所以升级或卸载都不会碰到它们。

## 日常发布

```bash
# 1. 改代码 → 测试 → 改 package.json 里的 version（语义化版本）
# 2. （可选）把这一版的说明写进 release-notes/v<版本>.md —— 客户端「更新说明」显示的就是它
#    不写就用 GitHub 按 PR 自动生成的那份
# 3. 构建 + 上传 + 自检，一条命令
npm run release:publish
```

第 3 步做四件事：构建（`--publish never`）、对着 latest.yml 核一遍刚构建出来的安装包、
用已登录的 `gh` 建 Release 并上传三样产物、最后跑一次发布后自检。**不需要 GH_TOKEN**。

为什么上传不用 electron-builder 的 `--publish always`：实测它会在「创建 release」那一步
吃 `422 already_exists` 中断（哪怕 release 并不存在），而且一中断 latest.yml 压根不会被生成
——线上只剩一个安装包，客户端报「缺少更新所需的文件」。这是踩了两次之后改的，`scripts/release.mjs`
的文件头写着原委。`electron-builder.yml` 里的 publish 配置仍然要留着：安装包内那份
`app-update.yml` 由它生成，客户端按它知道去哪里取更新。

想只核对线上的那份（比如手工传过文件之后）：`npm run release:verify`。

第 4 步不是走过场：**发布这一步错了不会当场报错**，只会让所有买家那边悄悄坏掉。
真实踩到过一次——上传中途失败，Release 建出来了、安装包也传上去了，但 `latest.yml`
是上一版构建留下来的：版本号一样、文件名一样，唯独 sha512 对不上，客户端要到
「下载完发现校验不过」才暴露，而作者这边看不出任何异常。`release:verify` 把发布出去
的那份与本地产物对齐一遍：是不是正式发布、是不是 Latest、三样产物齐不齐、
`latest.yml` 里的版本号 / 文件名 / sha512 / 体积与**传上去的那个安装包**以及本地那个
是否一致。对不上时它会连「怎么补」一起打出来。

只想在本机看看包长什么样：`npm run release:win`（只构建，显式 `--publish never`）。

`release:publish` 动手前先拦三道，都是「传上去才发现不对」的情况：版本号还是占位值 `0.0.0`、
没有 `GH_TOKEN`、工作区有未提交的改动。发布仓库是客户端更新的**唯一来源**，传错一份比构建失败麻烦得多。

几个容易踩的点，都已写进 `electron-builder.yml` 的注释：

- **`releaseType` 必须是 `release`**。默认是 `draft`，而草稿既不在 `releases/latest`、
  也不在 `releases.atom` 里——检查更新会永远回答「已是最新」，且没有任何报错；
- **git tag 打在私有源码仓库上，不要打在发布仓库上**。`release:publish` 上传靠 token，
  不靠 tag；而 electron-builder 默认的 `onTagOrDraft` 策略会在「当前 commit 有 tag」时
  自己往 GitHub 传——所以平时一律显式 `--publish never`，免得安装包被传到源码仓库去；
- **产物文件名保持纯 ASCII 且不含空格**。中文名在下载链路上容易变乱码，空格会被
  GitHub provider 悄悄换成 `-` 而对不上号（测试里钉住了这两条）。

## 怎么验证更新链路（不用真的发布）

发布之前就能把整条链路跑一遍——本地起一个更新源，把 `release/` 按更新协议发出去：

```bash
npm run release:win                                          # 先构建，产物在 release/
npm run serve:updates                                        # 本地更新源，默认 http://127.0.0.1:8788
$env:MOJI_UPDATE_FEED='http://127.0.0.1:8788'; npm run dev     # 客户端指向它
```

`MOJI_UPDATE_FEED` 会往 userData 写一份 generic provider 的配置（连缓存目录一起换掉，
不与正式源抢），让 updater 走本地。**打包版也认这个变量**，所以「装一个旧版本、
再喂给它一个新版本」这种端到端演练也能做。它只换更新源，不动任何校验逻辑。

这个本地源是**照着真实源写的**：它实现了 RFC 7233 的多段 Range（multipart/byteranges），
也就是增量下载真正走的那条路。这一点值得较真——只回整份文件的话，客户端拿到的不是它要的
那些区间，校验对不上，于是每次都悄悄退回全量下载：**不出错，只是每次都下一百多 MB**。
本地源跟真实源不一样，这种问题就永远测不出来。

两个只在验证时用的环境变量（都不是给用户的功能）：

| 变量 | 作用 |
| --- | --- |
| `MOJI_UPDATE_POLL_MS` | 改轮询间隔（毫秒，最小 1000）。验证「挂着跑一天」这条链路时不必真等 5 分钟 |
| `MOJI_SERVE_KBPS` | 把本地源的发送速度压到指定 KB/s。本地回环下一百多兆一两秒就完了，**进度条根本来不及出现**——要验证它就得让源慢下来，而不是怪代码看不出来 |

> 另一个容易自己骗自己的地方：连着测几个版本时，如果几个安装包**字节完全相同**，
> electron-updater 的单槽缓存会直接复用（哈希一样就不重下），于是「下载」这一步压根没发生。
> 想真跑一遍下载，得让包真的不一样。

`npm run test:update` 是纯 Node 的探针（不需要 Electron、不联网），钉三类事：

1. **发布配置的一致性**——发布仓库地址同时出现在 `electron-builder.yml`（安装包真的去哪取）
   与 `update-core.ts`（界面「发布页」指向哪），写岔了不报错、只是更新永远不来；
   还有 `releaseType` 与产物命名；
2. **失败归类**——「连不上 GitHub」和「仓库里还没有正式发布」是两件要分头处理的事；
3. **构建产物自检**——`latest.yml` 的版本号、文件名、sha512 与那个 exe 必须对得上，
   而装进包里的 `app-update.yml` 必须指向公开仓库。这几条正是「真发布之后才发现
   所有客户端都卡在下载上」的那类问题，本地几十秒就能查出来。

## 还没做 · 取舍

- **没有代码签名**：安装包没有 Authenticode 签名（与打包那节同一个原因：没买证书），
  所以 electron-updater 的发布者校验是跳过的。真正的完整性来自 `latest.yml` 里登记的 sha512，
  而它经 HTTPS 从 GitHub 取回——也就是说**发布仓库那个账号的安全 = 分发的安全**；
  拿到发布权限的人能发一个假的新版本。
  给账号开两步验证是这里最划算的一道加固；
- **发出去就撤不回来**：已经装上新版本的机器不会因为你在 GitHub 上删掉那个 Release 而回退，
  只能再发一个更高的版本。所以发布前把包在自己机器上装一遍；
- **每 5 分钟查一次**（外加启动时一次）。一次检查就是几个 HTTP 请求，代价可以忽略；
  关掉设置里的开关之后一次都不发；
- **用户不点就永远不装**：`autoInstallOnAppQuit = false`。默认行为是「退出时装上」，
  但那与「什么时候装由用户决定」冲突（关窗行为选「收进托盘」时尤其容易误解）。
  代价是没点过的用户会一直停在旧版本；想改成退出即装，把那一行改成 `true` 即可；
- **不做强制更新、不做回滚**。进度只在设置 → 更新里画（顶栏全程安静）；
  发布一个坏版本之后只能靠下一个版本救；
- **国内速度就是 GitHub 的速度**。真要加速，把 `MOJI_UPDATE_FEED` 那套 generic provider
  指到一个镜像/对象存储即可（更新源与校验逻辑是分开的），但那是第二阶段的事；
- **mac / Linux 不参与**：目前只有 Windows 的 NSIS 安装包这一条链路，
  `updaterEnabled()` 里显式挡掉了别的平台。
