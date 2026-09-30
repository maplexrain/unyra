/**
 * 工具卡片里「参数长什么样」与「旁白怎么排」这两件纯展示逻辑。
 *
 * 从 ToolCard.tsx 搬出来（那边只留组件）：两者都与折叠状态无关——paramOf 是纯函数，
 * MetaLines 是它那行旁白的排法，拆开只会多一个没人读的文件。
 *
 * eslint-disable-next-line react/only-export-components -- 这一条 fast-refresh 警告说的正是
 * 上面这件事：本文件同时导出一个纯函数与一个小展示件。两者的调用方都只有 ToolCard，
 * 为绕开这条规则再拆一个文件属于「为了拆而拆」（见 docs/refactor-plan.md 第 2 节第 3 条）。
 */

import type { AgentPart } from '../../../agent/types'
import { executeArgs, formatJs } from '../../../lib/toolView'

/**
 * 工具卡片的参数：execute 显示那段 JS 源码，其余（改造前留下的老工具名）仍是参数 JSON。
 *
 * execute 的参数是 { description, body } 两件：description 已经当标题了，正文里再摆一遍
 * 就是同一句话说两次；真正要看的是 body 那段代码——所以这里只给它，并且排好版、上好色。
 */
// eslint-disable-next-line react/only-export-components
export function paramOf(part: Extract<AgentPart, { type: 'tool' }>): { text: string; lang: string } | null {
  if (part.name === 'execute') {
    const text = formatJs(executeArgs(part.args).body)
    return text ? { text, lang: 'javascript' } : null
  }
  try {
    const parsed = JSON.parse(part.args) as Record<string, unknown>
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.content === 'string') return { text: parsed.content, lang: 'text' }
      return { text: JSON.stringify(parsed, null, 2), lang: 'json' }
    }
  } catch {
    // 参数非法时原样展示
  }
  return part.args ? { text: part.args, lang: 'text' } : null
}

/**
 * 结果里那些"关于这次调用"的话（调了哪些 api、日志、哪几次没生效）渲染成注释。
 *
 * 它们不是返回值，是旁白。与返回值混在一段里，读的人分不清哪句是数据、哪句是说明；
 * 排成 // 开头的一行行（颜色取自代码主题的注释色），一眼就分得开。
 */
export function MetaLines({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={'whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ' + className}>
      {text.split('\n').map((line, i) => (
        <div key={i} className="tok-comment">{'// ' + line}</div>
      ))}
    </div>
  )
}
