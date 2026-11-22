/**
 * 对外 MCP 服务的**工具清单单一事实源**：主进程 electron/mcp/serve 的 tools/list
 * 与渲染层 src/agent/mcp/serveHost 的分发共用这一份，两处不许各抄一遍。
 * （shared/ipc.ts 只放类型，运行时值按约定住这个独立文件。）
 *
 * 为什么只有两个工具、而不是把沙箱 api 展开成几十上百个 MCP 工具：应用自己的
 * agent 就是「单工具 execute」哲学——外部 harness 写一段 JS 编排，一次拿回全部
 * 开放能力；api_manual 与沙箱里的 __help() 同源（apiRegistry 渲染），文档零重写。
 * 展开成百工具会撑爆 harness 的上下文、还要双处维护，薄桥最划算。
 *
 * 边界：guest 会话只开放与子代理同级的 api 组（web/tmp/res/node/memory/workspace，
 * 见 serveHost 的 MCP_ALLOWED_GROUPS）；ask/ui/exam/permission/wf/subagent/mcp
 * 这些「导师层」的能力不对外——要开放得先有对应的审批面。
 */

export interface McpServeToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** 与 electron/mcp/stdio（客户端侧）同一版：各家 SDK 都认 */
export const MCP_SERVE_PROTOCOL_VERSION = '2024-11-05'

export const MCP_SERVE_TOOLS: McpServeToolDef[] = [
  {
    name: 'execute',
    description:
      '执行一段 JS/TS 编排来操作归一 Unyra（本地优先的 AI 学习应用）的学习数据。' +
      'api 只开放了本会话授权的组：api.node.*（节点宇宙：list/get/create/delete 与内容读写、连线）、' +
      'api.memory.*、api.workspace.*、api.web.*、api.tmp.*。' +
      'body 是匿名函数源码，形如 ((api)=>{ ... return 结果 })，可直接写 TypeScript、可用 await；' +
      '返回值折成纯数据回给你（超长截断，中间数据用 api.tmp.set 暂存）。' +
      '每个组、每条 api 都挂着 __help()：先 await api.<组>.__help() 看有哪些 api，' +
      '再 await api.<组>.<api>.__help() 看签名、参数与示例；节点对象先 const n = await api.node.get(uuid)，' +
      '再 await n.help() 看它的内容格式与连接规则（动态的，别凭记忆写）。' +
      '写操作的失败不抛异常：返回值是 { ok:false, content:"哪一步没做成、怎么改" }，' +
      '并汇总在结果最前面的「没有生效」清单里——判断成败看清单，不要用 try/catch。',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: '这段代码要做什么（一句话，会显示在应用界面上）' },
        body: { type: 'string', description: '匿名函数源码：((api)=>{ ... return 结果 })，可用 await，可直接写 TypeScript' },
      },
      required: ['body'],
      additionalProperties: false,
    },
  },
  {
    name: 'api_manual',
    description:
      '现查沙箱 api 的用法手册（与应用沙箱里的 __help() 同一份注册表渲染）。' +
      'target 省略或 "root" → 总览（有哪些组）；"node" 这类组名 → 该组有哪些 api 与组用法；' +
      '"node.get" 这类全名 → 签名、参数、返回与可运行示例。动手前先查，不要凭记忆猜 api。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '省略或 root=总览；组名（如 node）；或 api 全名（如 node.get）' },
      },
      additionalProperties: false,
    },
  },
]
