/**
 * useAgent 一轮的**入口组装**（从 useAgent.ts 原样搬出）：把当轮用户消息与该补发的
 * 各路「感知注入」拼进会话——导师人格、文档格式策略、用户画像、技能清单、MCP 服务清单。
 *
 * 共同纪律（各模块顶部还有详细说明）：都不进系统提示词，而是作为**中途插进历史的
 * 一条 user 消息**排在当轮用户消息之前、只在队尾追加——前面的前缀照旧命中服务端缓存；
 * 一条对话里同一种注入只补一次（活消息上有 digest / 身份标记，变更是新 id 自然再补），
 * 被压缩折掉（retired）之后自动补回来。
 */

import type { Conversation, ConversationMessage, MessageFile, MessageImage, MessageQuote } from '../../agent/types'
import { loadAgentSettings, type AgentSettings } from '../../agent/settings'
import { buildTeacherSystem } from '../ai'
import { needsPersonaAnnounce, personaMessage } from '../../agent/persona'
import { needsDocFormatAnnounce, docFormatMessage } from '../../agent/docFormat'
import { needsUserInfoAnnounce, userInfoMessage } from '../../agent/userInfo'
import { getActiveSkills, getSkillsDigest, needsSkillsAnnounce, skillsAnnounceMessage } from '../../agent/skill/registry'
import { getMcpDigest, mcpAnnounceMessage, needsMcpAnnounce } from '../../agent/mcp/announce'
import { activeProfile } from '../../user/store'
import { storageAbsPath } from '../../lib/storage'

/**
 * 组装这一轮的入口：转存好的附件 + 当轮用户消息 + 各路感知注入，一并拼进会话
 * （inflight 在途标记在这里挂上）。返回更新后的会话（调用方负责 persist 与起名）、
 * 现取的 agent 设置（工具装配还要用它取 MCP 配置）与固化下来的系统提示词。
 */
export function assembleTurnEntry(io: {
  /** 已 trim 的用户输入 */
  trimmed: string
  hidden: boolean
  mark?: string
  wfParams?: Record<string, string | number>
  context?: string
  quote?: MessageQuote
  attached: { images: MessageImage[]; error?: string }
  attachedFiles: { files: MessageFile[]; error?: string }
  /** 这一轮回复的固定 id：inflight 标记与流式槽都按它认领 */
  assistantId: string
  /** 目标会话（载入的那份；不存在时是调用方现场建的空会话） */
  conv: Conversation
}): { conv: Conversation; agentSettings: AgentSettings; teacherSystem: string } {
  const { trimmed, hidden, mark, wfParams, context, quote, attached, attachedFiles, assistantId } = io
  let conv = io.conv
  /**
   * **节点上下文不再自动注入**（2026-10-23 的架构决定）：「当前学习目标 / 目标规划 /
   * 当前节点 / 写入目标」那几行曾经每轮拼进消息——它是随节点与进度**每轮都在变**的
   * 内容，不属于任何一边（既不是固定的提示词，也不是当次的指令），还会在新对话的
   * 第一条指令前面垫上一大块，把指令本身覆盖掉。现在：
   * - 沙箱的「当前节点」语义照旧（省略 path 的 doc.write / outline.write 落在
   *   target.nodeId 上，宿主解析，模型不必知道路径）；
   * - 模型需要目标 / 节点 / 规划状态时**自己去查**：api.node.list()（回执带 current
   *   与全部节点）、节点对象 content；
   * - 调用方真正要交给模型的**当次参数**（画布的目标项定位、选段位置）仍走 context
   *   参数——那是指令的一部分，不是会变的背景。
   */
  const extraContext = context?.trim()
  const userMsg: ConversationMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: trimmed }],
    ts: Date.now(),
    hidden,
    /*
     * 带 mark 的隐藏轮就是**工作流指令**（runWorkflow 把工作流名当 mark 传下来，
     * runHidden 那几个动作同理）：界面上画一条分界条，定位条给它一个锚点。
     * 提示词注入（人格 / 格式 / 技能库 / 模块）自己带 inject: 'prompt'，不走这里——
     * 两者从前混在一条分界条上，几条一起注入时那行字会被挤爆（见 agent/messageKind）。
     */
    ...(hidden && mark ? { mark, inject: 'instruction' as const } : {}),
    // 工作流的启动实参：界面的分界条展开时画参数行、并高亮指令里对应的文字
    ...(hidden && mark && wfParams ? { wfParams } : {}),
    // 只带调用方给的当次参数（选段位置 / 画布意图）；节点背景不再自动注入（见上面的说明）
    ...(extraContext ? { context: extraContext } : {}),
    ...(quote ? { quote } : {}),
    ...(attached.images.length ? { images: attached.images } : {}),
    ...(attachedFiles.files.length ? { files: attachedFiles.files } : {}),
  }
  /*
   * 导师人格：这一段对话里还没交代过（或那条已经被压缩掉）时，先补一条隐藏指令。
   *
   * 它是**中途插进历史的一条 user 消息**，不是系统提示词的一部分——所以换人格只影响
   * 它之后的内容，前面的前缀照旧命中服务端缓存（见 agent/persona 顶部那段说明）。
   * 一条对话里同一个人格只补一次；人格变了就是新 id，自然再补一次。
   */
  const agentSettings = loadAgentSettings()
  const personaId = agentSettings.persona
  /*
   * 系统提示词固化进对话（见 agent/types 的 Conversation.systemPrompt）：第一次请求
   * 抓一份、之后每一轮都用固化的那份，不再每轮现拼。老数据没有这个字段——在这里
   * 现场抓一份补上，随下面 conv 组装后的 persist 一并落盘，之后与新数据完全一致。
   */
  let teacherSystem = conv.systemPrompt
  if (!teacherSystem) {
    teacherSystem = buildTeacherSystem({
      // 画像**不在这里传**：导师要贴合这个人时自己 api.userInfo.get() 取（见 ai 的说明）
      extraSystemPrompt:
        agentSettings.extraSystemPromptEnabled && agentSettings.extraSystemPrompt?.trim()
          ? agentSettings.extraSystemPrompt.trim()
          : undefined,
    })
    conv = { ...conv, systemPrompt: teacherSystem }
  }
  const announcer = needsPersonaAnnounce(conv.messages, personaId)
    ? [personaMessage(personaId, Date.now(), crypto.randomUUID(), agentSettings.customPersonas)]
    : []

  /*
   * 文档格式策略：与人格同一位置、同一条纪律（见 agent/docFormat）——
   * 一条对话里同一种格式只补一次；格式变了就是新 id，自然再补一次；
   * 被压缩掉（retired）之后自动补回来。
   */
  const formatAnnouncer = needsDocFormatAnnounce(conv.messages, agentSettings.docFormat)
    ? [docFormatMessage(agentSettings.docFormat, Date.now(), crypto.randomUUID(), agentSettings.customDocFormats)]
    : []

  const userInfoAnnouncer = needsUserInfoAnnounce(conv.messages)
    ? [userInfoMessage(activeProfile(), Date.now(), crypto.randomUUID())]
    : []

  // 动态技能清单注入：不在系统提示词中硬编码，而在消息流中按需注入与变更更新（保持前缀缓存稳定）
  const activeSkills = getActiveSkills(agentSettings.skills)
  const currentSkillsDigest = getSkillsDigest(activeSkills)
  const hasPreviousSkillsAnnounce = conv.messages.some((m) => !m.retired && m.skillsDigest !== undefined)
  const skillsAnnouncer = needsSkillsAnnounce(conv.messages, currentSkillsDigest)
    ? [
        skillsAnnounceMessage(
          activeSkills,
          storageAbsPath('skills') ?? undefined,
          Date.now(),
          crypto.randomUUID(),
          currentSkillsDigest,
          hasPreviousSkillsAnnounce,
        ),
      ]
    : []

  // MCP 感知注入：与技能发现层同一套机制（隐藏消息 + digest 变更重注入）。
  // 主观能动性的前提是知情——agent 不知道有哪些外部服务，就不会在任务需要时想到它们
  const currentMcpDigest = getMcpDigest(agentSettings.mcp)
  const hasPreviousMcpAnnounce = conv.messages.some((m) => !m.retired && m.mcpDigest !== undefined)
  const mcpAnnouncer = needsMcpAnnounce(conv.messages, currentMcpDigest)
    ? [
        mcpAnnounceMessage(
          agentSettings.mcp,
          Date.now(),
          crypto.randomUUID(),
          currentMcpDigest,
          hasPreviousMcpAnnounce,
        ),
      ]
    : []

  conv = {
    ...conv,
    messages: [
      ...conv.messages,
      ...announcer,
      ...formatAnnouncer,
      ...userInfoAnnouncer,
      ...skillsAnnouncer,
      ...mcpAnnouncer,
      userMsg,
    ],
    updatedAt: Date.now(),
    // 在途标记：这一轮没收口（进程被杀）时，载入恢复据此找到这条回复（见 learn/agent/inflight）
    inflight: { messageId: assistantId, startedAt: Date.now() },
  }
  return { conv, agentSettings, teacherSystem }
}
