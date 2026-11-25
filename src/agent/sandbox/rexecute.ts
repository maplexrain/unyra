/**
 * 这个文件负责什么：rexecute 工具本体——重新执行最近一次 execute 或 rexecute，
 * 并在执行前通过正则（或字面量）局部替换代码内容，大幅减少 token 消耗与往返延迟。
 */
import type { AgentContext, AgentTool, AgentToolResult } from '../types'
import { clip } from './api'
import { asText } from './refs'
import type { SandboxCall } from './types'

export interface ExecutionState {
  lastBody: string
  lastDescription: string
  lastResult?: AgentToolResult
  lastCalls: SandboxCall[]
  lastFailure: string
}

export interface ReplaceRule {
  pattern: string
  replacement: string
  flags?: string
}

export interface ApplyResult {
  ok: boolean
  body: string
  count: number
  details: string[]
  error?: string
}

export const REXECUTE_PARAMETERS = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: '本次重新执行或修改的目的说明（简短一句话，会显示在界面工具卡片上）',
    },
    pattern: {
      type: 'string',
      description:
        '用于匹配原代码的正则表达式或目标字符串（支持正则语法，如未能匹配正则会自动尝试字面量精确匹配）。' +
        '若上次已有业务调用生效，用它定位并摘掉那些已执行的段落。',
    },
    replacement: {
      type: 'string',
      description:
        '替换后的新代码内容。已执行成功的调用不要原样保留（改为注释 / 删除 / 幂等判断）。' +
        '留空且未提供 replacements 时表示原样重跑——只有确认上次没有任何业务生效时才可这样用。',
    },
    flags: {
      type: 'string',
      description: '正则表达式修饰符，默认为 "g"（全局替换），可选 "i"、"m" 等',
    },
    replacements: {
      type: 'array',
      description: '多处批量替换规则列表。每一项包含 { pattern, replacement, flags? }，将按先后顺序依次替换；同样先摘掉已生效的调用',
      items: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '正则表达式或目标字符串' },
          replacement: { type: 'string', description: '替换后的新内容' },
          flags: { type: 'string', description: '修饰符，默认 "g"' },
        },
        required: ['pattern', 'replacement'],
      },
    },
  },
  additionalProperties: true,
}

/** 从工具参数中提取并归一化替换规则（容忍各类别名以提升对大模型的容错度） */
export function extractReplaceRules(args: Record<string, unknown>): ReplaceRule[] {
  const rules: ReplaceRule[] = []

  // 1. 优先检查 replacements / edits / patches 数组
  const list =
    args.replacements ??
    args.edits ??
    args.patches ??
    (Array.isArray(args.replace) ? args.replace : undefined)

  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const pat = asText(rec.pattern ?? rec.search ?? rec.find ?? rec.regex ?? rec.target ?? rec.old)
      const rep = asText(rec.replacement ?? rec.replace ?? rec.new ?? rec.to)
      const flags = rec.flags ? asText(rec.flags) : undefined
      if (pat) rules.push({ pattern: pat, replacement: rep, flags })
    }
    if (rules.length > 0) return rules
  }

  // 2. 检查单条 replace 对象
  if (args.replace && typeof args.replace === 'object' && !Array.isArray(args.replace)) {
    const rec = args.replace as Record<string, unknown>
    const pat = asText(rec.pattern ?? rec.search ?? rec.find ?? rec.regex ?? rec.target ?? rec.old)
    const rep = asText(rec.replacement ?? rec.replace ?? rec.new ?? rec.to)
    const flags = rec.flags ? asText(rec.flags) : undefined
    if (pat) rules.push({ pattern: pat, replacement: rep, flags })
    if (rules.length > 0) return rules
  }

  // 3. 检查顶层直接参数 (pattern / search / find / regex / target)
  const pat = asText(args.pattern ?? args.search ?? args.find ?? args.regex ?? args.target ?? args.old)
  if (pat) {
    const rep = asText(args.replacement ?? args.replace ?? args.new ?? args.to)
    const flags = args.flags ? asText(args.flags) : undefined
    rules.push({ pattern: pat, replacement: rep, flags })
  }

  return rules
}

/** 对源代码依次执行正则与字面量替换 */
export function applyReplacements(source: string, rules: ReplaceRule[]): ApplyResult {
  let current = source
  let count = 0
  const details: string[] = []

  for (let i = 0; i < rules.length; i++) {
    const { pattern, replacement, flags: rawFlags } = rules[i]
    if (!pattern) continue
    const flags = typeof rawFlags === 'string' && rawFlags ? rawFlags : 'g'
    let matched = false

    // 1. 尝试作为 RegExp 匹配
    try {
      const regex = new RegExp(pattern, flags)
      if (regex.test(current)) {
        regex.lastIndex = 0
        const next = current.replace(regex, replacement)
        matched = true
        count++
        details.push(`规则 ${i + 1}：正则 /${pattern}/${flags} 替换成功`)
        current = next
        continue
      }
    } catch {
      // pattern 含有无效正则语法（例如未配对括号、特殊符号未转义），回退字面量匹配
    }

    // 2. 回退字面量精确匹配
    if (current.includes(pattern)) {
      if (flags.includes('g') || !rawFlags) {
        current = current.split(pattern).join(replacement)
      } else {
        current = current.replace(pattern, replacement)
      }
      matched = true
      count++
      details.push(`规则 ${i + 1}：字面量匹配成功并替换`)
      continue
    }

    if (!matched) {
      return {
        ok: false,
        body: source,
        count,
        details,
        error:
          `第 ${i + 1} 处待替换内容未在原代码中找到。\n- 待替换目标：${pattern}\n` +
          '请仔细核对前次代码内容，确认匹配字面量或正则是否完全准确。',
      }
    }
  }

  return {
    ok: true,
    body: current,
    count,
    details,
  }
}

/** 创建与 execute 伴生共用上下文状态的 rexecute 工具 */
export function createRexecuteTool(
  state: ExecutionState,
  executeBody: (body: string, description: string, ctx?: AgentContext) => Promise<AgentToolResult>,
): AgentTool {
  return {
    name: 'rexecute',
    description:
      '重新执行最近一次 execute 或 rexecute 的代码。执行前支持传入 pattern 与 replacement 进行正则/字面量替换。' +
      '**当上次执行报错或需要局部修正时必须优先使用本工具**，无需重新发送整段长代码，极大节省 token 并加速执行，可连续调用直到执行成功为止。' +
      '⚠️ **重跑前必须先核对上次回执里的调用清单**：如果上次虽然整体报错 / 中途抛异常，但其中已有部分业务调用成功生效' +
      '（回执里该调用 ok:true，或文件已写、消息已发、状态已改），本次绝不能原样重跑——必须先用 pattern / replacement 把那些**已执行成功的调用摘掉**' +
      '（或补上幂等判断），只重跑失败的那一步及其之后的部分。整段原样重跑会重复写文件、重复发消息、重复加数据，造成不可逆的重复副作用。',
    parameters: REXECUTE_PARAMETERS,
    run: async (args, ctx) => {
      if (!state.lastBody) {
        return {
          ok: false,
          content:
            '无法执行 rexecute：当前会话中还没有执行过 execute 或 rexecute，没有可复用的前序代码。请先调用 execute 执行代码。',
        }
      }

      const rules = extractReplaceRules(args)
      const description =
        asText(args.description).trim() ||
        (state.lastDescription ? `重试：${state.lastDescription}` : '重新执行代码')

      if (rules.length === 0) {
        // 无替换规则，原样重新执行上次代码
        const result = await executeBody(state.lastBody, description, ctx)
        return {
          ...result,
          content: clip(`【rexecute 原样重跑】\n${result.content}`),
        }
      }

      const rep = applyReplacements(state.lastBody, rules)
      if (!rep.ok) {
        const preview = state.lastBody.length > 240 ? state.lastBody.slice(0, 240) + '...' : state.lastBody
        return {
          ok: false,
          content: `rexecute 替换未生效：\n${rep.error}\n\n当前保留的原代码前序预览：\n${preview}`,
        }
      }

      const result = await executeBody(rep.body, description, ctx)
      const headNotice = `【rexecute 替换重跑（已应用 ${rep.count} 处替换）】\n`
      return {
        ...result,
        content: clip(headNotice + result.content),
      }
    },
  }
}
