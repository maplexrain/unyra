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

import { useMemo } from 'react'
import type { AgentPart } from '../../../agent/types'
import { executeArgs, formatJs } from '../../../lib/toolView'
import MarkdownView from '../../MarkdownView'
import { renderNote } from '../../../lib/markdown'

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
  if (part.name === 'rexecute') {
    try {
      const parsed = JSON.parse(part.args) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') {
        const pattern = parsed.pattern ?? parsed.search ?? parsed.find
        const replacement = parsed.replacement ?? parsed.replace ?? parsed.new
        if (typeof pattern === 'string') {
          const flags = typeof parsed.flags === 'string' ? parsed.flags : 'g'
          const rep = typeof replacement === 'string' ? replacement : ''
          return {
            text: `// 正则替换规则\ns/${pattern}/${rep}/${flags}`,
            lang: 'javascript',
          }
        }
        return { text: JSON.stringify(parsed, null, 2), lang: 'json' }
      }
    } catch {
      // 参数非法时原样展示
    }
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
 * 结果里那些"关于这次调用"的说明（调了哪些 api、日志、哪几次没生效等）。
 *
 * 采用 Markdown 解析渲染，不再使用双斜杠模仿注释，支持加粗、列表等格式优雅呈现。
 * 展开体走 moji-md-soft：与折叠行同一档的小字暗色——它是旁注，不是正文。
 */
export function MetaLines({
  text,
  className = '',
  mdClassName = 'moji-md-soft',
}: {
  text: string
  className?: string
  /** 换 markdown 根类的变体（moji-md-plain = 颜色听外层的，给要染色的头行用） */
  mdClassName?: string
}) {
  const html = useMemo(() => renderNote(text), [text])
  return (
    <div className={'break-words text-[12px] leading-relaxed text-ink-soft ' + className}>
      <MarkdownView html={html} className={'moji-agent-md ' + mdClassName} />
    </div>
  )
}

/** 八角叉（octagon-x）的笔画：24×24、描边同 lucide 语言——「哪几次没生效」的标记 */
function OctagonX({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86Z" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  )
}

/** 扳手：与折叠标题的 Wrench 同一个图形语言，标记「这是关于这次调用的账」 */
function WrenchGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

/**
 * 调用级失败的清单头（原文见 sandbox/execute 的 failureHeader）。原文以 ⛔ 开头——
 * 那是写给模型的锚点，界面上换成 SVG 八角叉，行文染警示色加重。
 * 黄底黄框退役：旁注不该比正文更抢眼，「没生效」这件事交给字色与字重说。
 */
export function SoftLead({ text }: { text: string }) {
  const nl = text.indexOf('\n')
  const first = (nl < 0 ? text : text.slice(0, nl)).trim().replace(/^⛔\s*/, '')
  const rest = nl < 0 ? '' : text.slice(nl + 1).trim()
  return (
    <div className="mb-1.5">
      <div className="flex items-start gap-1.5">
        <span className="mt-[2px] shrink-0 text-warn">
          <OctagonX />
        </span>
        <MetaLines text={first} className="font-medium text-warn-deep" mdClassName="moji-md-plain" />
      </div>
      {rest && <MetaLines text={rest} className="mt-0.5" />}
    </div>
  )
}

/** 尾部统计行的口径（sandbox/execute 的 whatHappened）：调了什么、共几次、几次没生效 */
const CALL_SUMMARY = /^本次调用：(.+?)（共 (\d+) 次(?:，其中 (\d+) 次没有生效)?）$/

/**
 * 尾部的调用统计：「调了什么、共几次、几次没生效」是这一步最该被看见的账——
 * 单独解析成一行摘要，api 名与总次数加重，没生效的次数染警示色；
 * 其余尾巴（日志、附图说明）照旧走 MetaLines。解析不动（口径变了）就整体退回普通渲染。
 */
export function CallSummary({ text }: { text: string }) {
  const line = text.split('\n').find((l) => l.trim().startsWith('本次调用：'))
  const m = line ? CALL_SUMMARY.exec(line.trim()) : null
  if (!line || !m) return <MetaLines text={text} />
  const rest = text
    .split('\n')
    .filter((l) => l !== line)
    .join('\n')
    .trim()
  return (
    <div className="mt-1.5">
      {/* 这一行是模型可见回执的原话（whatHappened 的产出），照文重排，不过翻译 */}
      <div className="flex items-center gap-1.5 text-[11.5px] leading-relaxed text-ink">
        <span className="shrink-0 text-ink-faint">
          <WrenchGlyph />
        </span>
        <span>
          本次调用：<span className="font-semibold">{m[1]}</span>
          {'（共 '}
          <span className="font-semibold tabular-nums">{m[2]}</span>
          {' 次'}
          {m[3] && (
            <>
              {'，其中 '}
              <span className="font-semibold text-warn-deep tabular-nums">{m[3]}</span>
              {' 次没有生效'}
            </>
          )}
          {'）'}
        </span>
      </div>
      {rest && <MetaLines text={rest} className="mt-0.5" />}
    </div>
  )
}
