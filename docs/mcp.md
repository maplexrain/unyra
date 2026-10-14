# 外部 MCP 服务

> 用户在「超级导师设置 → MCP」里配置的 Model Context Protocol 服务，导师通过 execute 沙箱
> 的 `api.mcp` 调度。相关：[sandbox-api.md](sandbox-api.md)（execute 与 api 一览）、
> [architecture.md](architecture.md)（主进程与渲染层）。

## 它是 execute 的一小组 api，不是独立工具

导师手里永远只有 `execute` 一个工具；MCP 是沙箱里的 **mcp 组**：`mcp.list` / `mcp.discover` /
`mcp.call` 三条通用入口（服务按 id 或名称指名）。这样一来外部工具再多，每轮的 tools 声明也
只有一条 `execute`——与「唯一的工具」这条设计对齐（早先的做法是每个 MCP 工具翻译成一枚
独立 AgentTool 挂进 tools 清单，外部工具一多，声明就膨胀，设置一变还会破坏前缀缓存）。

- 实现在 `src/agent/mcp/`：`ops.ts`（装配进沙箱）、`client.ts`（两条传输）、`types.ts`（配置与预设）；
- 宿主在总开关开着时注入（`makeMcpOps`，见 `src/learn/useAgent.ts`）；关掉就没有这一组；
- 提示词：`EXECUTE_GUIDE` 的「按需加载的能力」只有一行索引；完整规范在
  `promptModules` 的 `mcp` 模块里，模型首次调用 `mcp.*` 时注入（见 [prompt-modules.md](prompt-modules.md)）；
- 目录（`src/agent/apiCatalog.ts` 的 mcp 组）与实现由 agent 探针逐条对账；
- **子代理拿不到这一组**（apiAllow 白名单与 subsetSandbox 都不带它）——MCP 是导师级的真实外部
  系统，要开放得同时改 `subagent/groups.ts` 的白名单与 `manager.ts` 的 subsetSandbox。

## 两条传输，各走各的路

| 传输 | 谁在跑 | 实现在哪 |
| --- | --- | --- |
| `sse`（HTTP 端点） | 渲染层直接 `fetch`（POST JSON-RPC） | `src/agent/mcp/client.ts` 的 sse 分支 |
| `stdio`（本地进程） | **主进程**起子进程，stdin/stdout 上按行 JSON-RPC | `electron/mcp/stdio.ts` |

stdio 必须住在主进程：渲染层拿不到 `child_process`。链路是
`execute → agent/mcp/ops → McpClient → preload（mcp:discover / mcp:call）→ electron/mcp/ipc →
会话（electron/mcp/stdio）`，服务配置每次由渲染层原样递过去（`shared/ipc` 的
`McpStdioServerPayload`），主进程按配置指纹复用会话。

## stdio 会话的几条纪律（electron/mcp/stdio.ts）

- **按配置指纹复用**：`id + command + args + env` 一份配置一个常驻进程；同 id 换了配置，
  旧进程当场拆掉、下次用时重起。并发调用共享同一次创建（不会起出两个进程）。
- **Windows 的 npx 要 `npx.cmd` + shell**：裸 `npx` 的 spawn 是 ENOENT（Node 18.20 起
  `.cmd` 不带 shell 又是 EINVAL）——先按原样起，ENOENT 再补 `.cmd` + shell 重试一次。
- **可诊断**：stderr 留最后几行、随错误回执带出（npx 装包失败、服务自己报错都在那里）；
  stdout 只认 JSON 行，横幅/日志忽略。
- **超时即拆会话**（initialize 默认 60 秒、请求默认 120 秒——npx 冷启动要下载包）；
  进程中途死了，把所有等待中的请求当场拒掉并说明退出码。
- **不留孤儿**：设置里禁用 / 删除服务、关总开关 → `mcp:stop`；应用退出（`before-quit` 与
  Node 的 exit/SIGINT/SIGTERM 钩子）→ 全量清理，Windows 走 `taskkill /T`（npx 是服务进程的祖辈）。

## 预设

「添加常用预设」里的三条 stdio 预设都指向**真实存在、验证过能跑**的 npm 包：

- Fetch → `npx -y @tokenizin/mcp-npx-fetch`（fetch_markdown / fetch_html / fetch_txt / fetch_json）；
- Filesystem → `npx -y @modelcontextprotocol/server-filesystem .`（最后一个参数是放行的目录，
  默认 `.` 即数据根目录；改成你自己的文件夹即可）；
- SQLite → `npx -y mcp-sqlite-server`（query / schema；数据库文件按调用传路径，默认只读闸门）；
- HTTP/SSE 那条是占位（`http://localhost:8000/sse`），供用户填自己的服务端。

预设里的 `defaultTools` 只是「首次探测前的缓存清单」；点「探测工具」会起真进程刷新
（stdio 预设第一次点会慢：npx 在下载包）。

老安装的存量配置：早期版本的内置预设指向过不存在的 npm 包（`server-fetch` / `server-sqlite`
在 npm 上都是 404）与死路径 `./workspace`——`agent/settings` 的 `migrateMcpServers` 在设置
归一化时按**包名精确匹配**把这些参数换成能跑的形态（幂等；用户自己改过的参数不碰）。

## 测试与对账

- `tests/mcpStdio.test.ts`：**真进程**用例，对手方是 `tests/fixtures/mcp-stdio-server.cjs`
  （本机 node 直起，不走 npx、不碰网络）——覆盖握手 / 工具清单 / 调用 / 会话复用 / 换配置重起 /
  起不来（stderr 尾巴）/ 中途退出 / 超时拆会话；
- `tests/agentSkillsAndMcp.test.ts`：渲染层一侧——委托主进程桥、回执映射、没有桥时的可读报错；
- agent 探针（`npm run test:agent`）：`mcp.list / discover / call` 三条与 apiCatalog 对账。
