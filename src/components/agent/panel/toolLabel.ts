/**
 * 工具卡片的标题：把工具名与参数翻成一句人话。
 *
 * 从 AgentPanel 搬出来（原本就住在那张卡片旁边），这里只有纯函数，没有 React。
 */

import { t } from '../../../i18n'

/**
 * 工具卡片的标题。
 *
 * 现在只剩一个 execute，光显示「执行代码」等于什么都没说；它的 description
 * 参数本来就是给这一步起的名字，直接拿来当标题。旧会话里存着改造前的工具名，
 * 映射表因此保留——历史消息也要能看懂。
 */
const LEGACY_TOOL_LABEL: Record<string, string> = {
  /* 中文标签在使用处经 t() 翻译（键即这里的中文原文，登记在 src/i18n/en/agent-ui.ts） */
  'note:read': '读取笔记',
  'note:read_range': '读取笔记片段',
  'note:replace': '更新笔记',
  'note:append': '追加内容',
  'description:read': '读取描述',
  'description:update': '更新描述',
  'exam:create': '生成试卷',
  'exam:read': '读取试卷',
  'exam:grade': '提交阅卷',
  note: '笔记',
  description: '描述',
  exam: '试卷',
  read_note: '读取笔记',
  read_note_range: '读取笔记片段',
  update_note: '更新笔记',
  update_note_range: '局部修改笔记',
  append_note: '追加内容',
  read_description: '读取描述',
  update_description: '更新描述',
  create_exam: '生成试卷',
  read_exam: '读取试卷',
  grade_exam: '提交阅卷',
}

/** 工具参数在流式过程中可能还不完整，解析失败就当作没有 */
function toolArgs(args: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(args)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function toolLabel(name: string, args: string): string {
  const parsed = toolArgs(args)
  if (name === 'execute') {
    const what = String(parsed.description ?? '').trim()
    return what || t('执行代码')
  }
  const action = String(parsed.action ?? '')
  const key = action ? name + ':' + action : name
  const label = LEGACY_TOOL_LABEL[key] ?? LEGACY_TOOL_LABEL[name]
  if (label) return t(label)
  return action ? name + ' · ' + action : name
}
