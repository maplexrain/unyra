/**
 * 聊天气泡里的富文本：Markdown、@角色与 URL。
 *
 * 消息正文来自用户或 agent，不能直接当纯文本画；这里统一：
 * - 走应用既有的 renderNote（marked + KaTeX + DOMPurify），保留 **粗体 / 斜体 / 代码 /
 *   列表 / 链接** 等常见语法；
 * - `@名字` 转成可点击的 mention 链接（点击只做定位提示，不触发导航）；
 * - 裸 URL 和 Markdown 链接都走系统浏览器打开，避免聊天窗把整个应用导航走。
 *
 * 单独成组件，让 RoleChatView 与 GroupChatPanel 用同一套气泡排版，避免两处解析漂移。
 */
import { useMemo } from 'react'
import type { MouseEvent } from 'react'
import { isExternalHref, openWebLink } from '../../../lib/externalLink'
import { bubbleMarkdownSource, MENTION_SCHEME } from '../../../lib/bubbleMarkdown'
import { renderNote } from '../../../lib/markdown'

/** 气泡正文的富文本渲染 */
export function BubbleRichText({
  text,
  names = [],
  tone = 'agent',
  onMention,
}: {
  text: string
  /** 可被 @ 的角色名（profile 名 + 默认名） */
  names?: string[]
  /** 用户气泡与 agent 气泡都用亮底，但用户更亮；链接/代码只做轻微色差，保证可读 */
  tone?: 'user' | 'agent'
  /** 点击 @ 角色时的回调；不传则只阻止导航 */
  onMention?: (name: string) => void
}) {
  const html = useMemo(() => renderNote(bubbleMarkdownSource(text, names)), [text, names])

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (href.startsWith(MENTION_SCHEME)) {
      e.preventDefault()
      onMention?.(decodeURIComponent(href.slice(MENTION_SCHEME.length)))
      return
    }
    if (isExternalHref(href)) {
      e.preventDefault()
      openWebLink(href)
    }
  }

  const toneClass =
    tone === 'user'
      ? '[&_a]:text-sky-700 [&_code]:bg-line/40 [&_code]:text-ink-strong [&_blockquote]:border-line-strong'
      : '[&_a]:text-seal [&_code]:bg-line/55 [&_code]:text-ink-strong [&_blockquote]:border-line-strong'

  return (
    <div
      className={
        'bubble-rich text-[13px] leading-relaxed break-words select-text ' +
        '[&_p]:my-0 [&_p+p]:mt-2 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 ' +
        '[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 ' +
        '[&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] ' +
        '[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/10 [&_pre]:p-2 ' +
        '[&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:text-[12.5px] ' +
        '[&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-2 ' +
        '[&_h1]:my-1 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h2]:my-1 [&_h2]:text-[14px] [&_h2]:font-semibold ' +
        '[&_h3]:my-1 [&_h3]:text-[13.5px] [&_h3]:font-semibold ' +
        toneClass
      }
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
