# AI 提供商

任何兼容 OpenAI 协议的服务都能接入（`POST /chat/completions` + `GET /models`，Bearer 鉴权，
SSE 流式，function calling）。**默认使用 DeepSeek 官方**，开箱即填一个 Key 就能用。

| 提供商 | 默认地址 | 协议 |
| --- | --- | --- |
| **DeepSeek 官方**（默认） | `api.deepseek.com` | OpenAI 兼容 |
| 月之暗面 Kimi | `api.moonshot.cn/v1` | OpenAI 兼容 |
| 智谱 GLM | `open.bigmodel.cn/api/paas/v4` | OpenAI 兼容 |
| 阿里云百炼（通义千问） | `dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI 兼容 |
| 火山方舟（豆包） | `ark.cn-beijing.volces.com/api/v3` | OpenAI 兼容 |
| 硅基流动 SiliconFlow | `api.siliconflow.cn/v1` | OpenAI 兼容 |
| OpenRouter | `openrouter.ai/api/v1` | OpenAI 兼容 |
| OpenAI | `api.openai.com/v1` | OpenAI 兼容（推理模型走 `max_completion_tokens`）|
| Google Gemini | `generativelanguage.googleapis.com/v1beta/openai` | OpenAI 兼容 |
| xAI Grok | `api.x.ai/v1` | OpenAI 兼容 |
| Command Code Go 套餐 | `api.commandcode.ai` | 私有网关（见下）|

以上都是**内置提供商**：开箱即在列表里，选中后填 Key、勾模型即可用。

## 模型配置面板：两级页面

**一级 · 提供商列表**

- 已配置的提供商列表（显示名称、内置/自定义、兼容格式、模型 ID、是否为全局）；点击进入配置页
- 「新增提供商」入口，以及「可添加的内置提供商」快选
- **思考程度**也放在这一页：它是全局设置，与模型列表同级，不绑提供商与模型

**二级 · 提供商配置页**（点某个提供商进入）

1. **选择提供商**：内置提供商快捷配置，或自定义（三种兼容格式）
2. **名称**：内置可留空（默认显示预设名），自定义给个名字
3. **接入参数**：**字段由预设声明**（见下），表单照着渲染
4. **模型列表**：一个提供商可配多个模型，每个模型含
   **模型名称 / 模型 ID / 模型上下文 / 多模态能力**；第一个即默认模型

## 预设：差异体现在表单上

「预设」不只是几个常量，它是**自描述**的——除了 baseUrl、模型推荐、协议差异，还声明自己需要哪些
表单字段。表单照着 `form` 渲染，所以不同预设的配置页长得不一样，差异来自数据而不是界面里的 `if`：

```ts
// src/ai/providers.ts —— 内置提供商预设
{
  id: 'commandcode',
  chatPath: '/alpha/generate',
  authHint: '请求由主进程按 CLI 指纹发出（含 x-command-code-version）',
  form: [
    { key: 'apiKey',    label: 'API Key',    kind: 'password' },
    { key: 'baseUrl',   label: '接口地址',    kind: 'text' },
    { key: 'maxTokens', label: '单轮输出上限', kind: 'number', optional: true,
      hint: '网关硬上限是 64000，超过会被拒。' },
  ],
}

// src/ai/types.ts —— 兼容格式预设
anthropic: {
  chatPath: '/v1/messages',
  authHint: 'x-api-key: <Key> + anthropic-version: 2023-06-01',
  form: [
    { key: 'apiKey',  label: 'API Key',  kind: 'password' },
    { key: 'baseUrl', label: '接口地址',  kind: 'text',
      warning: 'Anthropic 官方默认不允许浏览器直连，本应用经主进程转发，因此可用。' },
    { key: 'apiVersion',   label: 'API 版本',   kind: 'text', optional: true },
    { key: 'extraHeaders', label: '额外请求头', kind: 'textarea', optional: true },
  ],
}
```

实际差异（都有断言覆盖）：

| 预设 | 表单字段 | 端点 |
| --- | --- | --- |
| DeepSeek | API Key · 接口地址 · 额外请求头 | `/chat/completions` |
| Moonshot / 智谱 / 百炼 / 硅基流动 / Gemini / xAI | API Key · 接口地址 | `/chat/completions` |
| OpenRouter | API Key · 接口地址 · 应用标识请求头 | `/chat/completions` |
| OpenAI | API Key · 接口地址 · 组织/项目请求头 | `/chat/completions` |
| Command Code Go | API Key · 接口地址 · **单轮输出上限** | `/alpha/generate` |
| 自定义 · OpenAI 兼容 | API Key · 接口地址 · 额外请求头 | `/chat/completions` |
| 自定义 · Anthropic 兼容 | API Key · 接口地址 · **API 版本** · 额外请求头（+ 安全警示）| `/v1/messages` |
| 自定义 · Responses 兼容 | API Key · 接口地址 · **API 版本** · 额外请求头 | `/responses` |

界面还会按预设显示该家的**鉴权方式**、**实际请求地址**与**申请 Key 的入口**。

## 提供商分两层：内置 / 自定义，以及兼容格式

别把两件事混在一起——**谁提供配置**（内置 or 自定义）与**线上怎么说**（兼容格式）是正交的：

**1. 内置提供商**（`src/ai/providers.ts` 的 `PROVIDERS`）

上表这些。开箱即在列表里，选中直接配置，用户不新建、不选协议。
绝大多数是 OpenAI 兼容，只有 Command Code Go 走它自己的私有网关。

**2. 自定义提供商**

接入中转、公司内网、本地 Ollama/vLLM 等。必须选一种**兼容格式**：

> **`http://` 的地址是能用的**（本地 Ollama / vLLM 与不少内网网关都是明文）。这一点原先
> 写坏了：代理把地址改写成 `llm-proxy://<host>/<path>`，而 `llm-proxy:` 不是 URL 规范里的
> special scheme，Chromium 解析它时**会把端口整个丢掉**、也分不出 http 还是 https ——
> 于是带端口或明文的地址一律撞「代理目标不在白名单内」。现在协议、主机、端口一起走查询串
> （见 `electron/proxy-core.ts` 的 `ORIGIN_PARAM`），白名单的单位也从 host 换成了完整的目标地址。
> 代价说清楚：走 `http` 的那一段链路，API Key 与内容是**明文**的——本地回环无所谓，
> 填内网地址前先确认那是你信得过的网络。

| 兼容格式 | 端点 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| **OpenAI 兼容** | `POST {base}/chat/completions` | `Authorization: Bearer` | 最常见，绝大多数服务与自建网关都是它 |
| **Anthropic 兼容** | `POST {base}/v1/messages` | `x-api-key` + `anthropic-version` | Claude 官方格式；部分中转也提供这一路 |
| **Responses 兼容** | `POST {base}/responses` | `Authorization: Bearer` | OpenAI 新一代接口，只有明确支持的服务才选 |

三种格式的差异不止路径，请求体与事件流都不一样，因此各有一套实现：

| 维度 | OpenAI 兼容 | Anthropic 兼容 | Responses 兼容 |
| --- | --- | --- | --- |
| 系统提示词 | messages 里一条 | 顶层 `system` | 顶层 `instructions` |
| 内容 | `content` 字符串 | `content` 块数组 | `input` 项数组 |
| 工具声明 | `function.parameters` | `name` + `input_schema` | 顶层 `parameters` |
| 工具调用 | `assistant.tool_calls` | `tool_use` 块 | 独立 `function_call` 项 |
| 工具结果 | role:`tool` | user 里的 `tool_result` 块 | 独立 `function_call_output` 项 |
| 流式 | `data:` 帧 | 命名事件 `content_block_delta` | 命名事件 `output_text.delta` |
| 终态 | `finish_reason` | `stop_reason` | `response.completed` |

历史里只存**中立的图片片段**（`src/ai/content.ts` 负责翻译成各家的 `image_url` /
`source.base64` / `input_image`），所以换提供商不必改写历史，前缀缓存因此不受影响。

## 配置结构：多提供商 × 多模型，思考程度全局

```
providers: [                        全局（所有 AI 功能的共同基底）
  { id, compat?, label, baseUrl,      global: {
    apiKey,                             providerId,   // 当前用哪家
    models: [                           model,        // 当前用哪个模型
      { id,            // 模型 ID      effort,       // 思考程度：low/high/max
        name,          // 模型名称    }
        contextWindow, // 模型上下文（token）
        inputModalities: ['text','image','audio'] },
    ] },
]
```

- **思考程度是全局的**，不绑提供商也不绑模型；它与模型列表同级，改一处即对所有 AI 功能生效
  （超级导师、描述、释义、出题阅卷）
- **一个提供商可以配多个模型**，每个模型带 名称 / ID / 上下文 / 多模态能力；第一个即该提供商的
  默认模型。这些元信息用于展示与选择
- 每个提供商独立保存 Key、接口地址与模型，互不覆盖

老版本设置（v1 的 `apiKey`/`chatModel`、v2/v3 的字符串模型列表）加载时**自动迁移**，
Key 与自定义模型都不会丢；字符串模型会补上默认元信息。

- **参数差异**：`max_completion_tokens`、`reasoning_effort`、思维链字段
  `reasoning_content` / `reasoning`、额外请求头等，内置的收敛在预设的 `quirks` 里

## 思考程度与 Agent 循环

- **思考程度**三档 `low / high / max`，默认 `max`，**是全局设置**——不绑提供商也不绑模型，
  与模型列表同级。OpenAI 兼容与 Command Code 发 `reasoning_effort`，Anthropic 换算成
  `thinking.budget_tokens`，Responses 换算成 `reasoning.effort`；不认该字段的服务可在
  预设里用 `omitReasoningEffort` 关掉。设置页与 agent 栏右下角都能改。
- **Agent 循环不设轮次上限**：循环只在模型自己停下、出错或用户点「停止」时结束。
  早期版本有 12 轮硬上限，长任务（写大纲 → 逐个展开 → 出题）会中途被截断。
- **单轮输出不设上限**：不向服务端发送 `max_tokens`，把长度交给模型/服务的默认值，
  避免我们这边的上限先于模型自己的收尾把输出截断。（Command Code 网关侧硬上限是
  64000，超出会被拒，因此那里仍会压回该值。）

## Command Code Go 套餐

Command Code 把订阅分成两种，差别不只是「套餐大小」：

1. **Provider API** —— 标准 OpenAI 兼容端点，任何客户端可直连；
2. **Go 套餐** —— **没有 Provider API 权限**，调标准端点会返回 `403 upgrade_required`，
   只能走官方 CLI 的私有网关 `POST /alpha/generate`。

因此 Go 套餐在本项目里走一套独立协议（`src/ai/commandcode.ts`），而不是硬塞进 OpenAI 客户端。
它与 OpenAI 的差异是全方位的：

| 维度 | OpenAI 兼容 | Command Code 网关 |
| --- | --- | --- |
| 端点 | `/chat/completions` | `/alpha/generate` |
| 请求体 | 扁平 | 信封：`config` / `memory` / `taste` / `skills` / `permissionMode` / `params` |
| 系统提示词 | messages 里的一条 | `params.system` 字符串 |
| 工具声明 | `function.parameters` | 顶层 `input_schema` |
| 工具调用 | `tool_calls[]` + `tool_call_id` | `{type:'tool-call',toolCallId,toolName,input}` |
| 工具结果 | role: `tool` 一条 | `{type:'tool-result',…,output:{type,value}}` |
| 流式 | SSE `data:` 帧 | NDJSON，每行一个裸 JSON 对象 |
| 终态 | `finish_reason` | `finish-step` / `finish` 事件 |

协议实现对齐官方 CLI（`x-command-code-version`、`x-cli-environment`、`x-taste-learning`、
`x-session-id`、`x-project-slug` 请求指纹，以及 NDJSON 事件流）。

几个必须照做的细节，都已实现并有断言覆盖：

- **单轮输出上限压到 64000**：网关侧上限就是它，runtime 的 128K 默认值在这里会被压回来；
- **孤儿工具调用要丢掉**：assistant 声明了 tool-call 却没有对应结果时，网关返回
  `Tool result is missing for tool call …` 并中断整轮，因此回填历史前先按结果集合过滤；
- **空的工具结果要兜底**：`output.value` 为空串会被当成缺失，统一补 `(no output)`；
- **`finish` 与 `finish-step` 都算终态**：某些路由只发 `finish`，只认 `finish-step`
  会把完整回答误判成截断；
- **`error` / `abort` 事件要带出真实原因**，否则用户只会看到一句「流意外结束」；
- **模型目录按 Go 套餐筛选**：`/provider/v1/models` 免鉴权但会列出套餐外的 premium 模型，
  选了会被网关拒绝。

要拿到 Key：用官方 `cmd` CLI 登录（`cmd login`）后在 Studio 里取，形如 `user_…`。

### 为什么必须经主进程转发（实测结论）

网关要求 `x-command-code-version` 请求头，而它的跨域预检只放行
`Content-Type,Authorization`——浏览器发不出这个头：

| 请求 | 结果 |
| --- | --- |
| 浏览器直连 | 跨域失败，`Failed to fetch` |
| 不带该头的裸请求 | `403 upgrade_required`（版本门禁） |
| 带上该头 | 通过门禁，网关转入鉴权与请求体处理 |
| 冒充 CLI 的 `User-Agent` | **与门禁无关**，实测无差别 |

这正是本项目从「纯前端」改成 Electron 的直接原因：主进程发请求没有跨域与请求头限制，
`llm-proxy://` 转发把这个问题从根上消掉了——不再需要任何外部代理进程，接口地址保持官方地址即可。

实测（真实 Electron 运行时）：经主进程转发拉取 `/provider/v1/models` 返回 **200 + 69 个模型**；
带完整指纹头 POST `/alpha/generate` 返回 `400 BAD_REQUEST`（网关开始校验请求体），
说明版本门禁已通过。

> 请求指纹对齐官方 CLI 是接入的**前提**而非绕过手段。官方限制第三方接入，此类接入属于个人使用
> 范畴，请自行遵守 Command Code 服务条款。
> 参考实现：[Ajwyunsx/dsh-cmdgo-provider](https://github.com/Ajwyunsx/dsh-cmdgo-provider)（非官方）。
