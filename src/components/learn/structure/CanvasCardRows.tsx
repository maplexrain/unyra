/**
 * 结构画布的卡片内容行与滚轮隔离容器：
 * - WheelStop：滚轮不冒泡到画布相机的隔离容器（项目卡目录树、浮层菜单共用）；
 * - VideoCardRow：视频卡的第二行（视频唯一标识输入框 / 固化后的标题行 + 生成总览）；
 * - FileCardRow：文件卡的第二行（响应式地址输入框 + 本地文件上传按钮）。
 * 供 CanvasCards 与 CanvasMenu 复用；与卡片的头部/目标项渲染（CanvasCards）分离。
 */

import { useEffect, useRef, useState } from 'react'
import type { HTMLAttributes } from 'react'
import { FolderOpen } from 'lucide-react'
import type { FileNodeKind, LearnStore } from '../../../learn/types'
import { uploadGoalFileWithHash } from '../../../learn/fileNodes'
import { t } from '../../../i18n'
import type { ChannelResult } from './canvasTypes'
import type { CardView } from './structureView'

/**
 * 滚轮隔离容器：内容自己滚动，滚轮事件**不冒泡**到画布（画布的滚轮是容器上的
 * 原生冒泡监听，React 合成事件的 stopPropagation 拦不住它——React 17+ 把委托
 * 挂在更外层的 root 上，事件先到画布容器）。项目卡的目录树与浮层菜单都用它。
 */
export function WheelStop({ className, style, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop)
    return () => el.removeEventListener('wheel', stop)
  }, [])
  return (
    <div ref={ref} className={className} style={style} {...rest}>
      {children}
    </div>
  )
}

/**
 * 节点宇宙中的文件节点内容行：两行结构中的第二行。
 * 一个响应式地址输入框（自动判断 local/web，无需提交按钮），内部右侧带选择本地文件按钮。
 * 上传先走 docs/{goal}/files/ 并计算 SHA-256 去重注册，若 title 未手动命名则自动填充文件名。
 */

export function VideoCardRow({
  card,
  store,
  goalId: _goalId,
  onUpdateVideoNode,
  onGenerateVideoDoc,
}: {
  card: CardView
  store: LearnStore
  goalId: string
  onUpdateVideoNode?: (nodeUuid: string, patch: { input?: string; title?: string; titleCustomized?: boolean }) => ChannelResult
  onGenerateVideoDoc?: (videoNodeUuid: string) => void
}) {
  const vNode = store.videoNodes?.find((v) => v.id === card.uuid)
  const isConfirmed = !!vNode?.confirmed
  const [val, setVal] = useState(vNode?.input ?? '')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    setVal(vNode?.input ?? '')
  }, [vNode?.input])

  const commitInput = (next: string) => {
    if (isConfirmed) return
    onUpdateVideoNode?.(card.uuid, { input: next.trim() })
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isConfirmed) return
    const next = e.target.value
    setVal(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      commitInput(next)
    }, 280)
  }

  const handleBlur = () => {
    if (isConfirmed) return
    if (timerRef.current) clearTimeout(timerRef.current)
    commitInput(val)
  }

  if (isConfirmed) {
    return (
      <div className="flex items-center justify-between gap-1.5 px-3 pb-2 select-none">
        <span
          title={card.subtitle || val}
          className="min-w-0 flex-1 truncate text-[11px] text-pink-600/80 dark:text-pink-300/80"
        >
          {card.subtitle || val}
        </span>
        {onGenerateVideoDoc && (
          <button
            type="button"
            title={t('为这个视频生成总览文档')}
            className="shrink-0 rounded bg-pink-500/15 px-2 py-1 text-[10.5px] font-medium text-pink-700 dark:text-pink-300 hover:bg-pink-500/25 transition cursor-pointer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onGenerateVideoDoc(card.uuid)}
          >
            {t('生成总览')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 px-3 pb-2 select-none">
      <div className="relative flex flex-1 items-center min-w-0">
        <input
          type="text"
          value={val}
          onChange={handleChange}
          onBlur={handleBlur}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          placeholder={t('输入视频链接或BV号...')}
          title={val || t('输入视频链接或BV号...')}
          className="w-full rounded border px-2 py-1 text-[11px] outline-none transition border-line/70 bg-card text-ink placeholder:text-ink-faint focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/20"
        />
      </div>
    </div>
  )
}

export function FileCardRow({
  card,
  store,
  goalId,
  onBindFile,
  onToast,
}: {
  card: CardView
  store: LearnStore
  goalId: string
  onBindFile?: (nodeUuid: string, patch: { fileKind?: FileNodeKind; url?: string; title?: string; titleCustomized?: boolean }) => unknown
  onToast?: (msg: string) => void
}) {
  const fileEntity = store.fileNodes?.find((f) => f.id === card.uuid)
  const [urlVal, setUrlVal] = useState(fileEntity?.url ?? '')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    setUrlVal(fileEntity?.url ?? '')
  }, [fileEntity?.url])

  const commitUrl = (val: string) => {
    const trimmed = val.trim()
    const isWeb = /^(https?:\/\/|\/\/)/i.test(trimmed) || trimmed.includes('://')
    const inferredKind: FileNodeKind = isWeb ? 'web' : 'local'
    let nextTitle = fileEntity?.title ?? card.title

    // 若未手动命名，自动从 URL 推导并填充 title
    if (!fileEntity?.titleCustomized) {
      if (inferredKind === 'local') {
        const clean = trimmed.replace(/^files\//, '').split('/').pop()
        if (clean) nextTitle = clean
      } else if (trimmed) {
        try {
          const u = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : (trimmed.includes('://') ? trimmed : `https://${trimmed}`))
          nextTitle = u.hostname || trimmed
        } catch {
          nextTitle = trimmed
        }
      }
    }

    onBindFile?.(card.uuid, {
      fileKind: inferredKind,
      url: trimmed,
      ...(nextTitle !== fileEntity?.title ? { title: nextTitle } : {}),
    })
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setUrlVal(next)
    const isWeb = /^(https?:\/\/|\/\/)/i.test(next.trim()) || next.trim().includes('://')
    const inferredKind: FileNodeKind = isWeb ? 'web' : 'local'
    // 若类型发生切换，立即提交一次以刷新卡片头部的「文件」/「网页」标识
    if (inferredKind !== (fileEntity?.fileKind ?? 'local')) {
      if (timerRef.current) clearTimeout(timerRef.current)
      commitUrl(next)
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      commitUrl(next)
    }, 280)
  }

  const handleBlur = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    commitUrl(urlVal)
  }

  const handlePickLocalFile = (e: React.MouseEvent) => {
    e.stopPropagation()
    const input = document.createElement('input')
    input.type = 'file'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const buffer = await file.arrayBuffer()
        const res = await uploadGoalFileWithHash(store, goalId, {
          name: file.name,
          data: buffer,
          mimeType: file.type,
        })
        if ('error' in res) {
          onToast?.(res.error)
          return
        }
        setUrlVal(res.url)
        const nextTitle = fileEntity?.titleCustomized ? fileEntity.title : file.name
        onBindFile?.(card.uuid, {
          fileKind: 'local',
          url: res.url,
          title: nextTitle,
        })
        if (res.isDuplicate) {
          onToast?.(t('检测到相同文件已存在，已自动复用去重'))
        }
      } catch (err) {
        console.error('上传文件失败', err)
        onToast?.(t('文件上传失败'))
      }
    }
    input.click()
  }

  const isWeb = fileEntity?.fileKind === 'web' || /^(https?:\/\/|\/\/)/i.test(urlVal) || urlVal.includes('://')

  return (
    <div className="px-2.5 pb-2">
      <div className="relative flex items-center">
        <input
          type="text"
          value={urlVal}
          onChange={handleChange}
          onBlur={handleBlur}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleBlur()
            }
          }}
          placeholder={t('输入文件路径或网址...')}
          title={urlVal || t('输入文件路径 (files/...) 或网址 (http/https)...')}
          className={`w-full rounded-md border border-line/60 bg-line/25 py-1 pl-2 pr-7 text-[11px] text-ink placeholder:text-ink-faint/45 transition focus:border-seal/50 focus:bg-card focus:outline-hidden ${
            isWeb ? 'focus:ring-1 focus:ring-indigo-500/30' : 'focus:ring-1 focus:ring-blue-500/30'
          }`}
        />
        <button
          type="button"
          onClick={handlePickLocalFile}
          onPointerDown={(e) => e.stopPropagation()}
          title={t('选择本地文件并上传到 files/ 引用')}
          className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-seal cursor-pointer"
        >
          <FolderOpen size={12} />
        </button>
      </div>
    </div>
  )
}
