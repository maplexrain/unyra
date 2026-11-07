import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocView, LearnStore, TabRef } from '../../../learn/types'
import { exportGoalToUnr, importGoalFromPackage, parseUnrPackage, pickUnrFile, saveUnrFile } from '../../../learn/export/unrPackage'
import type { useLearnStore } from '../../../learn/useLearnStore'
import { t } from '../../../i18n'

type StoreApi = ReturnType<typeof useLearnStore>

/** .unr 分享包导入导出需要的宿主能力 */
export interface UnrTransferDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  flush: StoreApi['flush']
  openTab: (ref: TabRef, preferredView?: DocView) => void
  onToast: (msg: string) => void
}

/* ---------- .unr 目标分享包（导出 / 导入 / 全屏拖拽遮罩） ---------- */
export function useUnrTransfer({ getLatest, set, flush, openTab, onToast }: UnrTransferDeps) {
  /** 导出总目标为 .unr 分享包 */
  const handleExportGoal = useCallback(
    async (goalId: string) => {
      try {
        const s = getLatest()
        const goal = s.goals.find((g) => g.id === goalId)
        if (!goal) {
          onToast(t('未找到目标'))
          return
        }
        const bytes = await exportGoalToUnr(s, goalId)
        const suggestedName = `${goal.title || t('未命名目标')}.unr`
        const res = await saveUnrFile(bytes, suggestedName)
        if (res.ok) {
          onToast(t('已成功导出目标「{0}」', goal.title || ''))
        } else if (res.error) {
          onToast(t('导出失败: {0}', res.error || ''))
        }
      } catch (err) {
        onToast(t('导出失败: {0}', err instanceof Error ? err.message : String(err)))
      }
    },
    [getLatest, onToast],
  )

  /** 调起文件选择器导入 .unr 目标包 */
  const handleImportGoal = useCallback(async () => {
    try {
      const file = await pickUnrFile()
      if (!file) return
      const buf = await file.arrayBuffer()
      const pkg = await parseUnrPackage(new Uint8Array(buf))
      const { store: nextStore, goal } = importGoalFromPackage(getLatest(), pkg)
      set(nextStore)
      await flush()
      openTab({ kind: 'outline', nodeId: goal.rootNodeId, goalId: goal.id })
      onToast(t('已成功导入目标「{0}」', goal.title || ''))
    } catch (err) {
      onToast(t('导入目标失败: {0}', err instanceof Error ? err.message : String(err)))
    }
  }, [flush, getLatest, onToast, openTab, set])

  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const dragCounter = useRef(0)

  useEffect(() => {
    /**
     * 判断是否为 .unr 目标包拖拽：
     * 1. 严格检查是否包含 Files；
     * 2. 若当前事件阶段能够读取到具体 files，严格校验文件后缀名必须以 .unr 结尾；
     * 3. 在进入悬停的保护模式（Protected Mode，Chromium出于安全沙盒锁定文件名）下：
     *    - 排除处于节点宇宙结构画布（StructureCanvas）区域的拖拽，让位于画布自身的文件落点创建节点交互；
     *    - 排除所有具有已知特定 MIME（如 PDF、图片、文本、音视频、JSON等）的非 .unr 文件；
     * 4. 最终在 drop 释放鼠标时刻脱离保护模式，再次对真实文件名后缀进行 100% 严格校验。
     */
    const isUnrDrag = (e: DragEvent): boolean => {
      const dt = e.dataTransfer
      if (!dt?.types || !Array.from(dt.types).includes('Files')) return false

      // 若处于节点宇宙结构画布（StructureCanvas）区域，不显示全屏导入遮罩，避免遮挡画布视线与落点
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-structure-canvas]')) return false

      // 若当前能读取到具体 files（例如特定系统环境或非保护模式阶段），严格检查文件后缀是否为 .unr
      if (dt.files && dt.files.length > 0) {
        return Array.from(dt.files).some((f) => (f.name || '').toLowerCase().endsWith('.unr'))
      }

      // 在进入悬停的保护模式下，items 的文件名不可直接读取，但常见文件格式均具备特定系统 MIME
      if (dt.items && dt.items.length > 0) {
        for (let i = 0; i < dt.items.length; i++) {
          const item = dt.items[i]
          if (item.kind === 'file' && item.type) {
            const t = item.type.toLowerCase()
            // .unr 为自定义格式，没有注册特定 MIME；凡是携带 PDF/图片/纯文本/音视频/JSON 等已知 MIME 的文件，绝不是 .unr
            if (
              t.startsWith('image/') ||
              t.startsWith('video/') ||
              t.startsWith('audio/') ||
              t.startsWith('text/') ||
              t === 'application/pdf' ||
              t === 'application/json' ||
              t === 'application/zip' ||
              t === 'application/x-zip-compressed'
            ) {
              return false
            }
          }
        }
      }

      return true
    }

    const onDragEnter = (e: DragEvent) => {
      if (!isUnrDrag(e)) return
      dragCounter.current++
      if (dragCounter.current === 1) {
        setIsDraggingFile(true)
      }
    }

    const onDragOver = (e: DragEvent) => {
      if (!isUnrDrag(e)) {
        if (isDraggingFile) {
          dragCounter.current = 0
          setIsDraggingFile(false)
        }
      } else if (!isDraggingFile && dragCounter.current > 0) {
        setIsDraggingFile(true)
      }
    }

    const onDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types || !Array.from(e.dataTransfer.types).includes('Files')) return
      dragCounter.current--
      if (dragCounter.current <= 0) {
        dragCounter.current = 0
        setIsDraggingFile(false)
      }
    }

    const onDropOrEnd = () => {
      dragCounter.current = 0
      setIsDraggingFile(false)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDropOrEnd, true)
    window.addEventListener('dragend', onDropOrEnd, true)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDropOrEnd, true)
      window.removeEventListener('dragend', onDropOrEnd, true)
    }
  }, [isDraggingFile])

  return { handleExportGoal, handleImportGoal, isDraggingFile }
}
