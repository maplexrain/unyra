/**
 * 浏览模式正文划词选区快照（DocSelectionSnapshot）：
 * 当用户在正文划选文字后，若呼出 Vim 冒号命令栏或弹窗，焦点转移至输入框会导致
 * window.getSelection() 折叠或丢失；通过此模块在正文选区活跃期间维护最新快照，
 * 供 :mark, :comment, :know, :study, :ask 命令稳定消费。
 */

import { visibleDocBody } from '../../../lib/docDom'
import { selectionTerm, occurrenceAt } from '../../../lib/annotation'
import { focusedGroup } from '../../../learn/groups'
import type { LearnStore } from '../../../learn/types'

export interface DocSelectionSnapshot {
  nodeId: string
  term: string
  text: string
  occurrence: number
  hasMark: boolean
  timestamp: number
}

let currentSnapshot: DocSelectionSnapshot | null = null

/** 更新正文选区快照 */
export function setDocSelectionSnapshot(snapshot: DocSelectionSnapshot | null): void {
  currentSnapshot = snapshot
}

/** 获取最近保存的正文选区快照（有效期 30 秒，防止跨页面陈旧选区误用） */
export function getDocSelectionSnapshot(): DocSelectionSnapshot | null {
  if (!currentSnapshot) return null
  if (Date.now() - currentSnapshot.timestamp > 30000) {
    currentSnapshot = null
    return null
  }
  return currentSnapshot
}

/** 清除当前正文选区快照 */
export function clearDocSelectionSnapshot(): void {
  currentSnapshot = null
}

/**
 * 捕获当前正文选区。如果当前正文选区有效，更新并返回最新快照；
 * 如果当前焦点已进入输入框/命令栏且选区已折叠，回退返回上次保存的有效快照。
 */
export function captureOrGetDocSelection(store: LearnStore): DocSelectionSnapshot | null {
  const body = visibleDocBody()
  const sel = window.getSelection()

  // 1. 尝试从当前真实 DOM 选区捕获
  if (body && sel && !sel.isCollapsed && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    if (body.contains(range.commonAncestorContainer)) {
      const text = range.toString().trim()
      if (text) {
        const term = selectionTerm(range) || text
        const group = store?.docArea ? focusedGroup(store.docArea) : null
        const activeTab = group?.tabs.find((t) => t.id === group.active)
        let nodeId: string | null = null
        if (activeTab?.ref && (activeTab.ref.kind === 'teach' || activeTab.ref.kind === 'note')) {
          nodeId = (activeTab.ref as any).nodeId
        } else {
          nodeId = store?.activeNodeId ?? null
        }

        if (nodeId) {
          const occurrence = occurrenceAt(body, term, range)
          let hasMark = false
          const markSpans = body.querySelectorAll<HTMLElement>('.moji-anno.moji-anno-note')
          for (const span of markSpans) {
            if (range.intersectsNode ? range.intersectsNode(span) : sel.containsNode(span, true)) {
              const t = span.dataset.annoTerm
              if (t === term || (t && term.includes(t))) {
                hasMark = true
                break
              }
            }
          }

          const snapshot: DocSelectionSnapshot = {
            nodeId,
            term,
            text,
            occurrence,
            hasMark,
            timestamp: Date.now(),
          }
          currentSnapshot = snapshot
          return snapshot
        }
      }
    }
  }

  // 2. 当前选区无法直接获取（例如焦点处于全局 Vim 命令输入框），回退读取已缓存的快照
  return getDocSelectionSnapshot()
}
