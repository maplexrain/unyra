# 对外 MCP 服务：让外部 harness 当应用的外设智能体

应用本身充当 MCP server：外部 AI harness（ZCode / Claude Code 等）经 MCP 连进来，
用与导师 agent 同源的沙箱 api 操作学习数据——harness 成为应用的外设智能体。
本文是 P0 的使用说明；协议与实现见 `electron/mcp/serve.ts` / `serveProtocol.ts` /
`src/agent/mcp/serveHost.ts`。

## 架构

```
外部 harness ──stdio──> electron/mcp/bridge.mjs（哑桥）──命名管道──> 主进程 serve.ts ──IPC──> 渲染层 guest 会话
```

- **管道**：`\\.\pipe\unyra-mcp`，主进程在 `whenReady` 即监听（界面没就绪的调用回可读报错）。
- **发现与鉴权**：启动时把 `{pipe, token, pid, version}` 写进
  `%APPDATA%\unyra\mcp-endpoint.json`（退出时删除）；桥读它连接，并在首行
  `unyra/hello` 里带 token——握手前的任何消息都会被断开。token 每次启动重生成。
- **工具执行**：主进程只做转发；真正的执行在渲染层 guest 会话——
  `learnSandboxOps`（与一轮对话、超级文档桥同一个装配点）+ `subsetSandbox`
  （与 work 的 guest 同一把裁剪刀）+ Worker 沙箱（每次编排一个 Worker，15 秒上限）。

## harness 配置

应用内的入口：**超级导师设置 → 对外 MCP 服务**——开关、运行状态（管道/端点文件/连接数）、
可直接复制的 mcpServers 配置片段（按当前安装形态给出哑桥路径）与最近 50 条调用记录。
配置片段长这样（开发形态）：

```json
{ "mcpServers": { "unyra": { "command": "node", "args": ["<路径>/mcp-bridge.mjs"] } } }
```

- 源码开发：路径指仓库里的 `electron/mcp/bridge.mjs`；
- 打包版：`<安装目录>\resources\app.asar.unpacked\dist-electron\mcp-bridge.mjs`
  （构建脚本把它拷进产物并 asarUnpack——普通 Node 读不了 asar）；
- 端点文件不在默认位置时：`--endpoint <路径>` 参数或 `UNYRA_MCP_ENDPOINT` 环境变量。

**应用必须已经在跑**。桥在应用没运行 / 端点残留时会给出可操作的报错并退出。

## 工具（清单单一事实源：`shared/mcpServeTools.ts`）

| 工具 | 参数 | 说明 |
|---|---|---|
| `execute` | `body`（必），`description?` | 执行一段 JS/TS 编排（`((api)=>{...})`），返回值折成纯数据。每次编排受 15 秒沙箱上限约束 |
| `api_manual` | `target?` | 现查 api 手册（与沙箱 `__help()` 同一份注册表渲染）：`root` → 总览；`node` → 组清单；`node.get` → 单条签名/示例 |

## 开放边界（guest 会话）

- api 组白名单 `MCP_ALLOWED_GROUPS`：`web / tmp / res / node / memory / workspace`
  （与 work 同级）。ask / ui / exam / permission / wf / work / chat 这些
  「导师层」能力不对外——将来要开放得先带审批面（P1）。
- `goalId` 落在用户当前活动目标（`store.activeGoalId`）；guest 无「当前节点」。
- guest 调用在渲染层**串行**执行（一次编排跑完才跑下一次），与内部 agent 共用
  同一份 store；数据改动实时反映到界面。

## 安全模型

- 只监听本机命名管道，无网络面；连接数上限 8。
- token 握手是唯一闸门；token 只经端点文件传递（同机同用户可读）。
- 应用退出即停服删文件；桥会用 pid 识别残留的旧端点文件。

## 排错

| 现象 | 看哪 |
|---|---|
| 桥报「没找到端点文件」 | 应用没启动；或启动的是旧版本 |
| 桥报「应用进程已经不在了」 | 端点文件是残留旧文件，重启应用 |
| `initialize` 报 token 握手失败 | 有别的进程直连管道没走桥（桥才会发 hello） |
| 调用回 `-32000` | 渲染层没就绪或 120 秒无回执（看应用窗口是否正常） |
| `execute` 回 `ok:false` | 内容里有「没有生效」清单与改法，按它改参数重试 |
