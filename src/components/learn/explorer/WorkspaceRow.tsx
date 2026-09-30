/**
 * 这个文件负责：节点下的「工作区」目录——节点目录里那个**真实存在**的
 * `workspace/` 子目录（users/<uid>/docs/<目标>/<节点>/workspace/；布局见 learn/workspace），
 * 以及它的递归树。
 *
 * 与上面的三个文档目录（笔记 / 试卷 / 超级文档）本质不同：那些是应用记账出来的
 * （store 序列化成什么，目录里就显示什么），这里列出的是磁盘上**实际有的**文件与子目录
 * ——用户放进去的、导师用 workspace.write 写的、右键新建出来的，全部原样出现。
 * 展开才列目录（一次 IPC），每层各自记住自己开过没有。
 *
 * 右键菜单给**新建目录 / 新建文件 / 重命名**（IO 在 LearnWorkspace 的 wsActions 里，
 * 真实地落在磁盘上）；动完 notifyWsChanged()，展开过的目录听见就各自重列一遍。
 * 「工作区」根行不给改名：它的名字是布局定死的（nodeLayout 的分段 + workspace），
 * 磁盘上改了也会被下一次随标题的搬家改回来。
 *
 * 文件行点了就是在系统资源管理器里定位：归一目前不预览工作区里的任意文件，
 * 与其假装能打开，不如直接把人带到文件面前。
 */
import { useEffect, useRef, useState } from 'react'
import { FileText, Folder } from 'lucide-react'
import type { KnowledgeNode, LearnStore } from '../../../learn/types'
import { listUserDir } from '../../../lib/storage'
import { wsJoin, wsRelOf } from '../../../learn/workspace'
import { DocFolderIcon } from '../docTypes'
import { Collapse } from './sections'
import { DocRow } from './DocRow'
import { subscribeWsChanged } from './wsChanges'
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

/** 目录行尾的数量标记（与 NodeRow 的 countBadge 同一款） */
const countBadge = (n: number) => (
  <span className="shrink-0 rounded bg-line/70 px-1.5 py-px text-[10px] leading-4 text-ink-faint">{n}</span>
)

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
  onReveal,
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
  onReveal: (rel: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<WsEntry[] | null>(null)
  const full = segments.length ? (wsJoin(base, segments) ?? base) : base
  // 改自己的名字要落回父目录：父目录的路径从 base + 去掉最后一段推出来
  const parentFull = segments.length > 1 ? (wsJoin(base, segments.slice(0, -1)) ?? base) : base
  const toggle = async () => {
    const next = !open
    setOpen(next)
    // 展开才列目录：真实目录可能很大，没展开就不花那次 IPC
    if (next && entries === null) setEntries(sorted(await listUserDir(full)))
  }
  // 展开过的目录听那一声「变了」的铃：新建 / 改名之后各自重列，缓存才不会说谎
  const loaded = entries !== null
  useEffect(() => {
    if (!loaded) return
    return subscribeWsChanged(() => {
      void listUserDir(full).then((list) => setEntries(sorted(list)))
    })
  }, [full, loaded])

  /** 提交改名：交给 ws.rename 真实地 move（名字不合法 / 撞名由那头用 toast 说清） */
  const commitRename = (rel: string, parent: string, oldName: string) => (raw: string) => {
    ws.endRename()
    const name = raw.trim()
    if (!name || name === oldName) return
    ws.rename(rel, parent + '/' + name)
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
        <DocRow
          icon={<DocFolderIcon open={open} />}
          label={label}
          hint={hint}
          badge={entries && entries.length > 0 ? countBadge(entries.length) : undefined}
          expandable
          open={open}
          onClick={() => void toggle()}
          onMenu={(x, y) =>
            onOpenMenu(x, y, { kind: 'ws', node, rel: full, dir: true, root: segments.length === 0 })
          }
        />
      )}
      <Collapse open={open}>
        <div className="ml-3 border-l border-line pl-1.5">
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
                  onReveal={onReveal}
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
                hint={t('在系统资源管理器里定位「{0}」（点击行；右键：改名 / 定位）', e.name)}
                onClick={() => onReveal(childRel)}
                onMenu={(x, y) => onOpenMenu(x, y, { kind: 'ws', node, rel: childRel, dir: false })}
              />
            )
          })}
        </div>
      </Collapse>
    </div>
  )
}

/** 节点下的「工作区」那一行：真实目录的根。一直显示——真实目录永远存在，藏起来反而让人以为没有。 */
export function WorkspaceRow({
  store,
  node,
  ws,
  onOpenMenu,
  onReveal,
}: {
  store: LearnStore
  node: KnowledgeNode
  ws: WsActions
  onOpenMenu: (x: number, y: number, target: MenuTarget) => void
  onReveal: (rel: string) => void
}) {
  const base = wsRelOf(store, node.id)
  // 没进任何目标目录的节点（理论上不该有）：不画，免得点开是一场空
  if (!base) return null
  return (
    <div className="ml-3 border-l border-line pl-1.5">
      <WsDir
        node={node}
        base={base}
        segments={[]}
        label={t('工作区')}
        hint={t('这个节点目录下的真实文件夹（{0}/）；点行展开看磁盘上实际有什么，右键新建目录 / 文件', base)}
        ws={ws}
        onOpenMenu={onOpenMenu}
        onReveal={onReveal}
      />
    </div>
  )
}
