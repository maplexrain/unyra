/**
 * 工具调用气泡：一步工具调用（现在只剩 execute，外加历史会话里的老工具名）。
 *
 * **无壳**：没有边框与底色，与思考气泡同一套素面规矩——折叠着显示标题与状态，
 * 展开看代码与结果；高度过渡走 moji-fold，内容的挂载时机见 useFold，底部给一个
 * 「收起」。它要么是消息组（MessageBubble 的 ProcessGroup）里的嵌套件，要么
 * 落单独立成条。工具顺带看过的图不进折叠区——「它到底看了哪张图」是这一步
 * 最该让人看见的事。
 * 参数与旁白的排版在 toolArgsView.tsx，标题翻译在 toolLabel.ts，图片组件在 Images.tsx。
 */

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Wrench } from 'lucide-react'
import type { AgentPart, MessageImage } from '../../../agent/types'
import CodePane from '../CodePane'
import { toolResultView } from '../../../lib/toolView'
import { BubbleImage, ImageLightbox } from './Images'
import { MetaLines, paramOf } from './toolArgsView'
import { toolLabel } from './toolLabel'
import { useFold } from './useFold'
import { t } from '../../../i18n'

export function ToolCard({ part }: { part: Extract<AgentPart, { type: 'tool' }> }) {
  const { open, shown, toggle } = useFold()
  const [preview, setPreview] = useState<MessageImage | null>(null)
  const running = part.status === 'running'
  const param = useMemo(() => paramOf(part), [part])
  const result = useMemo(() => (part.result ? toolResultView(part.result) : null), [part.result])

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 py-0.5 text-left text-[12.5px] text-ink-soft transition hover:text-ink"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {running ? (
          <Loader2 size={12} className="animate-spin text-seal-deep" />
        ) : (
          <Wrench size={12} className={part.status === 'error' ? 'text-seal' : 'text-ok-text'} />
        )}
        <span className={'font-medium ' + (part.status === 'error' ? 'text-seal' : '')}>
          {toolLabel(part.name, part.args)}
        </span>
        <span className="ml-auto truncate text-[11.5px] text-ink-faint">
          {running ? t('执行中') : part.status === 'error' ? t('失败') : t('完成')}
        </span>
      </button>
      {/*
        工具附带回的图片（Agent 用 res.read 看了一张图）。折叠着也显示：
        「它到底看了哪张图」是这一步最该让人看见的事，藏进展开区等于没显示。
      */}
      {!!part.images?.length && (
        <div className="flex flex-wrap gap-1.5 py-1.5">
          {part.images.map((img) => (
            <BubbleImage key={img.id} image={img} onOpen={() => setPreview(img)} />
          ))}
        </div>
      )}
      <div className={'moji-fold' + (open ? ' moji-fold-open' : '')}>
        <div>
          {shown && (
            <>
              {param && (
                <div className="py-1.5">
                  <div className="mb-1 text-[11.5px] uppercase tracking-wider text-ink-faint">
                    {part.name === 'execute' ? t('代码') : t('参数')}
                  </div>
                  <CodePane text={param.text} lang={param.lang} />
                </div>
              )}
              {!running && result && (
                <div className="py-1.5">
                  <div className="mb-1 text-[11.5px] uppercase tracking-wider text-ink-faint">{t('结果')}</div>
                  {result.lead && <MetaLines text={result.lead} className="mb-1.5" />}
                  {result.body && (
                    <CodePane text={result.body} lang={result.lang} wrap={result.lang === 'text'} />
                  )}
                  {result.tail && <MetaLines text={result.tail} className="mt-1.5" />}
                </div>
              )}
              <button
                type="button"
                onClick={toggle}
                className="py-0.5 text-[12px] text-ink-faint transition hover:text-ink-soft"
              >
                {t('收起')}
              </button>
            </>
          )}
        </div>
      </div>
      {preview && <ImageLightbox image={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
