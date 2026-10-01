# 本地开发

```bash
npm install
node node_modules/electron/install.js   # 下载 Electron 二进制（见下方注意）
npm run dev          # 起 Vite + Electron（等价于 npm run electron:dev）
npm run build        # 类型检查 + 渲染层构建 + 主进程编译
npm start            # 运行生产构建
npm run lint
npm run test           # 一次跑完全部测试：vitest 单元用例 + 下面两套 Node 探针（提交前跑这个）
npm run test:unit      # 只跑 vitest（tests/ 下的单元用例，秒级）
npm run test:coverage  # 覆盖率报告（vitest 用例的行/分支覆盖）：看数字找盲区，不是门禁
npm run test:agent     # Node 里跑一遍新架构的回归探针（存储 / 路径寻址 / execute 的 api 面）
npm run test:update    # 更新链路的回归探针（发布配置一致性 / 检查时机 / 失败归类 / 构建产物自检）
npm run release:verify # 发布之后核对线上那份与本地产物（正式发布？Latest？三样齐全？sha512 对得上？）
npm run serve:updates  # 本地更新源：把 release/ 按更新协议发出去（验证整条更新链路用）
node scripts/serve-fake-model.mjs --script <剧本.mjs>   # 本地假模型：把「模型 → execute → 沙箱」跑通，不花钱
```

- `npm run dev` 会同时起 Vite 与 Electron，改渲染层走 HMR，改 `electron/` 自动重建并重启
- 生产构建产物：渲染层在 `dist/`，主进程与 preload 在 `dist-electron/`
- **改完 execute 那一层怎么验**：`scripts/serve-fake-model.mjs` 是一个照着 OpenAI 协议写的本地假模型，
  它按剧本回放工具调用。写一份剧本（导出 `[{ tool: { description, body } }, …, { text: '收尾' }]`），
  起服务，在设置里加一个「自定义 · OpenAI 兼容」提供商、地址填 `http://127.0.0.1:8799/v1`，
  然后在对话里说一句话——整条链路（真沙箱 Worker、真工具返回值）就跑起来了，每次请求的
  工具结果都会写进日志。这条链路里最容易坏的都是「看不见的那一层」，而它平时只有真发一次
  请求才暴露；有了它就不必为了验收去烧 token。

> **注意：Electron 的二进制不会被 `npm install` 自动下载。** Electron 44 起把
> postinstall 去掉了，需要单独跑一次 `node node_modules/electron/install.js`。
> 国内网络若卡在 GitHub，先设镜像：
> `$env:ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/"`
> （PowerShell；macOS/Linux 用 `export ELECTRON_MIRROR=...`）。

## 测试：一个入口，改完就跑

`npm run test` **一次跑完全部测试**：vitest 的单元用例，加上原有那四套 Node 探针。一条命令、
最后一行给总结，任何一套没过都以非零码退出——提交 / 合并前跑它，不必先判断「这次改的是哪一层、
该跑哪几个」。

| 命令 | 跑什么 |
| --- | --- |
| `npm run test` | **全部**（下面三条依次跑一遍） |
| `npm run test:unit` | vitest 单元用例（`tests/**/*.test.ts`，秒级）：页签、笔记、本地文件、快捷键、暂存区（暂存的增删、改名搬家、读回来的校验）、上下文压缩（摘要怎么成形 / 失活怎么折算 / 值不值得压）、文件附件（围栏与截断）、agent 设置归一化、文档查找的命中区间、导出的建议文件名与整页 HTML 的自足性（无外部引用 / 转义 / 公式走 MathML） |
| `npm run test:agent` | Node 探针：存储 / 路径寻址 / execute 的 api 面 |
| `npm run test:update` | Node 探针：更新链路（发布配置一致性 / 检查时机 / 失败归类 / 构建产物自检） |
| `npm run test:coverage` | 覆盖率报告（只算 vitest 用例）：全部 `src/` 文件都在表里，包括从没被用例加载过的——0% 的那几行才是盲区。终端出文字表，逐文件详情在 `coverage/index.html`。只做报告不定阈值：阈值一旦拦人，就会诱导出凑行数的用例 |

分工是定下来的，别混：

- **新改动的纯逻辑必须附 vitest 用例**（放 `tests/`），历史代码不补——那三套探针继续钉它们原来
  钉的东西。理由是成本：写的时候顺手留一句断言，与事后回头补一套测试，差着量级；而没写的那部分
  将来也不会有人回头补。
- 用例放 `tests/`、**不放 `src/`**：`tsconfig.app.json` 的 include 是 `["src"]`、vite 构建也扫
  那一头，用例混在业务代码旁边会被打进产物。类型检查由 `tsconfig.tests.json` 管（`tsc -b` 一并跑）：
  它比 `tsconfig.tools.json` 多一份 DOM 的 lib——用例要 import 渲染层的纯函数，而那些函数的签名里
  就有 `KeyboardEvent` 这类类型。这只是类型层面，运行仍在 Node 里（`environment: 'node'`），不引 jsdom。
- 用例里**显式 `import { describe, it, expect } from 'vitest'`**（配置里 `globals: false`），
  于是 tsconfig 不必再认一套全局类型。
- **每条用例的中文注释写清它钉住的是哪个行为**，以及这条错了会以什么形式暴露给用户——只说明
  「这里测了 X」的注释等于没写。示范见 `tests/keyCombo.test.ts`。
- 不测「当前时间」与随机数：那种用例要么今天过明天挂，要么什么都没验证。真要测，就先让那个函数
  把时钟 / 随机源当参数收进来。
