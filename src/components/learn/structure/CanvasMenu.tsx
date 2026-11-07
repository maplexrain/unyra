/**
 * 结构画布的右键菜单 / 节点浮层表单：actions 菜单（删除 / 设为入口 / 注释 / 改名 /
 * 生成大纲 / 打开视频 / 打开文件 / 设置路径）、项目路径声明表单、注释与改名输入、
 * 文件卡的手动设置表单。滚轮隔离用 WheelStop（浮层 DOM 长在画布容器里）。
 * 纯展示件：状态（menu / 文本输入）由宿主持有，逐项 props + 内联回调。
 */

import type { Dispatch, SetStateAction } from 'react'
import type { FileNodeKind, LearnStore } from '../../../learn/types'
import { inferPathKind } from '../../../learn/projects'
import { native } from '../../../lib/native'
import { outlineUuid } from '../../../learn/nodeKinds'
import { t } from '../../../i18n'
import type { ChannelResult, MenuState } from './canvasTypes'
import { WheelStop } from './CanvasCardRows'
import type { CanvasEdge, CardView } from './structureView'

export interface CanvasMenuProps {
  menu: MenuState
  menuCard: CardView
  store: LearnStore
  goalId: string
  edges: CanvasEdge[]
  menuText: string
  setMenuText: Dispatch<SetStateAction<string>>
  menuTitleText: string
  setMenuTitleText: Dispatch<SetStateAction<string>>
  menuFileKind: FileNodeKind
  setMenuFileKind: Dispatch<SetStateAction<FileNodeKind>>
  setMenu: Dispatch<SetStateAction<MenuState | null>>
  removeNode: (uuid: string) => void
  onSetEntry?: (docUuid: string) => ChannelResult
  /** 统一通道的回执 → 吐司（拒绝一定带人话） */
  report: (r: ChannelResult) => boolean
  onGenerateOutline?: (docUuid: string) => void
  onOpenVideoNode?: (nodeUuid: string) => void
  onOpenVideo?: (videoId: string) => void
  onGenerateVideoDoc?: (videoNodeUuid: string) => void
  onOpenFileNode?: (nodeUuid: string) => void
  onBindFile?: (nodeUuid: string, patch: { fileKind?: FileNodeKind; url?: string; title?: string; titleCustomized?: boolean }) => ChannelResult
  onSetProjectPath?: (nodeUuid: string, path: string) => ChannelResult | Promise<ChannelResult>
  /** 换路径 = 旧的目录树缓存整体作废（见 useProjectTrees） */
  clearProjCache: (uuid: string) => void
  saveNote: (uuid: string, card: CardView, text: string) => void
  saveRename: (card: CardView, to: string) => void
  onToast?: (msg: string) => void
}

export function CanvasMenu({
  menu,
  menuCard,
  store,
  goalId,
  edges,
  menuText,
  setMenuText,
  menuTitleText,
  setMenuTitleText,
  menuFileKind,
  setMenuFileKind,
  setMenu,
  removeNode,
  onSetEntry,
  report,
  onGenerateOutline,
  onOpenVideoNode,
  onOpenVideo,
  onGenerateVideoDoc,
  onOpenFileNode,
  onBindFile,
  onSetProjectPath,
  clearProjCache,
  saveNote,
  saveRename,
  onToast,
}: CanvasMenuProps) {
  return (
    <WheelStop
      data-menu
      className={`fixed z-50 ${menu.mode === 'projectPath' ? 'w-[280px]' : 'w-[168px]'} rounded-lg border border-line bg-card/95 p-1 text-[12px] text-ink shadow-lg backdrop-blur`}
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.mode === 'actions' ? (
        <>
          <button
            type="button"
            className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
            onClick={() => {
              // 删除的收尾（关菜单）都由 removeNode 统一处理
              removeNode(menuCard.uuid)
            }}
          >
            {t('删除')}
          </button>
          {menuCard.kind === 'doc' &&
            !menuCard.entry &&
            store.goals.find((g) => g.id === goalId)?.rootNodeId !== menuCard.uuid &&
            !edges.some((e) => e.to === menuCard.uuid || e.to === outlineUuid(menuCard.uuid)) &&
            onSetEntry && (
            <button
              type="button"
              title={t('这门课从这份文档开始（原入口文档退位，仍在图上）')}
              className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
              onClick={() => {
                report(onSetEntry(menuCard.uuid))
                setMenu(null)
              }}
            >
              {t('设为入口')}
            </button>
          )}
          <button
            type="button"
            className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
            onClick={() => {
              setMenuText(menuCard.note ?? '')
              setMenu({ ...menu, mode: 'note' })
            }}
          >
            {t('注释')}
          </button>
          {menuCard.kind === 'note' && (
            <button
              type="button"
              className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
              onClick={() => {
                setMenuText(menuCard.title)
                setMenu({ ...menu, mode: 'rename' })
              }}
            >
              {t('改名')}
            </button>
          )}
          {menuCard.kind === 'outline' && (
            <button
              type="button"
              className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
              onClick={() => {
                onGenerateOutline?.(menuCard.uuid)
                setMenu(null)
              }}
            >
              {t('生成总览')}
            </button>
          )}
          {menuCard.kind === 'doc' && (
            <button
              type="button"
              className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
              onClick={() => {
                // 生成大纲：读这份文档，规划子层级目标项
                onGenerateOutline?.(menuCard.uuid)
                setMenu(null)
              }}
            >
              {t('生成大纲')}
            </button>
          )}
          {menuCard.kind === 'video' && (
            <>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                onClick={() => {
                  setMenu(null)
                  if (onOpenVideoNode) onOpenVideoNode(menuCard.uuid)
                  else if (onOpenVideo && menuCard.video?.videoId) onOpenVideo(menuCard.video.videoId)
                }}
              >
                {t('打开视频')}
              </button>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                onClick={() => {
                  setMenuText(menuCard.title)
                  setMenu({ ...menu, mode: 'rename' })
                }}
              >
                {t('重命名')}
              </button>
              {menuCard.video?.confirmed && onGenerateVideoDoc && (
                <button
                  type="button"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                  onClick={() => {
                    setMenu(null)
                    onGenerateVideoDoc(menuCard.uuid)
                  }}
                >
                  {t('生成总览')}
                </button>
              )}
            </>
          )}
          {menuCard.kind === 'file' && (
            <button
              type="button"
              className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
              onClick={() => {
                setMenu(null)
                if (onOpenFileNode) onOpenFileNode(menuCard.uuid)
              }}
            >
              {(menuCard.file?.fileKind === 'web' || /^(https?:\/\/|\/\/)/i.test(menuCard.file?.url ?? '') || (menuCard.file?.url ?? '').includes('://'))
                ? t('打开网页')
                : t('打开文件')}
            </button>
          )}
          {menuCard.kind === 'project' && (
            <button
              type="button"
              className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
              onClick={() => {
                setMenuText(menuCard.project?.path ?? '')
                setMenu({ ...menu, mode: 'projectPath' })
              }}
            >
              {menuCard.project?.path ? t('修改路径') : t('设置路径')}
            </button>
          )}
        </>
      ) : menu.mode === 'fileEdit' ? (
        <div className="flex flex-col gap-2 p-2">
          <div className="text-[12px] font-medium text-ink">{t('设置文件或网址')}</div>
          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                menuFileKind === 'local'
                  ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                  : 'bg-line/40 text-ink-soft hover:bg-line/70'
              }`}
              onClick={() => setMenuFileKind('local')}
            >
              {t('本地文件')}
            </button>
            <button
              type="button"
              className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                menuFileKind === 'web'
                  ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                  : 'bg-line/40 text-ink-soft hover:bg-line/70'
              }`}
              onClick={() => setMenuFileKind('web')}
            >
              {t('网页文件')}
            </button>
          </div>
          <div>
            <label className="text-[10px] text-ink-faint">{t('标题')}</label>
            <input
              type="text"
              placeholder={t('节点标题...')}
              value={menuTitleText}
              onChange={(e) => setMenuTitleText(e.target.value.replace(/[\r\n]/g, ''))}
              className="w-full rounded border border-line bg-paper px-2 py-1 text-[11px] text-ink outline-none focus:border-seal dark:bg-card"
            />
          </div>
          <div>
            <label className="text-[10px] text-ink-faint">
              {menuFileKind === 'local' ? t('文件路径（必须位于 files/ 目录下）') : t('网页链接（URL）')}
            </label>
            <input
              type="text"
              placeholder={menuFileKind === 'local' ? 'files/example.pdf' : 'https://...'}
              value={menuText}
              onChange={(e) => setMenuText(e.target.value.replace(/[\r\n]/g, ''))}
              className="w-full rounded border border-line bg-paper px-2 py-1 text-[11px] text-ink outline-none focus:border-seal dark:bg-card"
            />
          </div>
          <div className="flex justify-end gap-1.5 pt-1">
            <button
              type="button"
              className="rounded px-2.5 py-1 text-[11px] text-ink-soft hover:bg-line/60 cursor-pointer"
              onClick={() => setMenu(null)}
            >
              {t('取消')}
            </button>
            <button
              type="button"
              className="rounded bg-seal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-seal-deep cursor-pointer"
              onClick={() => {
                if (onBindFile) {
                  const res = onBindFile(menu.uuid, {
                    fileKind: menuFileKind,
                    url: menuText.trim(),
                    title: menuTitleText.trim() || undefined,
                  })
                  report(res)
                }
                setMenu(null)
              }}
            >
              {t('确定')}
            </button>
          </div>
        </div>
      ) : menu.mode === 'projectPath' ? (
        /*
          项目卡的路径输入态：拼法**由输入的路径自己说**（盘符 / `/` 开头 = 绝对，
          其余相对目标根目录），徽标实时跟随；「浏览…」弹系统目录选择器，选中的
          是绝对路径。保存走统一通道（onSetProjectPath → 节点对象的 editContent），
          与 agent 的 editContent({ path }) 同一条路；宿主那一侧保存成功后会把
          还不存在的目录建出来、并清掉这枚卡的目录树缓存（换路径立即生效）。
        */
        <div className="flex flex-col gap-1.5 p-1">
          <div className="text-[10px] text-ink-faint">
            {menuCard.project?.path ? t('修改这条项目声明（声明的路径及其子树对 agent 开放）') : t('声明一条真实路径：相对目标根目录，或电脑上的绝对路径')}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="shrink-0 rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:text-teal-300"
              title={
                inferPathKind(menuText) === 'absolute'
                  ? t('电脑上的绝对路径（如 D:\\projects\\demo 或 /home/me/demo）')
                  : t('相对目标根目录：docs/{目标段}/ 之下，支持用 .. 移到兄弟目录')
              }
            >
              {inferPathKind(menuText) === 'absolute' ? t('绝对') : t('相对')}
            </span>
            <input
              autoFocus
              value={menuText}
              onChange={(e) => setMenuText(e.target.value)}
              placeholder={inferPathKind(menuText) === 'absolute' ? t('如：D:\\projects\\demo') : t('如：代码练习 或 ../共享资料')}
              className="min-w-0 flex-1 rounded border border-line bg-paper/80 px-1.5 py-1 text-[12px] text-ink outline-none focus:border-teal-500/50"
            />
            <button
              type="button"
              title={t('从系统目录选择器里挑一条真实路径')}
              className="shrink-0 rounded bg-line/60 px-2 py-1 text-[11px] text-ink-soft hover:bg-line/90 transition cursor-pointer"
              onClick={async () => {
                try {
                  const r = await native().pickProjectDirectory()
                  if (!r.canceled && r.path) setMenuText(r.path)
                } catch {
                  onToast?.(t('这个环境打不开目录选择器：直接输入路径即可'))
                }
              }}
            >
              {t('浏览…')}
            </button>
          </div>
          <div className="flex justify-end gap-1">
            <button
              type="button"
              className="rounded px-2 py-1 text-[11px] text-ink-soft hover:bg-line/60"
              onClick={() => setMenu(null)}
            >
              {t('取消')}
            </button>
            <button
              type="button"
              className="rounded bg-teal-500/15 px-2 py-1 text-[11px] text-teal-700 hover:bg-teal-500/25 dark:text-teal-300"
              onClick={async () => {
                const path = menuText.trim()
                setMenu(null)
                if (!path || !onSetProjectPath) return
                const r = await onSetProjectPath(menu.uuid, path)
                // 换路径 = 旧的目录树缓存整体作废：清掉之后重新展开就是新路径的内容
                clearProjCache(menu.uuid)
                report(r)
              }}
            >
              {t('保存')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 p-1">
          <div className="text-[10px] text-ink-faint">
            {menu.mode === 'note'
              ? t('写一句注释，贴在卡片底部')
              : t('改笔记名（文件名一起改）')}
          </div>
          <textarea
            autoFocus
            value={menuText}
            onChange={(e) => setMenuText(e.target.value)}
            rows={menu.mode === 'note' ? 3 : 1}
            className="w-full resize-none rounded border border-line bg-paper/80 px-1.5 py-1 text-[12px] text-ink outline-none focus:border-seal/50"
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              className="rounded px-2 py-1 text-[11px] text-ink-soft hover:bg-line/60"
              onClick={() => setMenu(null)}
            >
              {t('取消')}
            </button>
            <button
              type="button"
              className="rounded bg-seal/15 px-2 py-1 text-[11px] text-seal-deep hover:bg-seal/25"
              onClick={() => {
                if (menu.mode === 'note') saveNote(menuCard.uuid, menuCard, menuText)
                else if (menu.mode === 'rename') saveRename(menuCard, menuText)
              }}
            >
              {t('保存')}
            </button>
          </div>
        </div>
      )}
    </WheelStop>
  )
}
