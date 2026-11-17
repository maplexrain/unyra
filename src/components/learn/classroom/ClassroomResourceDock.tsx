import { useMemo } from 'react'
import {
  X,
  FileText,
  FileQuestion,
  FileCode,
  File,
  ExternalLink,
} from 'lucide-react'
import { t } from '../../../i18n'
import type { LearnStore } from '../../../learn/types'
import { nodeById } from '../../../learn/graph'

export interface ClassroomResourceDockProps {
  store: LearnStore
  classroomId: string
  childNodeIds: string[]
  onClose: () => void
  onOpenTab: (kind: string, targetId: string, extra?: Record<string, unknown>) => void
}

export default function ClassroomResourceDock({
  store,
  classroomId: _classroomId,
  childNodeIds,
  onClose,
  onOpenTab,
}: ClassroomResourceDockProps) {
  // 解析下游子节点实体
  const childItems = useMemo(() => {
    return childNodeIds.map((id) => {
      // 检查是否为文档/笔记
      const doc = nodeById(store, id)
      if (doc) {
        return { id, title: doc.title, kind: 'doc' as const, desc: '关联文档' }
      }
      // 检查考试
      const exam = store.exams.find((e) => e.id === id)
      if (exam) {
        return { id, title: exam.title || '随堂考试', kind: 'exam' as const, desc: '随堂测验' }
      }
      // 检查文件节点
      const file = (store.fileNodes ?? []).find((f) => f.id === id)
      if (file) {
        return { id, title: file.title || '课件附件', kind: 'file' as const, desc: '配套文件' }
      }
      return { id, title: id, kind: 'unknown' as const, desc: '关联节点' }
    })
  }, [store, childNodeIds])

  return (
    <div className="w-80 h-full border-l border-line/60 bg-card/95 flex flex-col select-none shrink-0 animate-in slide-in-from-right duration-150">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line/40">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold text-ink-strong">{t('课堂关联资源')}</span>
          <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-line/60 text-ink-soft">
            {childItems.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title={t('收起')}
          className="rounded p-1 text-ink-soft hover:bg-line/60 hover:text-ink transition cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>

      {/* 列表区 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {childItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-ink-faint space-y-2">
            <div className="text-[13px]">{t('暂无关联资源')}</div>
            <div className="text-[11.5px] text-ink-faint/80 leading-relaxed">
              {t('可在结构画布中将随堂笔记、测验或课件文件连接至此课堂')}
            </div>
          </div>
        ) : (
          childItems.map((item) => (
            <div
              key={item.id}
              onClick={() => onOpenTab(item.kind, item.id)}
              className="group flex items-center justify-between p-2.5 rounded-xl border border-line/40 bg-paper/40 hover:bg-paper hover:border-seal/40 transition cursor-pointer shadow-2xs"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-line/50 text-ink-soft group-hover:text-seal group-hover:bg-seal/10 transition shrink-0">
                  {item.kind === 'doc' ? (
                    <FileText size={15} />
                  ) : item.kind === 'exam' ? (
                    <FileQuestion size={15} />
                  ) : item.kind === 'file' ? (
                    <File size={15} />
                  ) : (
                    <FileCode size={15} />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-ink-strong truncate group-hover:text-seal transition">
                    {item.title}
                  </div>
                  <div className="text-[10.5px] text-ink-faint truncate">{item.desc}</div>
                </div>
              </div>

              <ExternalLink size={13} className="text-ink-faint opacity-0 group-hover:opacity-100 transition shrink-0 ml-1" />
            </div>
          ))
        )}
      </div>

      {/* 底部快捷操作 */}
      <div className="p-3 border-t border-line/40 bg-paper/30">
        <div className="text-[11px] text-ink-faint text-center">
          {t('支持子级挂载：笔记 · 考试 · 超级文档 · 文件')}
        </div>
      </div>
    </div>
  )
}
