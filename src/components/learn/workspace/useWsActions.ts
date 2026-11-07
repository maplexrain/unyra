import { useCallback, useState } from 'react'
import type { DocView, LearnStore, TabRef } from '../../../learn/types'
import { revealUserPath, listUserDir, mkdirUserPath, moveUserPath, copyUserPath, writeUserText } from '../../../lib/storage'
import { wsAllocateName, wsNameOk, wsRefOfRel, wsRelOf } from '../../../learn/workspace'
import { fileNameOf as localFileNameOf } from '../../../learn/tabs'
import { goalSubtreeIds } from '../../../learn/graph'
import { notifyWsChanged } from '../explorer/wsChanges'
import type { useLearnStore } from '../../../learn/useLearnStore'
import { t } from '../../../i18n'

type StoreApi = ReturnType<typeof useLearnStore>

/** 工作区文件域需要的宿主能力 */
export interface WsActionsDeps {
  getLatest: () => LearnStore
  flush: StoreApi['flush']
  openTab: (ref: TabRef, preferredView?: DocView) => void
  onToast: (msg: string) => void
}

/* ---------- 工作区文件（节点下「工作区」目录树：定位 / 打开 / 新建改名 / 项目） ---------- */
export function useWsActions({ getLatest, flush, openTab, onToast }: WsActionsDeps) {
  /**
   * 定位工作区目录里的真实文件 / 子目录（节点下「工作区」目录树的点击与右键菜单）。
   *
   * 与 revealNodeFile 同一个道理：先 flush 再定位，文件管理器里看到的才是刚写完的那一份。
   */
  const revealWsFile = async (rel: string) => {
    await flush()
    if (!(await revealUserPath(rel))) onToast(t('未能在资源管理器中定位该文件'))
  }

  /**
   * 工作区文件在页签里打开：rel（相对当前用户）反查成**内部文件页签**（`{kind:'ws'}`，
   * 见 learn/workspace 的 wsRefOfRel）。它是内部文件而不是外部文件——openTab 会先把它
   * 所属目标的那一组立起来再进门（见 groups/tabs 的 openGroupedDoc），
   * 于是「打开项目里的任何一个文件就打开关联的 tab 组」。
   * 解析不解析看后缀（md/html 有预览，其余看源码，见 learn/tabs 的 viewOf）。
   */
  const openWsFile = useCallback(
    (rel: string) => {
      const ref = wsRefOfRel(getLatest(), rel)
      if (!ref) {
        onToast(t('现在打不开这个工作区文件（它不属于任何节点的工作区）'))
        return
      }
      openTab(ref)
    },
    [getLatest, openTab, onToast],
  )

  /** 工作区里正在就地改名的那条路径（null = 没有在改名） */
  const [renamingWs, setRenamingWs] = useState<string | null>(null)

  /**
   * 工作区的新建与改名：**真实地**落在磁盘上（mkdir / 写文件 / move，见 learn/workspace）。
   *
   * 动完 notifyWsChanged()，侧栏里展开过的目录各自重列一遍。新建沿用资源管理器的习惯：
   * 先按「新建目录 / 新建文件.md」避开撞名落一个真名，再当场进输入框让用户起名；
   * 改名走 move（绝不覆盖已有目标），失败用 toast 把原因说清。
   */
  const wsActions = {
    renaming: renamingWs,
    endRename: () => setRenamingWs(null),
    startRename: (rel: string) => setRenamingWs(rel),
    create: (dirRel: string, kind: 'dir' | 'file') => {
      void (async () => {
        const taken = new Set((await listUserDir(dirRel)).map((e) => e.name))
        const name = wsAllocateName(kind === 'dir' ? t('新建目录') : t('新建文件.md'), taken)
        const rel = dirRel + '/' + name
        const done = kind === 'dir' ? await mkdirUserPath(rel) : await writeUserText(rel, '')
        if (!done) {
          onToast(t('未能创建（那里已经有同名文件或目录）'))
          return
        }
        notifyWsChanged()
        setRenamingWs(rel)
      })()
    },
    rename: (fromRel: string, toRel: string) => {
      void (async () => {
        if (!wsNameOk(localFileNameOf(toRel))) {
          onToast(t('名字不合法：不能是空的、「.」「..」或带斜杠'))
          return
        }
        if (!(await moveUserPath(fromRel, toRel))) {
          onToast(t('未能改名（那里已经有同名文件或目录）'))
          return
        }
        notifyWsChanged()
      })()
    },
    /** 拖拽移动 / 复制（Ctrl）：落到某个目录行上，把文件或整个目录搬（拷）过去。
        撞名自动避开（「新建文件 2.md」那套习惯）；目录移进它自己当场拒绝。 */
    transfer: (fromRel: string, toDirRel: string, copy: boolean) => {
      if (fromRel === toDirRel || toDirRel.startsWith(fromRel + '/')) {
        onToast(t('不能把目录移进它自己里面'))
        return
      }
      void (async () => {
        const name = localFileNameOf(fromRel)
        const taken = new Set((await listUserDir(toDirRel)).map((e) => e.name))
        const toRel = toDirRel + '/' + wsAllocateName(name, taken)
        const done = copy ? await copyUserPath(fromRel, toRel) : await moveUserPath(fromRel, toRel)
        if (!done) {
          onToast(t(copy ? '复制失败' : '移动失败'))
          return
        }
        notifyWsChanged()
        onToast(copy ? t('已复制到 {0}', toDirRel.split('/').pop() ?? '') : t('已移动到 {0}', toDirRel.split('/').pop() ?? ''))
      })()
    },
  }

  /**
   * 新建项目：在目标的工作区目录下开一个**项目目录**（真实落盘），并当场进就地改名。
   *
   * 「项目」就是工作区里的一层目录（需求原文：「新建项目是在 workspace 目录中增加一个
   * 项目目录……项目是挂载目标节点下的」）——资源管理器里目标节点展开后看到的那几行目录
   * 就是它；项目里的文件是**内部文件**（页签是 ws 型，打开就带着目标的 tab 组）。
   *
   * 与 wsActions.create('dir') 同一套习惯：先按「新建项目」避开撞名落一个真名，
   * 再让用户改名（名字就是磁盘上的目录名，改的当场是真实目录）。
   */
  const newProject = useCallback(
    (nodeId: string) => {
      const base = wsRelOf(getLatest(), nodeId)
      if (!base) {
        onToast(t('这个节点还没有工作区目录'))
        return
      }
      void (async () => {
        const taken = new Set((await listUserDir(base)).map((e) => e.name))
        const name = wsAllocateName(t('新建项目'), taken)
        const rel = base + '/' + name
        if (!(await mkdirUserPath(rel))) {
          onToast(t('未能创建项目（那里已经有同名目录）'))
          return
        }
        notifyWsChanged()
        setRenamingWs(rel)
      })()
    },
    [getLatest, onToast],
  )

  /** 一枚目标（或它的根节点 id）名下的节点总数（删目标的确认框用） */
  const goalSubtreeSize = useCallback(
    (rootOrGoalId: string): number => {
      const s = getLatest()
      const goal = s.goals.find((g) => g.id === rootOrGoalId || g.rootNodeId === rootOrGoalId)
      return goal ? goalSubtreeIds(s, goal.id).size : 1
    },
    [getLatest],
  )

  return { revealWsFile, openWsFile, renamingWs, wsActions, newProject, goalSubtreeSize }
}
