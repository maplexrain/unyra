/**
 * 这个文件负责：节点下的「工作区」目录——节点目录里那个**真实存在**的
 * `workspace/` 子目录（users/<uid>/docs/<目标>/<节点>/workspace/；布局见 learn/workspace），
 * 以及它的递归树。
 *
 * 与上面的三个文档目录（笔记 / 试卷 / 超级文档）本质不同：那些是应用记账出来的
 * （store 序列化成什么，目录里就显示什么），这里列出的是磁盘上**实际有的**文件与子目录
 * ——用户放进去的、导师用 workspace.write 写的、右键新建出来的，全部原样出现。
 * 目录挂载即列一次（行尾的数量标记不用展开就有），每层各自缓存自己的清单。
 *
 * 清单的保鲜有两条路（见 explorer/wsChanges）：
 * - 应用内动作（新建 / 改名 / 拖拽 / 新建项目）落盘后调 notifyWsChanged，列过的层各自重列；
 * - 应用**外**的增删改名：展开着的层在主进程按目录挂着 fs.watch（见 electron/storage/ws），
 *   一有动静推 ws:changed 回来摇同一声铃；收起过的层在**展开时**顺手重列一次补齐。
 *
 * 右键菜单给**新建目录 / 新建文件 / 重命名**（IO 在 LearnWorkspace 的 wsActions 里，
 * 真实地落在磁盘上）；动完 notifyWsChanged()，展开过的目录听见就各自重列一遍。
 * 「工作区」根行不给改名：它的名字是布局定死的（nodeLayout 的分段 + workspace），
 * 磁盘上改了也会被下一次随标题的搬家改回来。
 *
 * 文件行点了在**页签里打开**（内部文件页签 ws，属于这个节点的目标、打开时带着它的
 * tab 组，见 learn/types 的 ws 分支与 groups/tabs 的 openGroupedDoc）；目录行点了
 * 展开 / 收起。两类行都可拖拽——拖到对话输入框变成 ws 引用（见 lib/chipSyntax），
 * 拖到文档区页签栏直接开在这格里。
 */
import { useEffect, useRef, useState } from 'react'
import { FileText, Folder } from 'lucide-react'
import type { KnowledgeNode, LearnStore } from '../../../learn/types'
import { listUserDir } from '../../../lib/storage'
import { WS_MOVE_MIME, wsJoin, wsRelOf } from '../../../learn/workspace'
import { Collapse, FolderRow, Indent } from './Folder'
import { peekReveal, subscribeReveal } from './reveal'
import { DocRow } from './DocRow'
import { registerWsWatch, subscribeWsChanged } from './wsChanges'
import type { MenuTarget, WsActions } from './types'
import { t } from '../../../i18n'

/** 目录与文件共用同一个中性灰（与 DocFolderIcon 一致：工作区里不认类型，只认「真有这个文件」） */
const GRAY = '#98928a'

interface WsEntry {
  name: string
  dir: boolean
}

/** 目录在前、名字按本地序（与 docs 树「结构先于内容」的排序同一句话） */
const sorted = (list: WsEntry[]): WsEntry[] =>
  [...list].sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'zh') : a.dir ? -1 : 1))

/** 就地改名的那一行（工作区的目录 / 文件）：回车提交、Esc 取消、失焦也算提交（与笔记的改名行同一套） */
function WsRenameRow({
  dir,
  initial,
  onCommit,
  onCancel,
}: {
  dir: boolean
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement | null>(null)
  // 挂上就聚焦并全选：改名多半是整名重写，不是往里插一个字
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <div className="flex items-center gap-1.5 py-1 pl-1.5 pr-1.5">
      <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center" style={{ color: GRAY }}>
        {dir ? <Folder size={12} /> : <FileText size={12} />}
      </span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onCommit(value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => onCommit(value)}
        className="min-w-0 flex-1 rounded border border-seal/40 bg-card px-1.5 py-0.5 text-[12px] text-ink outline-none"
      />
    </div>
  )
}

/**
 * 工作区的一层目录。根层是节点自己的工作区（「工作区」那一行）；
 * 往下每一层是磁盘上真实的一个子目录，名字就是文件系统的名字。
 */
function WsDir({
  node,
  base,
  segments,
  label,
  hint,
  ws,
  onOpenMenu,
  onOpen,
  onTransfer,
}: {
  node: KnowledgeNode
  /** 节点工作区的相对路径（docs/…/workspace/…）；往下各层用 segments 拼 */
  base: string
  /** 从节点工作区往下走的各段（根层是空数组） */
  segments: string[]
  label: string
  hint: string
  /** 新建 / 改名的动作与当前改名中的路径（真实 IO 在宿主，见 WsActions） */
  ws: WsActions
  onOpenMenu: (x: number, y: number, target: MenuTarget) => void
  /** 工作区文件在页签里打开（见 LearnWorkspace 的 openWsFile） */
  onOpen: (rel: string) => void
  /** 拖拽移动 / 复制：把 fromRel 落到本目录（Ctrl = 复制） */
  onTransfer: (fromRel: string, toDirRel: string, copy: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<WsEntry[] | null>(null)
  /** 拖着工作区条目悬在本目录行上（高亮这一行，告诉用户「松手就放这里」） */
  const [dropHover, setDropHover] = useState(false)
  const full = segments.length ? (wsJoin(base, segments) ?? base) : base
  // 改自己的名字要落回父目录：父目录的路径从 base + 去掉最后一段推出来
  const parentFull = segments.length > 1 ? (wsJoin(base, segments.slice(0, -1)) ?? base) : base
  /**
   * 重新列这一层的把手（挂载、收到 wsChanged 的铃、**展开时**、定位广播叫开时都走它）：
   * 收起的那段窗口不盯盘（见下面登记的 effect），展开时补一次——外部新加的文件不必
   * 等广播就出现。写成 ref 是因为 toggle / 广播订阅都在列清单的 effect 之外。
   */
  const refreshRef = useRef<() => void>(() => {})
  const toggle = () => {
    if (!open) refreshRef.current()
    setOpen((v) => !v)
  }
  /*
   * 目录**挂载即列一次**（不再等展开才列）：行尾的数量标记是目录行的一部分——
   * 「里面有几份」要点开才知道，目录就白画了。工作区目录通常就几项，这一次 IPC 值得；
   * 真正的大目录展开后自然会有展开的那次等待，这里只是把清单提前拿到手。
   * 列过的目录听那一声「变了」的铃（应用内动作与主进程 watcher 走同一个，见 wsChanges）：
   * 各自重列，缓存才不会说谎。
   */
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void listUserDir(full).then((list) => {
        if (alive) setEntries(sorted(list))
      })
    }
    refreshRef.current = refresh
    refresh()
    const off = subscribeWsChanged(refresh)
    return () => {
      alive = false
      off()
      refreshRef.current = () => {}
    }
  }, [full])

  /*
   * 展开着才盯着盘：主进程按「展开的目录」按目录挂 fs.watch（见 electron/storage/ws），
   * 收起 / 卸载就注销——深层的目录可以成千上百，没开的不值得盯；收起期间的外部变化
   * 由上面「展开时重列」补齐。
   */
  useEffect(() => {
    if (!open) return
    return registerWsWatch(full)
  }, [open, full])

  /*
   * 页签定位落到本目录底下的文件时：把这一层打开。子目录要等本层列完盘才挂载，
   * 所以除了订阅广播，挂载时还补看一眼当前这条（publishReveal 会把广播留几秒）——
   * 逐层接力，最深那层的文件行挂出来后由 revealRow 滚过去。
   * 顺带重列一次：这一层此前可能一直收着（没在盯盘），不重列的话定位不到外部新加的文件。
   */
  useEffect(() => {
    const maybe = (req: { keys: readonly string[] } | null): void => {
      if (!req?.keys.some((k) => k.startsWith('row:ws:' + full + '/'))) return
      refreshRef.current()
      setOpen(true)
    }
    maybe(peekReveal())
    return subscribeReveal(maybe)
  }, [full])

  /** 提交改名：交给 ws.rename 真实地 move（名字不合法 / 撞名由那头用 toast 说清） */
  const commitRename = (rel: string, parent: string, oldName: string) => (raw: string) => {
    ws.endRename()
    const name = raw.trim()
    if (!name || name === oldName) return
    ws.rename(rel, parent + '/' + name)
  }

  /** 本目录行作为**拖放落点**的三件事：拖过亮起来、离开熄掉、松手交给 ws.transfer */
  const dropHandlers = {
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes(WS_MOVE_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
      setDropHover(true)
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false)
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setDropHover(false)
      const raw = e.dataTransfer.getData(WS_MOVE_MIME)
      if (!raw) return
      try {
        const { rel } = JSON.parse(raw) as { rel?: string }
        if (rel) onTransfer(rel, full, e.ctrlKey)
      } catch {
        /* 坏数据就当没拖 */
      }
    },
  }
  /** 拖出去的额外一份（WS_MOVE_MIME）：文件与子目录都能被移动 / 复制，根行不行 */
  const dragExtra = (rel: string) => (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(WS_MOVE_MIME, JSON.stringify({ rel }))
  }

  return (
    <div>
      {ws.renaming === full && segments.length > 0 ? (
        <WsRenameRow
          dir
          initial={label}
          onCommit={commitRename(full, parentFull, label)}
          onCancel={ws.endRename}
        />
      ) : (
        /*
          拖放落点挂在包住行的那一层，高亮（dropActive）画在行自己身上——
          与收藏分组行同一个做法（见 sections.tsx 的 FavoriteGroups）。
        */
        <div {...dropHandlers}>
          <FolderRow
            label={label}
            hint={hint}
            open={open}
            count={entries?.length}
            dropActive={dropHover}
            onClick={() => toggle()}
            // 目录也能拖成引用：点击跳到所属节点（ws 目录没有页签形态，见 learn/chipRef）
            dragChip={segments.length === 0 ? undefined : () => ({ type: 'ws', path: full, nodeId: node.id, title: label, dir: true })}
            onDragExtra={segments.length === 0 ? undefined : dragExtra(full)}
            onMenu={(x, y) =>
              onOpenMenu(x, y, { kind: 'ws', node, rel: full, dir: true, root: segments.length === 0 })
            }
          />
        </div>
      )}
      <Collapse open={open}>
        <Indent>
          {entries?.length === 0 && (
            <p className="py-1 pl-1.5 pr-2 text-[11px] leading-relaxed text-ink-faint">
              {t('空目录——右键目录行新建，或把文件放进系统的这个文件夹')}
            </p>
          )}
          {entries?.map((e) => {
            const childRel = full + '/' + e.name
            if (e.dir) {
              return (
                <WsDir
                  key={e.name}
                  node={node}
                  base={base}
                  segments={[...segments, e.name]}
                  label={e.name}
                  hint={t('工作区子目录「{0}」（磁盘上真实存在的文件夹；点行展开 / 收起，右键新建 / 改名）', e.name)}
                  ws={ws}
                  onOpenMenu={onOpenMenu}
                  onOpen={onOpen}
                  onTransfer={onTransfer}
                />
              )
            }
            return ws.renaming === childRel ? (
              <WsRenameRow
                key={'rename:' + e.name}
                dir={false}
                initial={e.name}
                onCommit={commitRename(childRel, full, e.name)}
                onCancel={ws.endRename}
              />
            ) : (
              <DocRow
                key={e.name}
                icon={
                  <span
                    aria-hidden="true"
                    className="flex h-4 w-4 shrink-0 items-center justify-center"
                    style={{ color: GRAY }}
                  >
                    <FileText size={12} />
                  </span>
                }
                label={e.name}
                hint={t('工作区文件「{0}」（点击在页签打开；可拖拽：到目录行移动 / Ctrl 复制，到文档区或对话打开）', e.name)}
                revealKey={'row:ws:' + childRel}
                onClick={() => onOpen(childRel)}
                dragChip={() => ({ type: 'ws', path: childRel, nodeId: node.id, title: e.name })}
                onDragExtra={dragExtra(childRel)}
                onMenu={(x, y) => onOpenMenu(x, y, { kind: 'ws', node, rel: childRel, dir: false })}
              />
            )
          })}
        </Indent>
      </Collapse>
    </div>
  )
}

/**
 * 目标节点展开后的**项目区**：工作区目录（docs/{目标}/workspace/）里的一层目录与文件
 * 直接挂在目标底下，不再有「工作区」那一层——那里的每一层目录就是一个**项目**
 * （右键目标节点「新建项目」建出来的就是它，见 LearnWorkspace 的 newProject）。
 *
 * 为什么去掉「工作区」那一层（需求原文：「不是包含工作区目录，是工作区下的目录文件统一挂到目标下」）：
 * 目标节点展开之后，用户要看的是「这个目标底下我有哪些东西」——
 * 「工作区」只是磁盘布局里的一个中间文件夹名，对用户没有意义，
 * 多一层缩进只是让人多按一次。
 *
 * 子目录仍是 `WsDir`（往下每层是磁盘上真实的一个目录，这个层级是真的要看）；
 * 根层这里只把它的**孩子**平铺出来。空工作区不渲染任何行——
 * 与原来「工作区」那一行（永远画着）不同：没有内容时，目标展开后干干净净，
 * 想建点什么就右键目标节点选「新建项目」。
 */
export function WorkspaceFlat({
  store,
  node,
  ws,
  onOpenMenu,
  onOpen,
  onTransfer,
}: {
  store: LearnStore
  node: KnowledgeNode
  ws: WsActions
  onOpenMenu: (x: number, y: number, target: MenuTarget) => void
  onOpen: (rel: string) => void
  onTransfer: (fromRel: string, toDirRel: string, copy: boolean) => void
}) {
  const base = wsRelOf(store, node.id)
  const [entries, setEntries] = useState<WsEntry[] | null>(null)
  /** 拖着工作区条目悬在这一片上（高亮提示「松手放回工作区根」） */
  const [dropHover, setDropHover] = useState(false)
  const loaded = !!base
  useEffect(() => {
    if (!loaded || !base) return
    let alive = true
    const refresh = (): void => {
      void listUserDir(base).then((list) => {
        if (alive) setEntries(sorted(list))
      })
    }
    refresh()
    const off = subscribeWsChanged(refresh)
    return () => {
      alive = false
      off()
    }
  }, [loaded, base])
  /*
   * 这一片**一直盯着盘**（它是目标的工作区根、行本来就少）：在应用外直接建的目录也是
   * 项目——主进程 watcher 一报变化就重列，「新建项目」之外的路子（文件管理器里自己
   * 建一个文件夹）照样会作为项目出现。
   */
  useEffect(() => {
    if (!base) return
    return registerWsWatch(base)
  }, [base])
  // 定位广播落到工作区里的某个文件时，文件行就在这一层，revealRow 自己会滚过去
  if (!base) return null
  const commitRename = (rel: string, parent: string, oldName: string) => (raw: string) => {
    ws.endRename()
    const name = raw.trim()
    if (!name || name === oldName) return
    ws.rename(rel, parent + '/' + name)
  }
  const dragExtra = (rel: string) => (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(WS_MOVE_MIME, JSON.stringify({ rel }))
  }
  /** 根层也是拖放落点（把子目录里的东西挪回工作区根） */
  const dropHandlers = {
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes(WS_MOVE_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
      setDropHover(true)
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false)
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setDropHover(false)
      const raw = e.dataTransfer.getData(WS_MOVE_MIME)
      if (!raw) return
      try {
        const { rel } = JSON.parse(raw) as { rel?: string }
        if (rel) onTransfer(rel, base, e.ctrlKey)
      } catch {
        /* 坏数据就当没拖 */
      }
    },
  }
  return (
    <div
      {...dropHandlers}
      className={dropHover ? 'rounded-md bg-seal/5 ring-1 ring-inset ring-seal/25 transition' : 'transition'}
    >
      {entries?.map((e) => {
        const childRel = base + '/' + e.name
        if (e.dir) {
          return (
            <Indent key={e.name}>
              <WsDir
                node={node}
                base={base}
                segments={[e.name]}
                label={e.name}
                hint={t('项目「{0}」（挂在这个目标下的真实目录；点行展开 / 收起，右键新建 / 改名）', e.name)}
                ws={ws}
                onOpenMenu={onOpenMenu}
                onOpen={onOpen}
                onTransfer={onTransfer}
              />
            </Indent>
          )
        }
        return ws.renaming === childRel ? (
          <WsRenameRow
            key={'rename:' + e.name}
            dir={false}
            initial={e.name}
            onCommit={commitRename(childRel, base, e.name)}
            onCancel={ws.endRename}
          />
        ) : (
          <DocRow
            key={e.name}
            icon={
              <span
                aria-hidden="true"
                className="flex h-4 w-4 shrink-0 items-center justify-center"
                style={{ color: GRAY }}
              >
                <FileText size={12} />
              </span>
            }
            label={e.name}
            hint={t('工作区文件「{0}」（点击在页签打开；可拖拽：到目录行移动 / Ctrl 复制，到文档区或对话打开）', e.name)}
            revealKey={'row:ws:' + childRel}
            onClick={() => onOpen(childRel)}
            dragChip={() => ({ type: 'ws', path: childRel, nodeId: node.id, title: e.name })}
            onDragExtra={dragExtra(childRel)}
            onMenu={(x, y) => onOpenMenu(x, y, { kind: 'ws', node, rel: childRel, dir: false })}
          />
        )
      })}
    </div>
  )
}

/** 节点下的「工作区」那一行：真实目录的根。一直显示——真实目录永远存在，藏起来反而让人以为没有。 */
export function WorkspaceRow({
  store,
  node,
  ws,
  onOpenMenu,
  onOpen,
  onTransfer,
}: {
  store: LearnStore
  node: KnowledgeNode
  ws: WsActions
  onOpenMenu: (x: number, y: number, target: MenuTarget) => void
  /** 工作区文件在页签里打开（见 LearnWorkspace 的 openWsFile） */
  onOpen: (rel: string) => void
  /** 拖拽移动 / 复制（真实 IO 在宿主，见 WsActions.transfer） */
  onTransfer: (fromRel: string, toDirRel: string, copy: boolean) => void
}) {
  const base = wsRelOf(store, node.id)
  // 没进任何目标目录的节点（理论上不该有）：不画，免得点开是一场空
  if (!base) return null
  return (
    <Indent>
      <WsDir
        node={node}
        base={base}
        segments={[]}
        label={t('工作区')}
        hint={t('这个节点目录下的真实文件夹（{0}/）；点行展开看磁盘上实际有什么，右键新建目录 / 文件', base)}
        ws={ws}
        onOpenMenu={onOpenMenu}
        onOpen={onOpen}
        onTransfer={onTransfer}
      />
    </Indent>
  )
}
