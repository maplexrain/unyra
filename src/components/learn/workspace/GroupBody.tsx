import { useMemo } from 'react'
import { ExternalLink, Globe, Maximize2, Minimize2 } from 'lucide-react'
import type { LearnTab } from '../../../learn/types'
import { tabTitle, tabKey, isPdfFile } from '../../../learn/tabs'
import { setFocus, focusTabsInGroup } from '../../../learn/groups'
import { nodeById, resolveDisplayedConversation } from '../../../learn/graph'
import { updateFileNode } from '../../../learn/fileNodes'
import { getOutlineSlot } from '../../../lib/outline'
import { requestSourceReveal, localRevealKey, nodeRevealKey } from '../../../lib/docReveal'
import { isWeb } from '../../../lib/native'
import { openExternalLink } from '../../../lib/externalLink'
import { CHIP_MIME, parseChipJson } from '../../../lib/chipSyntax'
import { parseSuperHref, handleSuperLink } from '../../../lib/nodeLink'
import { wsRelOfTab } from '../../../learn/workspace'
import { userAbsPath } from '../../../lib/storage'
import { globalSummary } from '../../../ai/settings'
import { saveAgentSettings } from '../../../agent/settings'
import { t } from '../../../i18n'
import TabBar from '../TabBar'
import WebTabLayer, { type WebTab } from '../web/WebTabLayer'
import VideoTabLayer, { type VideoTab } from '../../video/VideoTabLayer'
import FindBar from '../FindBar'
import SuperDocView from '../SuperDocView'
import LocalDoc from '../LocalDoc'
import DraftDoc from '../DraftDoc'
import SourceEditor from '../SourceEditor'
import ExamCopyView from '../ExamCopyView'
import DocFloat from '../DocFloat'
import { computeRelations } from '../docRelations/computeRelations'
import PluginDoc from '../../plugins/PluginDoc'
import SponsorsDoc from '../../sponsor/SponsorsDoc'
import SettingsPanel from '../../settings/SettingsPanel'
import UsagePanel from '../../settings/UsagePanel'
import { SchedulePage } from '../../schedule/SchedulePage'
import MindPanel from '../../agent/MindPanel'
import AgentSettingsPanel from '../../AgentSettingsPanel'
import { EmptyDoc } from './chrome'
import { DocPane } from './DocPane'
import { OutlinePane } from './OutlinePane'
import { paneInfo, examCopyOf, conceptKeysOf } from './panes'
import { createVideoTabBridge } from './videoTabBridge'
import { ZONE_BOX } from './drag'
import { SRC_SCROLL_SUFFIX } from './constants'

import type { GroupBodyCtx } from './GroupBodyCtx'

/**
/**
 * 一格正文的完整渲染：页签栏（含收起补间）、页签类型分派、常驻正文/大纲/视频/网页层、
 * 查找条、悬浮组、纯净阅读按钮与拖页签落点高亮。
 *
 * 从 LearnWorkspace.renderGroup 原样搬入：格内派生在这里现算，宿主能力全部走 ctx。
 */
export function renderGroupBody(ctx: GroupBodyCtx) {
  const {
    groupId,
    store,
    docs,
    getLatest,
    set,
    onToast,
    openTab,
    onRootChanged,
    tabOwners,
    shownTabIds,
    residentPanes,
    activeGoalId,
    activeTab,
    docView,
    docSource,
    docPending,
    unsavedIds,
    tabTrails,
    webMeta,
    patchWebMeta,
    outlineFocus,
    handleOutlineFocusHandled,
    pure,
    pureMoving,
    toggleZen,
    essayGoalId,
    setEssayOpen,
    essayBtnRef,
    findMode,
    findTick,
    setFindMode,
    docSaving,
    docSaveError,
    localSaved,
    localTicks,
    editDocSource,
    stageLocalDraft,
    stageNewFileDraft,
    saveDocNow,
    closeTab,
    setTabView,
    rememberScroll,
    docScale,
    editorScale,
    activateTab,
    reorderTabList,
    toggleTabPin,
    onTabDragMove,
    onTabDrop,
    tabDrag,
    tabDocPayload,
    openChipInGroup,
    openNewFileInPlace,
    pickLocalInPlace,
    openWebInPlace,
    openNewGoalInPlace,
    openWebTab,
    openBlankTab,
    commitWebUrl,
    pendingJumpsRef,
    isTabFavorite,
    toggleTabFavorite,
    isUrlFavorite,
    toggleUrlFavorite,
    favoriteTitleOf,
    openFavorite,
    blankRecents,
    openRecent,
    scheduleActions,
    scheduleRinging,
    memoryCreate,
    memoryUpdate,
    memoryDelete,
    memoryClearWork,
    agentSettings,
    hasKey,
    debugWin,
    openContextTrace,
    workflowRows,
    runWorkflowRow,
    removeWorkflowRow,
    requestGenerateDoc,
    getNoteActions,
    agent,
    updateStructure,
    explorerDocs,
    explorerExams,
    canvasChannel,
    runSuperMethod,
    onDocPointerDown,
    docMarkMoved,
    docBox,
    groupHosts,
    stripHosts,
    examTabTitle,
  } = ctx
  const g = paneInfo(store, docs, groupId, examTabTitle)
  const dg = g
  const gTab = g.tab
  /** 这一格显示的页签 id；回调里用（TS 的收窄穿不进闭包，见下面几处 onChange） */
  const gTabId = gTab?.id ?? ''
  /** 网页页签携带的 URL：闭包里用（TS 的收窄穿不进闭包） */
  const gWebUrl = gTab?.ref.kind === 'web' ? gTab.ref.url : ''
  const isFocused = groupId === docs.focus
  const gExam = examCopyOf(store, gTab)
  const panes = residentPanes.filter((p) => p.group === groupId)
  /**
   * 这一格**看得见**的页签：公共 + 当前目标，且本目标的排在前面（见 groups/goals）。
   *
   * 页签实体仍全部住在 groups 里（切目标不关页签，切回来原样还在），
   * 这里只是决定「这一格现在把哪几张画在栏上」——所以它同时是页签栏的顺序来源。
   */
  const gVisibleTabs = focusTabsInGroup(
    (g.group?.tabs ?? []).filter((t) => shownTabIds.has(t.id)),
    tabOwners,
    activeGoalId,
  )
  /** 这一格挂着的网页页签：WebTabLayer 常驻层只挂一份，切页签只藏不卸（见下） */
  const gWebTabs = gVisibleTabs.filter((x): x is WebTab => x.ref.kind === 'web')
  /** 这一格挂着的视频页签（含创建态）：VideoTabLayer 常驻，切页签只藏不卸（用户定的 keepalive） */
  const gVideoTabs = (g.group?.tabs ?? []).filter((x): x is VideoTab => x.ref.kind === 'video')
  /** 视频页签的五个写库回调（按格现造：onCreate 要关掉本格的草稿页签），见 workspace/videoTabBridge */
  const videoBridge = createVideoTabBridge({ getLatest, set, openTab, activeGoalId, onToast, closeTab, groupId })
  /** 这一格挂着的大纲页签：keepalive 常驻，切页签只藏不卸，切回时保留导图相机视角与选中状态 */
  const gOutlineTabs = (g.group?.tabs ?? []).filter(
    (x): x is LearnTab & { ref: { kind: 'outline'; nodeId: string; goalId?: string } } => x.ref.kind === 'outline',
  )
  const gNodeId = dg.node?.id ?? (gTab?.ref && 'nodeId' in gTab.ref ? (gTab.ref as { nodeId: string }).nodeId : undefined)
  const relations = useMemo(
    () => (gNodeId ? computeRelations(store, gNodeId, gTab?.ref) : undefined),
    [store, gNodeId, gTab?.ref],
  )

  /** 这一格的正文层：切页签的过场、查找条与数据属性都挂在它身上 */
  const boxProps = {
    'data-doc-area': groupId,
    // 焦点格的额外标记：ui.scroll / ui.dom / 导出抓图都只认它（见 lib/docDom）
    'data-doc-area-focus': isFocused ? '' : undefined,
  }
  return (
    <div
      key={groupId}
      ref={(el) => {
        if (el) groupHosts.current.set(groupId, el)
        else groupHosts.current.delete(groupId)
      }}
      /*
       * 指针落在哪一格，焦点就挪到哪一格：ui.dom、Ctrl+S、导出、下一页签都跟着焦点走。
       * 挂在**捕获之外的这一层**（冒泡到这里时正文自己那套处理已经跑完），只改状态、不拦事件。
       */
      onPointerDown={() => {
        const s = getLatest()
        if (s.docArea.focus !== groupId) set({ ...s, docArea: setFocus(s.docArea, groupId) })
      }}
      /*
       * 整格铺 bg-paper：文档、设置、用量、守卫报告……各类页签的正文底色共用这同一层。
       * 有的页签内容自己不带背景（用量页、空格子），不铺的话它们会露出更底层的深色，
       * 切页签时整个文档区一明一暗地跳。
       */
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-paper"
    >
      {/*
        页签栏：纯净阅读时整条收起。

        手法是「格子高度闭合 + 整条向上滑出去」两件事同时做：
        - 高度交给 grid-template-rows 的 1fr → 0fr 补间（Chrome 107 起可补间），
          这样不必去量页签栏此刻多高——它是随页签内容变的；
        - 内容自己 translateY(-100%) 从顶边滑出去，于是看着是「收上去」而不是「被压扁」。

        裁溢出（用的是 overflow-clip，理由见下）**只在收起与补间期间**加：平时必须放开，
        页签顶上那颗棱形（见 TabBar 的 measureMark）是探出栏外的，裁了就没了。
        棱形在补间里确实会被裁掉——它本来就在最上沿，是第一个滑出去的，看不见也不突兀。
      */}
      <div
        className={
          'grid shrink-0 grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-300 ease-out ' +
          (pure ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')
        }
      >
        {/*
          列轨必须锁成 minmax(0,1fr)：不写列模板时隐式轨道按内容的 max-content 取宽，
          而页签是 shrink-0 的——页签一多轨道就把整条 grid 撑得比文档列更宽，
          页签条的 overflow-x-auto 永远等不到触发的机会，页签直接画进隔壁导师栏。
          锁住之后轨道宽 = 文档列宽，页签超了才真正「溢出」，滚动接管。

          裁溢出用 overflow-clip 而不是 hidden：hidden 会生成一个滚动容器，
          里面那些页签按钮一旦被 Tab 聚焦，这一格就会被滚走（同 NoteDialog 的取舍）。
        */}
        <div className={'min-h-0 ' + (pure || pureMoving ? 'overflow-clip' : '')}>
          {/*
            invisible 与位移一起走：滑出去之后整条栏还在 DOM 里（页签、关闭键都在），
            不加它，Tab 键还会一个个跳进那些看不见的按钮里。
            visibility 参与补间是「到末尾才真的切过去」，所以它是等滑完了才失效的
            （与右侧栏收起时的做法一致，见 SplitRow）。
          */}
          <div
            className={
              'transition-[transform,visibility] duration-300 ease-out ' +
              (pure ? '-translate-y-full invisible' : '')
            }
          >
            <TabBar
              tabs={gVisibleTabs}
              paneTotal={g.group?.tabs.length}
              activeId={g.group?.active ?? null}
              titleOf={(ref) =>
                tabTitle(ref, (id) => nodeById(store, id)?.title, examTabTitle, (vid) => store.videoNodes?.find((vn) => vn.id === vid)?.title ?? store.videos?.find((v) => v.id === vid)?.title)
              }
              trailOf={(ref) => tabTrails[tabKey(ref)] ?? ''}
              onActivate={activateTab}
              onClose={(id, mode, opts) => closeTab(groupId, id, mode, opts)}
              onReorder={(ids) => reorderTabList(groupId, ids)}
              unsaved={unsavedIds}
              onDragMove={onTabDragMove}
              onStripHost={(el) => {
                if (el) stripHosts.current.set(groupId, el)
                else stripHosts.current.delete(groupId)
              }}
              // 上层只认坐标（它知道别的格在哪），TabBar 交出落点那一刻的指针位置
              onDrop={(tabId, _ids, x, y, commit) => onTabDrop(tabId, x, y, commit)}
              // 页签拖进对话输入框时交给它的那份信息（路径信息在这里算，TabBar 不认得 store）
              docPayloadOf={tabDocPayload}
              // web 页签的活标题/站点图标（加载完才有，见 WebTabMeta）
              webMetaOf={(tab) => (tab.ref.kind === 'web' ? webMeta[tab.id] : undefined)}
              // 右键菜单的收藏/取消收藏（见 learn/favorites）
              favoriteOf={isTabFavorite}
              onToggleFavorite={toggleTabFavorite}
              onTogglePin={(tab) => toggleTabPin(groupId, tab)}
              // 资源管理器/外部拖进来的引用落在这一格的页签栏上：还原成页签开在这一格里
              onDropChip={openChipInGroup(groupId)}
              // 棱形只在焦点格的栏上跟着右键走（见 lib/tabMark）
              focused={isFocused}
              // 栏上空白处的右键菜单要开新网页页签（见 TabBar 的 BarMenu）；WebUI 模式下不提供
              onOpenWebTab={isWeb() ? undefined : () => openWebTab('')}
              // 「新页签」就长在最后一枚页签后面（原先在顶栏，见 TabBar 的 onNewTab）
              onNewTab={() => openBlankTab()}
              store={store}
            />
          </div>
        </div>
      </div>

      {/*
        文档内容 + 右上角悬浮组。悬浮组是绝对定位的，所以这一层必须 relative，
        并且它是**唯一**能被悬浮组盖住的地方——它不会跑到页签栏或对话栏上去。
      */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onPointerDown={onDocPointerDown}
        onContextMenu={(e) => {
          // 刚用右键划过：这一下 contextmenu 是那趟划动的尾巴，不是「要上下文」
          if (!docMarkMoved.current) return
          docMarkMoved.current = false
          e.preventDefault()
          e.stopPropagation()
        }}
      >
          <div
            ref={isFocused ? docBox : undefined}
            {...boxProps}
            className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
            onDragOver={(e) => {
            // 整个正文区都是 chip 的落点：资源管理器 / 收藏里拖来的引用，拖到这里
            // 直接开成本格的页签（不必再瞄准上面那条窄页签栏）。系统文件拖入
            // （dataTransfer.files）走 window 级的监听，这里只认 chip。
            if (!e.dataTransfer.types.includes(CHIP_MIME)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData(CHIP_MIME)
            if (!raw) return
            e.preventDefault()
            const p = parseChipJson(raw)
            if (p) openChipInGroup(groupId)(p)
          }}
          onDoubleClick={(e) => {
            /*
              快速双击 = 切换纯净阅读（与右上角那颗按钮、F11 同一件事）。
              双击在文字上本来就是「选一个词」：**命中的是词本身**（指针落在选区矩形里）
              就不当开关，不然读正文时随手双击一个词就进出了。要靠选区矩形而不是
              「选区空不空」来判：点在段落空白 / 行边距上时，Chromium 会顺手选中最邻近
              的词——选区非空，但那个词不在指针底下，这次双击该归开关。
              点在按钮 / 输入框 / 链接这类可交互的东西上也不算。
              超级文档是 iframe，guest 里的事件到不了这里，天然不受影响。
            */
            const sel = window.getSelection()
            if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
              const r = sel.getRangeAt(0).getBoundingClientRect()
              if (
                e.clientX >= r.left - 2 &&
                e.clientX <= r.right + 2 &&
                e.clientY >= r.top - 2 &&
                e.clientY <= r.bottom + 2
              ) {
                return
              }
              // 顺手选中的那个词不是用户要的：清掉，别让切换后还挂着一截蓝
              sel.removeAllRanges()
            }
            const el = e.target as HTMLElement
            if (el.closest('button, input, textarea, a, iframe, [contenteditable="true"], [role="button"]')) return
            toggleZen()
          }}
        >
          {gTab?.ref.kind === 'web' ? (
            /*
              网页页签：正文不归 React 画（guest 进程自己渲染），由下面挂着的
              WebTabLayer 常驻层显示——这里只让出位置，别画任何东西。
              WebUI 模式下不支持内置浏览器，展示在当前浏览器中打开的引导卡片。
            */
            isWeb() ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-card p-6 text-center select-none">
                <Globe size={32} className="text-seal/70" />
                <div className="text-[14px] font-semibold text-ink-strong">{t('WebUI 模式不支持内置浏览器')}</div>
                <p className="max-w-md text-[12px] text-ink-faint">
                  {gWebUrl ? t('该网页可在当前浏览器新标签页中打开访问。') : t('WebUI 模式下请直接在当前浏览器中浏览网页。')}
                </p>
                {gWebUrl && (
                  <button
                    type="button"
                    onClick={() => void openExternalLink(gWebUrl)}
                    className="flex items-center gap-1.5 rounded-lg bg-seal px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-seal-deep cursor-pointer"
                  >
                    <ExternalLink size={13} />
                    {t('在当前浏览器打开')}
                  </button>
                )}
              </div>
            ) : null
          ) : gTab?.ref.kind === 'blank' ? (
            /*
              空白页签（底页）：显示无页签引导卡片（打开本地文件 / 浏览网络 / 新建目标），
              并在当前页签中快速就地打开。
            */
            <EmptyDoc
              onNewFile={() => openNewFileInPlace(groupId, gTab.id)}
              onPickLocal={() => void pickLocalInPlace(groupId, gTab.id)}
              onOpenWeb={isWeb() ? undefined : () => openWebInPlace(groupId, gTab.id)}
              onNewGoal={() => openNewGoalInPlace(groupId, gTab.id)}
              hasGoals={(store.goals ?? []).length > 0}
              // 收藏 / 最近打开两栏（原侧栏的「最近打开」区挪到这里，见 EmptyDoc）
              favorites={store.favorites ?? []}
              favoriteTitleOf={favoriteTitleOf}
              onOpenFavorite={openFavorite}
              recents={blankRecents}
              onOpenRecent={openRecent}
            />

          ) : gTab?.ref.kind === 'schedule' ? (
            /*
              日程安排页：用户级的一张提醒清单（见 learn/schedule）。全局一枚页签，
              入口在顶栏日程 tip 与到点提醒弹层；页面自己只管展示与编辑态，写操作
              全部经 scheduleActions 交回这一层。
            */
            <SchedulePage
              store={store}
              actions={scheduleActions}
              onToast={onToast}
              ringingId={scheduleRinging?.id ?? null}
            />
          ) : gTab?.ref.kind === 'usage' ? (
            /*
              用量统计：独立的一枚页签（入口在顶栏用户菜单）。它读的是「台账」
              （ai/usageLog）而不是配置，所以不挤在设置里；页面自己订阅台账重渲染。
            */
            <UsagePanel />
          ) : gTab?.ref.kind === 'video' ? (
            /*
              视频页签：由下面的 VideoTabLayer 常驻层画（切页签只藏不卸，
              播放与已解析的流都留着）。这里只让出位置，别画任何东西。
            */
            null
          ) : gTab?.ref.kind === 'pluginDoc' ? (
            /*
              插件开发文档（设置 → 插件里的入口打开）：契约说明 + 导出 .md。
              静态内容，没有会话态（见 components/plugins/PluginDoc）。
            */
            <PluginDoc />
          ) : gTab?.ref.kind === 'sponsors' ? (
            /*
              赞助者名单与特别鸣谢页签：docs/sponsors.md Markdown 原文渲染。
              静态内容，提供导出与致谢名册（见 components/sponsor/SponsorsDoc）。
            */
            <SponsorsDoc />
          ) : gTab?.ref.kind === 'settings' ? (
            /*
              设置面板：文档区的一枚页签（不再是弹窗）。全局只有这一份（tabKey 恒定），
              从任何入口打开都是切到它；分页与内容都在面板内部（见 settings/SettingsPanel）。
            */
            <SettingsPanel
              onRootChanged={onRootChanged}
              onToast={onToast}
              scheduleSound={store.schedule?.sound}
              onScheduleSoundChange={scheduleActions.setSound}
              onSwitchSection={(sec) => openTab({ kind: sec === 'agent' ? 'agentSettings' : 'settings' })}
            />
          ) : gTab?.ref.kind === 'mind' ? (
            /*
              记忆管理：导师写下的记忆（learn/memory）的查看与编辑。**一枚目标一枚页签**
              （tabKey = 'm:' + goalId），打开时默认筛到该目标的工作记忆；长期记忆跨目标，
              这一页也看得到。目标删掉时页签一起关（见 deleteGoal）。
              界面与设置页里的「记忆管理」是同一份实现（components/agent/MemoryManager）。
            */
            <MindPanel
              goalId={gTab.ref.goalId}
              goals={store.goals}
              memory={store.memory ?? { long: [], work: {} }}
              onCreate={memoryCreate}
              onUpdate={memoryUpdate}
              onDelete={memoryDelete}
              onClearWork={memoryClearWork}
              onToast={onToast}
            />
          ) : gTab?.ref.kind === 'agentSettings' ? (
            /*
              超级导师设置：原先是弹窗，现在是文档区的一枚页签。数据是 agent/settings
              那一份（与全局设置分开），改动当场生效。
            */
            <AgentSettingsPanel
              settings={agentSettings}
              hasKey={hasKey}
              model={globalSummary()}
              onChange={(next) => {
                saveAgentSettings(next)
                onToast(t('超级导师设置已保存'))
              }}
              onOpenContextDebugger={() => debugWin.setOpen(true)}
              onOpenContextTrace={openContextTrace}
              flowRows={workflowRows}
              onRunWorkflow={runWorkflowRow}
              onRemoveWorkflow={removeWorkflowRow}
              goals={store.goals}
              memory={store.memory ?? { long: [], work: {} }}
              activeGoalId={activeGoalId}
              onMemoryCreate={memoryCreate}
              onMemoryUpdate={memoryUpdate}
              onMemoryDelete={memoryDelete}
              onMemoryClearWork={memoryClearWork}
              onToast={onToast}
              onSwitchSection={(sec) => openTab({ kind: sec === 'agent' ? 'agentSettings' : 'settings' })}
            />
          ) : gTab?.ref.kind === 'draft' ? (
            /*
              新建文件：还没有落点、也没有类型的那一份正文（见 DraftDoc）。
              正文住在暂存区里（基准是空文档），保存那一步才问路径与文件名，
              后缀一确定，这枚页签当场换成指向那个文件的本地文件页签。
              没有 key：它不指向任何外部东西，也就没有「重挂重读」这回事。
            */
            <DraftDoc
              draft={dg.draft}
              scale={editorScale}
              onDraft={(text) => stageNewFileDraft(gTabId, text)}
              saving={docSaving}
              saveError={docSaveError}
              onSave={() => void saveDocNow()}
            />
          ) : gTab?.ref.kind === 'local' ? (
            /*
              本地文件：内容不在数据目录里，读取与落盘都由它自己管（见 LocalDoc）。
              key 绑「路径 + 外部版本号」：换一个文件、或文件在外部被改过（应用里
              没有暂存改动，见 useDocSaveFlow 的 handleLocalChange）就重挂重读，上一份的
              「未保存」状态不会串到这一份上。文件丢失的兜底关页签不弹确认（confirm:false）——
              文件都不在了，没有「保存」可言。
            */
            <LocalDoc
              key={gTab.ref.path + '#' + (localTicks[gTab.ref.path] ?? 0)}
              path={gTab.ref.path}
              view={dg.view}
              scale={docScale}
              editorScale={editorScale}
              draft={dg.draft}
              savedText={localSaved?.path === gTab.ref.path ? localSaved.text : undefined}
              onDraft={(text) => stageLocalDraft(gTabId, text)}
              saving={docSaving}
              saveError={docSaveError}
              onMissing={() => closeTab(groupId, gTab.id, 'self', { confirm: false })}
              outlineSlot={getOutlineSlot(gTab.id)}
              // 空 md 默认进编辑（空预览是一片白）：读完内容发现是空的，从预览切过来
              onNeedEdit={() => setTabView(gTab.id, 'source')}
              // 右键菜单的「定位源码」：先放下选中哪一段，再切到源码视图（见 lib/docReveal）
              onRevealSource={(loc) => {
                if (gTab?.ref.kind !== 'local') return
                requestSourceReveal(localRevealKey(gTab.ref.path), loc.start, loc.end)
                setTabView(gTab.id, 'source')
              }}
              onToast={onToast}
            />
          ) : gTab?.ref.kind === 'ws' ? (
            /*
              工作区（项目）内部文件：渲染与本地文件共用 LocalDoc（读 / 改 / 保存体验同一套），
              差别只在路径的来源——rel 从节点工作区现推（节点改名跟着走），再换算绝对路径。
              推不出来（节点刚被删）给一句话，而不是留一片白。
            */
            (() => {
              const rel = wsRelOfTab(store, gTab.ref)
              const abs = rel ? userAbsPath(rel) : null
              if (!abs) {
                return (
                  <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
                    {t('这份工作区文件已经不在了（节点或项目被删掉了）')}
                  </div>
                )
              }
              return (
                <LocalDoc
                  key={abs + '#' + (localTicks[abs] ?? 0)}
                  path={abs}
                  view={dg.view}
                  scale={docScale}
                  editorScale={editorScale}
                  draft={dg.draft}
                  savedText={localSaved?.path === abs ? localSaved.text : undefined}
                  onDraft={(text) => stageLocalDraft(gTabId, text)}
                  saving={docSaving}
                  saveError={docSaveError}
                  onMissing={() => closeTab(groupId, gTab.id, 'self', { confirm: false })}
                  outlineSlot={getOutlineSlot(gTab.id)}
                  onNeedEdit={() => setTabView(gTab.id, 'source')}
                  // 右键菜单的「定位源码」：先放下选中哪一段，再把这个页签切到源码视图
                  // （切完预览就卸载了，选区也随之消失，顺序不能反，见 lib/docReveal）
                  onRevealSource={(loc) => {
                    requestSourceReveal(localRevealKey(abs), loc.start, loc.end)
                    setTabView(gTab.id, 'source')
                  }}
                  onToast={onToast}
                />
              )
            })()
          ) : gTab?.ref.kind === 'exam' ? (
            /*
              试卷副本：只读的一次考试（卷子原件 + 那次作答 + 判分 + 错题讲解）。
              它与其它页签最大的不同：**内容不由节点决定**，而是由 examId + attemptId 决定，
              所以它排在前面的分支里，也不受「此刻在看哪个节点」影响。
            */
            gExam.exam && gExam.attempt ? (
              <ExamCopyView exam={gExam.exam} attempt={gExam.attempt} />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
                {t('这份试卷已经被删了，这一次考试的内容也一并没了。')}
              </div>
            )
          ) : gTab?.ref.kind === 'outline' ? (
            /*
              大纲页：思维导图采用 keepalive 常驻（见下方的 gOutlineTabs），
              切去其它页签时仅隐藏保活，切回时零延迟复原相机与状态。这里让出位置。
            */
            null
          ) : gTab?.ref.kind === 'super' && dg.node && dg.superDoc ? (
            /*
              超级文档：一份完整的可交互 HTML。预览跑在沙箱化的 iframe 里
              （见 SuperDocView），源码视图直接改 HTML——暂存与 Ctrl+S 与
              其它文档同一套（保存写回 node.superdocs，见 saveDocNow）。
              key 绑「节点 + 名字」：换一份就重挂，脚本从头执行、状态归零。
            */
            dg.view === 'source' ? (
              <SourceEditor
                key={dg.node.id + ':super:' + gTab.ref.name}
                value={dg.draft ?? dg.superDoc.html}
                onChange={(text) => editDocSource(gTabId, text)}
                state={docSaving ? 'saving' : dg.draft === undefined ? 'saved' : 'dirty'}
                label={dg.title}
                scale={editorScale}
                scrollTop={store.docScroll[gTabId + SRC_SCROLL_SUFFIX]}
                onScrollTop={(top) => rememberScroll(gTabId + SRC_SCROLL_SUFFIX, top)}
                ext=".html"
              />
            ) : (
              <SuperDocView
                key={dg.node.id + ':super:' + gTab.ref.name}
                html={dg.superDoc.html}
                onMethodCall={runSuperMethod}
                // 文档里的 moji:super 链接：BRIDGE 拦截后转回来，走上面注册的同一个处理器
                onSuperLink={(href) => {
                  const target = parseSuperHref(href)
                  if (target) handleSuperLink(target)
                }}
              />
            )
          ) : dg.node && dg.source ? (
            dg.view === 'source' ? (
              /*
                源码视图：直接改 Markdown。改动先进**暂存区**（见 learn/drafts），
                按 Ctrl+S 才写进文档——底栏上的「已保存 / 未保存」读的就是暂存区里
                有没有这一份，而不是「store 落盘了没有」。
              */
              <SourceEditor
                key={dg.title + ':' + dg.source.kind + ':' + (dg.source.note ?? '')}
                value={dg.source.content}
                onChange={(text) => editDocSource(gTabId, text)}
                state={docSaving ? 'saving' : dg.draft === undefined ? 'saved' : 'dirty'}
                label={dg.title}
                scale={editorScale}
                ext=".md"
                // 编辑位置与阅读位置各记各的：同一份文档在源码里改到一半、
                // 切到预览又读到别处，共用一格会互相拽（见 learn/types 的 DocScroll）
                scrollTop={store.docScroll[gTabId + SRC_SCROLL_SUFFIX]}
                onScrollTop={(top) => rememberScroll(gTabId + SRC_SCROLL_SUFFIX, top)}
                // 「定位源码」放下的一次性请求：挂载时按这个身份取走并选中（见 lib/docReveal）
                revealKey={nodeRevealKey(dg.node.id, dg.source.kind, dg.source.note)}
              />
            ) : null /* 预览那一份由下面的常驻列表渲染（见 DocPane） */
          ) : (
            <EmptyDoc
              onNewFile={() => openNewFileInPlace(groupId, gTabId)}
              onPickLocal={() => void pickLocalInPlace(groupId, gTabId)}
              onOpenWeb={isWeb() ? undefined : () => openWebInPlace(groupId, gTabId)}
              onNewGoal={() => openNewGoalInPlace(groupId, gTabId)}
              hasGoals={(store.goals ?? []).length > 0}
              favorites={store.favorites ?? []}
              favoriteTitleOf={favoriteTitleOf}
              onOpenFavorite={openFavorite}
              recents={blankRecents}
              onOpenRecent={openRecent}
            />
          )}

          {/*
            常驻的正文（见 DocPane）：每一格显示着的那一片显示，其余带着 hidden 留在 DOM 里。
            常驻片按**它所属的那一格**分派（见 residentPanes 的 group）：同一片正文在
            两处渲染会各自建一份 DOM，那就白常驻了。
          */}
          {panes.map(({ tab, node, source }) => {
            const paneActive = tab.id === gTab?.id && dg.view === 'preview'
            const goalConvId = resolveDisplayedConversation(store, node.goalId) ?? null
            const isAgentRunning = !!(goalConvId && agent.runningByConversation[goalConvId])
            return (
              <DocPane
                key={tab.id}
                tabId={tab.id}
                active={paneActive}
                node={node}
                source={source}
                // 待写提示说的是「agent 正在给这个节点写文档」，只有眼前这一片才有意义
                pending={paneActive && docPending}
                agentRunning={isAgentRunning}
                onGenerateDoc={requestGenerateDoc}
                onManualWrite={() => {
                  setTabView(tab.id, 'source')
                  if (!source.content.trim()) {
                    editDocSource(tab.id, `# ${node.title}\n\n`)
                  }
                }}
                knownConceptKeys={conceptKeysOf(store, node)}
                // 大纲句柄槽：每片正文对应自己页签的那一份（见 lib/outline 的 OutlineHandle）
                outlineSlot={getOutlineSlot(tab.id)}
                // 读到哪儿了：记在页签 id 上，重启回来接着读（见 lib/docScroll）
                scrollTop={store.docScroll[tab.id]}
                onScrollTop={(top) => rememberScroll(tab.id, top)}
                note={getNoteActions(tab.id, node, source)}
              />
            )
          })}

          {/*
            大纲页常驻层（keepalive）：只要大纲页签在这一格开着，思维导图就常挂在 DOM 中，
            切去其它页签时仅藏不卸，切回时零延迟复原导图相机与选中状态。
          */}
          {gOutlineTabs.map((tab) => {
            const goal = store.goals.find((g) => g.id === tab.ref.nodeId || g.rootNodeId === tab.ref.nodeId)
            const oNode = tab.ref.kind === 'outline' ? nodeById(store, tab.ref.nodeId) : null
            if (!oNode && !goal) return null
            const isActive = gTab?.id === tab.id
            return (
              <OutlinePane
                key={tab.id}
                tabId={tab.id}
                active={isActive}
                store={store}
                node={oNode ?? undefined}
                goalId={goal?.id ?? oNode?.goalId ?? ''}
                onChangeStructure={updateStructure}
                docs={explorerDocs}
                exams={explorerExams}
                channel={canvasChannel}
                onToast={onToast}
                focusTarget={outlineFocus}
                onFocusHandled={handleOutlineFocusHandled}
              />
            )
          })}
        </div>

        {/*
          网页层（见 components/learn/web/WebTabLayer）：常挂在格子里、切去文档时
          整层藏起来（guest 进程照跑）。z-10 盖过正文，又在拖放高亮（z-30）之下。
        */}
        {/* 视频页签常驻层（keepalive）：开着就挂着，切走只藏不卸（见 VideoTabLayer） */}
        {gVideoTabs.length > 0 && (
          <VideoTabLayer
            tabs={gVideoTabs}
            activeId={gTab?.ref.kind === 'video' ? gTab.id : null}
            store={store}
            onCommitStore={set}
            videos={store.videos}
            videoNodes={store.videoNodes}
            {...videoBridge}
          />
        )}

        {!isWeb() && gWebTabs.length > 0 && (
          <WebTabLayer
            tabs={gWebTabs}
            activeId={gTab?.ref.kind === 'web' ? gTab.id : null}
            meta={webMeta}
            hidden={gTab?.ref.kind !== 'web'}
            onMeta={patchWebMeta}
            onCommitUrl={commitWebUrl}
            // 地址栏的收藏星标（收藏认网址，见 learn/favorites）
            favoriteOf={isUrlFavorite}
            onToggleFavoriteUrl={toggleUrlFavorite}
            fileNodes={store.fileNodes}
            onUpdateFileNode={(nodeId, patch) => {
              const r = updateFileNode(getLatest(), nodeId, patch)
              if (!('error' in r)) set(r.store)
            }}
            pendingJumpsRef={pendingJumpsRef}
          />
        )}

        {/*
          查找 / 替换条：浮在正文右上角（见 components/learn/FindBar）。
          它是**全局一个**（Ctrl+F 打开的那一条），所以只画在焦点格上：同时冒出两条，
          用户按 Ctrl+F 时根本不知道往哪一条里打字。
        */}
        {isFocused && findMode && (
          <FindBar
            boxRef={docBox}
            source={docView === 'source'}
            mode={findMode}
            onModeChange={setFindMode}
            focusTick={findTick}
            // 替换只在「源码视图 + 有一份归学习数据管的正文」时可用：
            // 本地文件的正文不归 store 管，预览是只读的
            onReplace={
              docView === 'source' && docSource && activeTab
                ? (text) => editDocSource(activeTab.id, text)
                : undefined
            }
            onClose={() => setFindMode(null)}
          />
        )}

        {/*
          悬浮组（这一格右上角，横向一条，见 components/learn/DocFloat）：左半边是这个
          节点的工具（笔记 / 超级文档 / 学习状态 / 试卷），右半边是这份文档的动作
          （源码 / 预览 / 导出）。一个页签都没有的空格子不画。

          **新建文件页不画**（用户报的：那一条会压住页头右侧的「保存…」按钮）：
          这一页右上角是它自己的页头，保存按钮就长在那儿；而悬浮组里的东西对它也
          基本没意义——还没有类型，切不了预览，大纲也不存在。纯净阅读仍可用 F11。
        */}
        {gTab &&
          gTab.ref.kind !== 'web' &&
          gTab.ref.kind !== 'settings' &&
          gTab.ref.kind !== 'usage' &&
          gTab.ref.kind !== 'schedule' &&
          gTab.ref.kind !== 'mind' &&
          gTab.ref.kind !== 'agentSettings' &&
          gTab.ref.kind !== 'outline' &&
          gTab.ref.kind !== 'draft' &&
          // 视频学习页（实验）也不画：大纲/视图切换对播放器没有意义，纯净阅读
          // 仍可用 F11（用户定的：这一页右上角不要按钮组）
          gTab.ref.kind !== 'video' &&
          // 插件文档页同样不画：它是参考手册，不是可编辑文档
          gTab.ref.kind !== 'pluginDoc' &&
          // 赞助者名单页同样不画：它是致谢名册
          gTab.ref.kind !== 'sponsors' &&
          // PDF 浏览页不画：严格只读，左上角不需要浮动工具栏（纯净阅读仍可用 F11）
          !(gTab.ref.kind === 'local' && isPdfFile(gTab.ref.path)) &&
          !(gTab.ref.kind === 'ws' && isPdfFile(gTab.ref.seg)) && (
          <DocFloat
            /*
             * key 绑「格 + 节点」：换节点时重挂，各块 tip 的展开状态自然回到收起；
             * 拖页签分割之后新格里的悬浮组也是新的一份，不会继承旧格展开着的那块。
             */
            key={groupId + ':' + (dg.node?.id ?? gTab.id)}
            view={dg.view}
            previewable={dg.previewable}
            previewHint={
              dg.emptyNote ? t('这份笔记还是空的：先在源码视图里写点东西，才有得预览') : undefined
            }
            onSwitchView={(v) => setTabView(gTabId, v)}
            showBackToDoc={gTab.ref.kind === 'note' || gTab.ref.kind === 'super'}
            onBackToDoc={() => dg.node && openTab({ kind: 'teach', nodeId: dg.node.id })}
            // 纯净阅读那颗：它与 F11 / Esc 是同一个动作（见 toggleZen）。
            // 每一格的悬浮组都画一颗，而状态是**全局一个**——点哪一格都是同一件事
            pure={pure}
            onTogglePure={toggleZen}
            // 标题大纲：按当前页签的槽取（渲染组件装进去，见 lib/outline 的 OutlineHandle）
            outlineSlot={getOutlineSlot(gTabId)}
            showEssay={Boolean(essayGoalId)}
            onOpenEssay={() => setEssayOpen(true)}
            relations={relations}
            onOpenRelation={(ref, item) => {
              if (item?.kind === 'exam' && item.attemptsCount === 0 && item.examId) {
                explorerExams.onStart(item.nodeId, item.examId)
                return
              }
              openTab(ref)
            }}
            essayBtnRef={essayBtnRef}
          />
        )}

        {/*
          画布页签（大纲页）右上角的纯净阅读入口：悬浮组不画 outline（它不是文档），
          这颗补位。画布内的双击归画布自己（适应画布 / 聚焦节点），进纯净阅读
          只走这颗按钮与 F11——两套双击手势不再打架。
        */}
        {gTab?.ref.kind === 'outline' && (
          <button
            type="button"
            title={pure ? t('退出纯净阅读（F11 / Esc）') : t('纯净阅读：收起两侧栏、页签栏与顶栏，只留正文（F11）')}
            aria-pressed={pure}
            onClick={toggleZen}
            className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center border-0 bg-transparent text-ink-soft transition hover:text-ink hover:scale-105 active:scale-95"
          >
            {pure ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}

        {/*
          拖页签的落点高亮：指针停在某一格的边上时，把那半边画出来——
          松手就长成新的一格。中间那一块是「放进这一格」，画满整格。
        */}
        {tabDrag?.over?.group === groupId && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30">
            <div
              className={
                'absolute rounded-md border-2 border-seal/60 bg-seal/10 transition-all duration-100 ' +
                ZONE_BOX[tabDrag.over.zone]
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}
