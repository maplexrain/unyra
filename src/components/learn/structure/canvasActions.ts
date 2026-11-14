/**
 * 结构画布的写回与统一通道动作 hook：坐标表撤回栈（commit/undo）、拖动落点写回
 * （writePos/writePositions）、统一通道回执→吐司（report）、删除节点（removeNode）、
 * 连线（tryConnect）、点目标项建文档（onSlotClick）、打开内容（openNode）、自动排列
 * （autoArrange）、便条与改名（saveNote/saveRename）、外部文件拖入落图（onCanvasDrop）。
 * 画布自有状态只有坐标与便条；建/删/连/改名一律走宿主的统一通道（NodeService）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { FileNodeKind, LearnStore } from '../../../learn/types'
import type { StructureMap } from '../../../learn/structure'
import { deriveCanvas } from './structureView'
import { FILES_DIR } from '../../../learn/layout'
import { sanitizeFileName } from '../../../learn/fileNodes'
import { goalDirOf } from '../../../learn/static/location'
import { writeUserBinary } from '../../../lib/storage'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import { locateUuid, type GNodeKind } from '../../../learn/nodeKinds'
import { nodeById } from '../../../learn/graph'
import { t } from '../../../i18n'
import type { ChannelResult, MenuState } from './canvasTypes'
import type { CardView, CanvasEdge } from './structureView'

/** 动作 hook 需要的宿主能力与共享状态 */
export interface CanvasActionsDeps {
  store: LearnStore
  goalId: string
  /** 坐标表（store.structure[goalId]），写回的基准 */
  saved: StructureMap | undefined
  /** 坐标表变了（画布自有状态只有坐标与便条） */
  onChange: (next: StructureMap) => void
  onToast?: (msg: string) => void
  /** 删除节点（统一通道：删谁只删谁） */
  onDeleteNode?: (uuid: string) => ChannelResult
  /** 连线（双边协商在服务层） */
  onConnect?: (fromUuid: string, toUuid: string, portKey?: string) => ChannelResult
  /** 节点落地（统一通道） */
  onCreateNode?: (
    kind: GNodeKind,
    under: string | null,
    at?: { x: number; y: number },
    extra?: Record<string, unknown>,
  ) => { uuid: string; title?: string } | { error: string }
  /** 点大纲目标项：挂一份带标题的空文档，返回新文档 uuid */
  onCreateChildDoc?: (ownerNodeId: string, title: string, portKey?: string) => string | null
  /** 改笔记名（宿主走笔记节点的 editContent） */
  onRenameNote?: (noteUuid: string, to: string) => ChannelResult
  onBindFile?: (nodeUuid: string, patch: { fileKind?: FileNodeKind; url?: string; title?: string; titleCustomized?: boolean }) => ChannelResult
  onUpdateVideoNode?: (nodeUuid: string, patch: { input?: string; title?: string; titleCustomized?: boolean }) => ChannelResult
  onOpenVideo?: (videoId: string) => void
  onOpenVideoNode?: (nodeUuid: string) => void
  /** 点大纲卡的标题 = 打开这份大纲的导读页签（没有导读时说明一句） */
  onOpenOutlineGuide?: (outlineUuid: string) => void
  onOpenFileNode?: (nodeUuid: string) => void
  docs: NodeDocActions
  exams: ExamActions
  cards: CardView[]
  /** 镜头居中（useCanvasCamera）：点目标项跳到子文档 */
  centerOn: (id: string) => void
  /** 项目卡展开（useProjectTrees）：项目卡没有页签，打开 = 展开目录树 */
  toggleProjRoot: (uuid: string) => void
  /** 下一次 cards 变了之后要不要自动对镜头（自动排列之后用），宿主持有 */
  fitNextRef: RefObject<boolean>
  setDraft: Dispatch<SetStateAction<{ id: string; x: number; y: number; moves?: Record<string, { x: number; y: number }> } | null>>
  setSelectedId: Dispatch<SetStateAction<string | null>>
  setSelectedEdge: Dispatch<SetStateAction<CanvasEdge | null>>
  setMultiIds: Dispatch<SetStateAction<Set<string> | null>>
  setMenu: Dispatch<SetStateAction<MenuState | null>>
  toWorld: (clientX: number, clientY: number) => { x: number; y: number }
}

export function useCanvasActions({
  store,
  goalId,
  saved,
  onChange,
  onToast,
  onDeleteNode,
  onConnect,
  onCreateNode,
  onCreateChildDoc,
  onRenameNote,
  onBindFile,
  onUpdateVideoNode,
  onOpenVideo,
  onOpenVideoNode,
  onOpenOutlineGuide,
  onOpenFileNode,
  docs,
  exams,
  cards,
  centerOn,
  toggleProjRoot,
  fitNextRef,
  setDraft,
  setSelectedId,
  setSelectedEdge,
  setMultiIds,
  setMenu,
  toWorld,
}: CanvasActionsDeps) {

  /* ---------- 写回（画布自有状态 = 坐标表；实体走统一通道） ---------- */

  /**
   * 撤回栈：坐标表自己的历史（拖动 / 便条 / 连线画法）。
   * 实体操作（建 / 删 / 连 / 改名）走统一通道，归工作区那边的撤回管——两类动作
   * 不混在同一个栈里，各退各的。
   */
  const historyRef = useRef<StructureMap[]>([])
  const [canUndo, setCanUndo] = useState(false)

  const commit = useCallback(
    (next: StructureMap) => {
      const prev = saved ?? { version: 2 as const, positions: {} }
      historyRef.current.push(prev)
      if (historyRef.current.length > 50) historyRef.current.shift()
      setCanUndo(true)
      onChange(next)
    },
    [saved, onChange],
  )

  const undo = useCallback(() => {
    const prevMap = historyRef.current.pop()
    if (!prevMap) return
    setCanUndo(historyRef.current.length > 0)
    // 撤回本身不再进栈，否则 Ctrl+Z 会在两版之间来回弹
    onChange(prevMap)
    setDraft(null)
    setSelectedId(null)
    setSelectedEdge(null)
    setMultiIds(null)
  }, [onChange, setDraft, setSelectedId, setSelectedEdge, setMultiIds])

  /** 换目标就清空：A 课的撤回不该退到 B 课去 */
  useEffect(() => {
    historyRef.current = []
    setCanUndo(false)
  }, [goalId])

  /** 写一张卡的位置（便条跟着位置走，拖动不能把它弄丢） */
  const writePos = useCallback(
    (uuid: string, x: number, y: number, note?: string) => {
      const base = saved ?? { version: 2 as const, positions: {} }
      const prevNote = note ?? base.positions[uuid]?.note
      commit({
        version: 2,
        ...(base.edgeStyle ? { edgeStyle: base.edgeStyle } : {}),
        positions: { ...base.positions, [uuid]: { x, y, ...(prevNote ? { note: prevNote } : {}) } },
      })
    },
    [saved, commit],
  )

  /** 一次提交写一批位置（多选整组拖的落点）：一笔进撤回栈，Ctrl+Z 一次退整组 */
  const writePositions = useCallback(
    (entries: Array<{ uuid: string; x: number; y: number }>) => {
      const base = saved ?? { version: 2 as const, positions: {} }
      const positions = { ...base.positions }
      for (const en of entries) {
        const prevNote = positions[en.uuid]?.note
        positions[en.uuid] = { x: en.x, y: en.y, ...(prevNote ? { note: prevNote } : {}) }
      }
      commit({ version: 2, ...(base.edgeStyle ? { edgeStyle: base.edgeStyle } : {}), positions })
    },
    [saved, commit],
  )

  /** 统一通道的回执 → 吐司（拒绝一定带人话） */
  const report = useCallback(
    (r: ChannelResult) => {
      if ('error' in r) onToast?.(r.error)
      else if (r.note) onToast?.(r.note)
      return 'ok' in r
    },
    [onToast],
  )

  const removeNode = useCallback(
    (uuid: string) => {
      if (!onDeleteNode) {
        onToast?.(t('这个画布没有接入删除通道'))
        return
      }
      // 删根文档 = 删整个目标：这是设计内语义，但绝不能从一张卡的删除键上悄悄发生——
      // 通道里会转接两档确认（与资源管理器同一条路），这里照常走统一通道
      report(onDeleteNode(uuid))
      setSelectedId(null)
      setMenu(null)
    },
    [onDeleteNode, report, onToast, setSelectedId, setMenu],
  )

  /* ---------- 连线（唯一可手工建立：大纲 → 文档 / 大纲） ---------- */

  const tryConnect = useCallback(
    (fromUuid: string, toUuid: string, portKey?: string) => {
      if (!onConnect) return false
      return report(onConnect(fromUuid, toUuid, portKey))
    },
    [onConnect, report],
  )

  /* ---------- 点目标项 ---------- */

  const onSlotClick = useCallback(
    (parentId: string, key: string) => {
      const parent = cards.find((c) => c.uuid === parentId)
      const slot = parent?.slots?.find((s) => s.key === key)
      if (!parent || !slot) return
      if (slot.childId) {
        centerOn(slot.childId)
        return
      }
      /*
       * 点目标项 = 建一份带标题的空文档（统一通道）：create 的同目标去重
       * 会让同一标题永远指向同一份实体；位置由派生自动铺排（父大纲右侧）。
       * owner 直接给大纲 uuid（o:）——服务认得出附身（挂宿主文档）与游离（挂实体）两种。
       */
      const owner = parentId
      if (!onCreateChildDoc) return
      const uuid = onCreateChildDoc(owner, slot.title, slot.key)
      if (!uuid) {
        onToast?.(t('没能创建文档，请稍后再试'))
        return
      }
      setSelectedId(uuid)
      onToast?.(t('「{0}」的空文档已挂上：点卡片上的「生成文档」让 AI 来写', slot.title))
    },
    [cards, centerOn, onCreateChildDoc, onToast, setSelectedId],
  )

  /* ---------- 打开内容 ---------- */

  const openNode = useCallback(
    (card: CardView) => {
      if (card.kind === 'doc') {
        docs.onOpenTeach(card.uuid)
        return
      }
      // 点大纲卡的标题 = 跳到这份大纲的**导读**页签（导读生在大纲本体上；没有时给出指路）
      if (card.kind === 'outline') {
        if (onOpenOutlineGuide) onOpenOutlineGuide(card.uuid)
        return
      }
      const loc = locateUuid(store, card.uuid)
      // 游离笔记与绑定的笔记**用起来没有任何区别**：同样开笔记页签（页签的实体解析
      // 认得出游离的，编辑保存走池子）。其余游离实体（超级文档 / 试卷）的页签形态
      // 依赖宿主，先给一句指路。
      if (card.kind === 'note' && loc?.kind === 'note' && !loc.docId) {
        docs.onOpenNote(card.uuid, card.title)
        return
      }
      if (loc && (loc.kind === 'superdoc' || loc.kind === 'exam') && !loc.docId) {
        onToast?.(t('这份{0}还没绑到文档上：拖线连到某张文档卡（或把它拖到文档卡上）之后就能打开', card.kind === 'exam' ? t('试卷') : t('超级文档')))
        return
      }
      if (card.kind === 'note' && loc?.kind === 'note') {
        const note = store.nodes.find((n) => n.id === loc.docId)?.notes.find((n) => n.id === loc.noteId)
        if (note) docs.onOpenNote(loc.docId, note.name)
        return
      }
      if (card.kind === 'superdoc' && loc?.kind === 'superdoc') {
        const sdoc = store.nodes.find((n) => n.id === loc.docId)?.superdocs?.find((d) => d.id === loc.sdocId)
        if (sdoc) docs.onOpenSuperDoc(loc.docId, sdoc.name)
        return
      }
      if (card.kind === 'exam') {
        const exam = store.exams.find((e) => e.id === card.uuid)
        if (exam && !nodeById(store, exam.nodeId)) {
          onToast?.(t('这份试卷还没绑到文档上：拖线连到某张文档卡之后就能开考'))
          return
        }
        if (exam) exams.onStart(exam.nodeId, exam.id)
        return
      }
      if (card.kind === 'video') {
        if (onOpenVideoNode) {
          onOpenVideoNode(card.uuid)
          return
        }
        const bound = store.videoNodes?.find((v) => v.id === card.uuid)?.videoId ?? null
        if (bound && onOpenVideo) onOpenVideo(bound)
        else onToast?.(t('这张视频卡还没有绑定视频'))
        return
      }
      if (card.kind === 'project') {
        // 项目卡没有可打开的页签：有路径的给展开（目录树就是它的正文），没路径的指去设置
        if (card.project?.path) toggleProjRoot(card.uuid)
        else onToast?.(t('这枚项目节点还没有设置路径：右键卡片 →「设置路径」'))
        return
      }
      if (card.kind === 'file') {
        if (onOpenFileNode) onOpenFileNode(card.uuid)
        else onToast?.(t('无法打开文件节点'))
        return
      }
      onToast?.(t('大纲节点就在这张画布上，没有另一份页签'))
    },
    [docs, exams, onToast, onOpenVideo, onOpenVideoNode, onOpenFileNode, store, toggleProjRoot],
  )

  /* ---------- 自动排列（清掉坐标、交给派生铺排；便条保留） ---------- */

  const autoArrange = useCallback(() => {
    const fresh = deriveCanvas(store, goalId, undefined)
    const notes = saved?.positions ?? {}
    const positions: StructureMap['positions'] = {}
    for (const card of fresh.cards) {
      const prevNote = notes[card.uuid]?.note
      positions[card.uuid] = { x: card.x, y: card.y, ...(prevNote ? { note: prevNote } : {}) }
    }
    fitNextRef.current = true
    commit({ version: 2, positions, ...(saved?.edgeStyle ? { edgeStyle: saved.edgeStyle } : {}) })
  }, [store, goalId, saved, commit, fitNextRef])

  /* ---------- 便条与改名 ---------- */

  const saveNote = useCallback(
    (uuid: string, card: CardView, text: string) => {
      const value = text.trim()
      const base = saved ?? { version: 2 as const, positions: {} }
      const positions = { ...base.positions }
      if (value) positions[uuid] = { x: positions[uuid]?.x ?? card.x, y: positions[uuid]?.y ?? card.y, note: value }
      else if (positions[uuid]) {
        const { note: _drop, ...rest } = positions[uuid]
        positions[uuid] = rest
      }
      commit({ version: 2, ...(base.edgeStyle ? { edgeStyle: base.edgeStyle } : {}), positions })
      setMenu(null)
    },
    [saved, commit, setMenu],
  )

  const saveRename = useCallback(
    (card: CardView, to: string) => {
      if (card.kind === 'file') {
        if (onBindFile) {
          report(onBindFile(card.uuid, { title: to.trim(), titleCustomized: true }))
        }
        setMenu(null)
        return
      }
      if (card.kind === 'video') {
        if (onUpdateVideoNode) {
          report(onUpdateVideoNode(card.uuid, { title: to.trim(), titleCustomized: true }))
        }
        setMenu(null)
        return
      }
      if (!onRenameNote || card.kind !== 'note') {
        setMenu(null)
        return
      }
      report(onRenameNote(card.uuid, to.trim()))
      setMenu(null)
    },
    [onRenameNote, report, onBindFile, onUpdateVideoNode, setMenu],
  )

  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types ? Array.from(e.dataTransfer.types).includes('Files') : false
    if (hasFiles) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const onCanvasDrop = useCallback(
    async (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files || [])
      const normalFiles = files.filter((f) => !f.name.toLowerCase().endsWith('.unr'))
      if (!normalFiles.length) return
      e.preventDefault()
      e.stopPropagation()

      const world = toWorld(e.clientX, e.clientY)
      const goalDir = goalDirOf(store, goalId)
      if (!goalDir) {
        onToast?.(t('找不到当前目标目录，无法保存文件'))
        return
      }

      let offsetX = 0
      let offsetY = 0

      for (const file of normalFiles) {
        const fileName = sanitizeFileName(file.name)
        const relPath = `${goalDir}/${FILES_DIR}/${fileName}`
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(new Error('读取文件失败'))
            reader.readAsDataURL(file)
          })

          const written = await writeUserBinary(relPath, dataUrl)
          if (!written) {
            onToast?.(t('保存文件「{0}」失败', file.name))
            continue
          }

          if (onCreateNode) {
            const r = onCreateNode(
              'file',
              null,
              { x: Math.round(world.x + offsetX), y: Math.round(world.y + offsetY) },
              {
                title: file.name,
                fileKind: 'local',
                url: `${FILES_DIR}/${fileName}`,
              },
            )
            if ('uuid' in r) {
              writePos(r.uuid, Math.round(world.x + offsetX), Math.round(world.y + offsetY))
              setSelectedId(r.uuid)
              offsetX += 24
              offsetY += 24
            }
          }
          onToast?.(t('已添加文件节点「{0}」', file.name))
        } catch (err) {
          onToast?.(t('导入文件失败: {0}', err instanceof Error ? err.message : String(err)))
        }
      }
    },
    [store, goalId, toWorld, onCreateNode, writePos, onToast, setSelectedId],
  )

  return {
    canUndo,
    undo,
    writePos,
    writePositions,
    report,
    removeNode,
    tryConnect,
    onSlotClick,
    openNode,
    autoArrange,
    saveNote,
    saveRename,
    onCanvasDragOver,
    onCanvasDrop,
  }
}
