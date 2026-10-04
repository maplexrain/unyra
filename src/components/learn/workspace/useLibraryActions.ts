/*
 * 这个文件负责：「资料库」动作——节点笔记的新建 / 改名 / 删除 / 定位文件，
 * 以及本地文件的收进列表、打开、移除、对话框挑选与全窗口拖拽。
 *
 * 它们的共同点：都指向「节点文档之外的文件」——笔记是独立 .md、本地文件根本
 * 不在数据目录里。动它们不走文档保存那套暂存流程（见 useDocSaveFlow），
 * 新建之后当场开页签，因为用户点「新建」的下一步一定是「往里写」。
 */

import { useCallback, useEffect } from 'react'
import type { LearnStore, TabRef } from '../../../learn/types'
import { createNote, deleteNote, renameNoteFile } from '../../../learn/graph'
import { removeSuperDoc } from '../../../learn/superdocs'
import { captureLocalRemove, captureNoteDelete, captureSuperDelete, type ExplorerUndo } from '../../../learn/undo'
import { nodeDocRel } from '../../../learn/store'
import { addLocalFile, removeLocalFile } from '../../../learn/localfiles'
import { openInGroup } from '../../../learn/groups'
import { revealPath } from '../../../lib/storage'
import { droppedFilePath, pickLocalFiles } from '../../../lib/localFiles'
import { t } from '../../../i18n'

/** 资料库动作需要的宿主能力 */
export interface LibraryActionsDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  /** 定位文件前先落盘：改动是 500ms 防抖的，刚写完就定位会看到上一版 */
  flush: () => void | Promise<void>
  onToast: (msg: string) => void
  openTab: (ref: TabRef) => void
  /** 删除类动作在动手前把撤回项压进这张栈（Ctrl+Z 的货，见 useExplorerUndo） */
  pushUndo: (entry: ExplorerUndo) => void
}

/**
 * 笔记与本地文件的动作。
 * 全部返回给宿主：侧栏的文档行、悬浮组、确认框各取所需——
 * 但「删除」类只负责删，确认框的弹出与状态由宿主管（见 pendingNoteDelete 等）。
 */
export function useLibraryActions({ getLatest, set, flush, onToast, openTab, pushUndo }: LibraryActionsDeps) {
  /**
   * 新建一份笔记并当场打开它。
   *
   * 新建之后**直接开页签**（而不是只往列表里添一行）：用户点「新建」的下一步一定是
   * 「往里写」，让他再点一次列表是白费一步。名字由 learn/notes 分配（默认「笔记」，
   * 撞名加序号），因此这里不需要问用户要名字。
   */
  const createNodeNote = useCallback(
    (nodeId: string) => {
      const s = getLatest()
      const r = createNote(s, nodeId)
      if (!r.name) return
      const ref: TabRef = { kind: 'note', nodeId, note: r.name }
      set({
        ...r.store,
        // 新建的笔记一定是空的：直接开在编辑视图里（用户点「新建」就是要往里写）
        docArea: openInGroup(r.store.docArea, r.store.docArea.focus, ref, Date.now(), 'source'),
        activeNodeId: nodeId,
      })
      onToast(t('已新建笔记「{0}」', r.name))
    },
    [getLatest, set, onToast],
  )

  /** 改笔记名。名字就是文件名，所以页签也要跟着改（renameNoteFile 一并处理） */
  const renameNodeNote = useCallback(
    (nodeId: string, from: string, to: string) => {
      const r = renameNoteFile(getLatest(), nodeId, from, to)
      if (!r.name) {
        onToast(t('改名失败：这份笔记已经不在了'))
        return
      }
      set(r.store)
      onToast(r.name === to ? t('已更名为「{0}」', r.name) : t('已有同名笔记，改为「{0}」', r.name))
    },
    [getLatest, set, onToast],
  )

  /** 删掉一份笔记（前面还有一道确认，见 pendingNoteDelete）；Ctrl+Z 可撤回 */
  const commitRemoveNote = useCallback(
    (nodeId: string, name: string) => {
      const entry = captureNoteDelete(getLatest(), nodeId, name)
      if (entry) pushUndo(entry)
      set(deleteNote(getLatest(), nodeId, name))
      onToast(t('已删除笔记「{0}」，可按 Ctrl+Z 撤回', name))
    },
    [getLatest, set, onToast, pushUndo],
  )

  /** 删掉一份超级文档（前面同样有一道确认，见 pendingSuperDelete）；Ctrl+Z 可撤回 */
  const commitRemoveSuperDoc = useCallback(
    (nodeId: string, name: string) => {
      const entry = captureSuperDelete(getLatest(), nodeId, name)
      if (entry) pushUndo(entry)
      set(removeSuperDoc(getLatest(), nodeId, name))
      onToast(t('已删除超级文档「{0}」，可按 Ctrl+Z 撤回', name))
    },
    [getLatest, set, onToast, pushUndo],
  )

  /** 在资源管理器中定位一份笔记的 .md 文件 */
  const revealNoteFile = useCallback(
    async (nodeId: string, name: string) => {
      const rel = nodeDocRel(getLatest(), nodeId, { kind: 'note', note: name })
      if (!rel) {
        onToast(t('这份笔记还没有对应的文件（写过内容之后才会有）'))
        return
      }
      await flush()
      if (!(await revealPath(rel))) onToast(t('未能在资源管理器中定位该文件'))
    },
    [getLatest, flush, onToast],
  )

  /**
   * 把若干个外部文件收进「本地文件」列表并打开它们。
   *
   * 现在来者不拒（见 learn/localfiles）：文本开编辑器、媒体开预览页签，路径一律记进
   * 「最近打开」。一次拖进来好几个时全部开成页签，但只有第一个是激活的——后面的
   * 排在那儿，想看哪一个点一下就行，不必重新去文件管理器里找。
   */
  const addLocalFiles = useCallback(
    (paths: string[]) => {
      const s = getLatest()
      const usable = paths.filter(Boolean)
      if (!usable.length) return
      let next = s
      let at = Date.now()
      let docArea = s.docArea
      for (const p of usable) {
        next = { ...next, localFiles: addLocalFile(next.localFiles, p, at++) }
        docArea = openInGroup(docArea, docArea.focus, { kind: 'local', path: p }, at)
      }
      // 全部开成页签，但**只有第一个是激活的**：后面的排在那儿，想看哪一个点一下就行
      const first: TabRef = { kind: 'local', path: usable[0] }
      set({ ...next, docArea: openInGroup(docArea, docArea.focus, first, at) })
    },
    [getLatest, set],
  )

  /**
   * 从列表里打开一个本地文件。
   *
   * 顺手把它刷到「最近打开」的最前面：这个列表的语义就是最近打开（见 learn/localfiles），
   * 从列表里点开一个旧文件也是「打开」——不刷的话，用得最多的那个反而一直被压在下面。
   */
  const openLocalFile = useCallback(
    (path: string) => {
      const s = getLatest()
      set({ ...s, localFiles: addLocalFile(s.localFiles, path, Date.now()) })
      openTab({ kind: 'local', path })
    },
    [getLatest, set, openTab],
  )

  /** 从列表里移除一条（磁盘上的文件不动）；列表里少一行也能撤回 */
  const dropLocalFile = useCallback(
    (path: string) => {
      const s = getLatest()
      const entry = captureLocalRemove(s, path)
      if (entry) pushUndo(entry)
      set({ ...s, localFiles: removeLocalFile(s.localFiles, path) })
    },
    [getLatest, set, pushUndo],
  )

  /** 弹原生对话框挑文件（拖拽之外的第二个入口，也留给「拖不进来」的场合） */
  const pickLocal = useCallback(
    async () => {
      const paths = await pickLocalFiles()
      if (paths.length) addLocalFiles(paths)
    },
    [addLocalFiles],
  )

  /**
   * 拖拽：文件拖到窗口任意位置都收下。
   *
   * 只处理「看起来是本应用能浏览的文本文件」的拖拽，别的（图片、文件夹、
   * 编辑器里拖来的一段文字）一概不拦——AI 对话栏的图片拖放就在同一层，
   * 一律 preventDefault 会把它一起吃掉。
   */
  useEffect(() => {
    const usable = (e: DragEvent): File[] => {
      const list = e.dataTransfer?.files
      if (!list?.length) return []
      return [...list]
    }
    const onOver = (e: DragEvent) => {
      if (!usable(e).length) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      const files = usable(e)
      if (!files.length) return
      e.preventDefault()
      // 路径要问 preload（Electron 32 起 File.path 没了，见 lib/localFiles）
      addLocalFiles(files.map((f) => droppedFilePath(f)))
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [addLocalFiles])

  return {
    createNodeNote,
    renameNodeNote,
    commitRemoveNote,
    commitRemoveSuperDoc,
    revealNoteFile,
    addLocalFiles,
    openLocalFile,
    dropLocalFile,
    pickLocal,
  }
}
