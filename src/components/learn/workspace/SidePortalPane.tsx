/**
 * Vim `:side` 页签内传送对照窗格：
 * 将工作区中另一枚已打开页签实时渲染到当前页面旁（读/写直接指向原数据源，
 * 被选中的原页签在原位置不受任何影响，仅通过该通道开出一扇实时对照传送窗）。
 */

import { ArrowLeftRight, ExternalLink, Link2, Video, Globe, X } from 'lucide-react'
import type { LearnTab } from '../../../learn/types'
import { tabKey, tabTitle, viewOf } from '../../../learn/tabs'
import { draftOf } from '../../../learn/drafts'
import { readSuperDoc } from '../../../learn/superdocs'
import { wsRelOfTab } from '../../../learn/workspace'
import { userAbsPath } from '../../../lib/storage'
import { getOutlineSlot } from '../../../lib/outline'
import { parseSuperHref, handleSuperLink } from '../../../lib/nodeLink'
import { requestSourceReveal, localRevealKey, nodeRevealKey } from '../../../lib/docReveal'
import { nodeById } from '../../../learn/graph'
import { isWeb } from '../../../lib/native'
import { openExternalLink } from '../../../lib/externalLink'
import { t } from '../../../i18n'
import { TabTypeIcon } from '../tabbar/TabIcons'
import LocalDoc from '../LocalDoc'
import SuperDocView from '../SuperDocView'
import DraftDoc from '../DraftDoc'
import ExamCopyView from '../ExamCopyView'
import OutlineGuideView from '../OutlineGuideView'
import PluginDoc from '../../plugins/PluginDoc'
import SponsorsDoc from '../../sponsor/SponsorsDoc'
import VimCheatSheetView from '../vim/VimCheatSheetView'
import { SettingsPage } from '../../settings/SettingsPage'
import { PromptFileView } from '../agent-team/PromptFileView'
import UserTabPane from '../../user/UserTabPane'
import TerminalTabPane from '../../terminal/TerminalTabPane'
import UsagePanel from '../../settings/UsagePanel'
import ClassroomView from '../classroom/ClassroomView'
import ClassroomShowcasePage from '../classroom/ClassroomShowcasePage'
import AgentTeamPage from '../agent-team/AgentTeamPage'
import { SchedulePage } from '../../schedule/SchedulePage'
import MindPanel from '../../agent/MindPanel'
import { EmptyDoc } from './chrome'
import { DocPane } from './DocPane'
import { OutlinePane } from './OutlinePane'
import SourceEditor from '../SourceEditor'
import { conceptKeysOf, emptyNote, examCopyOf, paneOf } from './panes'
import { SRC_SCROLL_SUFFIX } from './constants'
import type { GroupBodyCtx } from './GroupBodyCtx'

export interface SidePortalPaneProps {
  ctx: GroupBodyCtx
  targetTab: LearnTab
  mode?: 'side' | 'fixside'
  onClose: () => void
  onSwap: () => void
}

export function SidePortalPane({ ctx, targetTab, mode = 'side', onClose, onSwap }: SidePortalPaneProps) {
  const scopePrefix = mode === 'fixside' ? 'fixside:' : 'side:'
  const {
    store,
    getLatest,
    set,
    onToast,
    openTab,
    docSaving,
    docSaveError,
    localSaved,
    localTicks,
    editDocSource,
    stageLocalDraft,
    stageNewFileDraft,
    setTabView,
    rememberScroll,
    docScale,
    editorScale,
    activateTab,
    openNewFileInPlace,
    pickLocalInPlace,
    openWebInPlace,
    openNewGoalInPlace,
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
    requestGenerateDoc,
    getNoteActions,
    agentSlotDeps,
    updateStructure,
    explorerDocs,
    explorerExams,
    canvasChannel,
    runSuperMethod,
    examTabTitle,
    users,
    activeUserId,
    onSelectUser,
    onCreateUser,
    onUpdateUser,
    onDeleteUser,
    onSignOut,
    groupId,
  } = ctx

  const title = tabTitle(
    targetTab.ref,
    (id) => nodeById(store, id)?.title,
    examTabTitle,
    (vid) => store.videoNodes?.find((vn) => vn.id === vid)?.title ?? store.videos?.find((v) => v.id === vid)?.title,
  )

  const renderContent = () => {
    const ref = targetTab.ref

    if (ref.kind === 'teach' || ref.kind === 'note') {
      const pane = paneOf(store, targetTab)
      if (!pane) {
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
            {t('这份文档已经不在了')}
          </div>
        )
      }
      const isEmpty = emptyNote(store, targetTab)
      const curView = viewOf(targetTab, isEmpty)
      if (curView === 'source') {
        const draft = draftOf(store.drafts, targetTab.id)
        const noteExt =
          pane.source.format === 'typst'
            ? '.typ'
            : pane.source.format === 'html'
              ? '.html'
              : pane.source.format === 'text'
                ? '.txt'
                : '.md'
        const revealKey = nodeRevealKey(pane.node.id, pane.source.kind, pane.source.note)
        return (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SourceEditor
              value={pane.source.content ?? ''}
              ext={noteExt}
              state={docSaving ? 'saving' : draft === undefined ? 'saved' : 'dirty'}
              label={ref.kind === 'note' ? ref.note : pane.node.title}
              historyKey={scopePrefix + targetTab.id}
              scale={editorScale}
              revealKey={revealKey}
              scrollTop={store.docScroll[scopePrefix + targetTab.id + SRC_SCROLL_SUFFIX]}
              onScrollTop={(top) => rememberScroll(scopePrefix + targetTab.id + SRC_SCROLL_SUFFIX, top)}
              onChange={(text) => editDocSource(targetTab.id, text)}
            />
          </div>
        )
      }
      return (
        <DocPane
          tabId={scopePrefix + targetTab.id}
          active
          node={pane.node}
          source={pane.source}
          pending={false}
          agentRunning={false}
          onGenerateDoc={requestGenerateDoc}
          onManualWrite={() => {
            setTabView(targetTab.id, 'source')
            if (!pane.source.content.trim()) {
              editDocSource(targetTab.id, `# ${pane.node.title}\n\n`)
            }
          }}
          knownConceptKeys={conceptKeysOf(store, pane.node)}
          goalKnowledge={store.knowledge?.[pane.node.goalId] ?? []}
          outlineSlot={getOutlineSlot(scopePrefix + targetTab.id)}
          scrollTop={store.docScroll[scopePrefix + targetTab.id]}
          onScrollTop={(top) => rememberScroll(scopePrefix + targetTab.id, top)}
          note={getNoteActions(targetTab.id, pane.node, pane.source)}
        />
      )
    }

    if (ref.kind === 'outline') {
      const goal = store.goals.find((g) => g.id === ref.nodeId || g.rootNodeId === ref.nodeId || g.id === ref.goalId)
      const oNode = nodeById(store, ref.nodeId)
      if (!oNode && !goal) {
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
            {t('这份大纲已经不在了')}
          </div>
        )
      }
      return (
        <OutlinePane
          tabId={scopePrefix + targetTab.id}
          active
          store={store}
          node={oNode ?? undefined}
          goalId={goal?.id ?? oNode?.goalId ?? ''}
          onChangeStructure={updateStructure}
          docs={explorerDocs}
          exams={explorerExams}
          channel={canvasChannel}
          onToast={onToast}
        />
      )
    }

    if (ref.kind === 'guide') {
      return <OutlineGuideView store={store} outlineId={ref.outlineId} scale={docScale} />
    }

    if (ref.kind === 'super') {
      const superDoc = readSuperDoc(store, ref.nodeId, ref.name)
      const node = nodeById(store, ref.nodeId)
      if (!superDoc || !node) {
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
            {t('这份超级文档已经不在了')}
          </div>
        )
      }
      const curView = viewOf(targetTab, false)
      if (curView === 'source') {
        const draft = draftOf(store.drafts, targetTab.id)
        return (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SourceEditor
              value={draft ?? superDoc.html}
              ext=".html"
              state={docSaving ? 'saving' : draft === undefined ? 'saved' : 'dirty'}
              label={ref.name}
              historyKey={'side:' + targetTab.id}
              scale={editorScale}
              onChange={(text) => editDocSource(targetTab.id, text)}
            />
          </div>
        )
      }
      return (
        <SuperDocView
          key={'side:' + node.id + ':super:' + ref.name}
          html={superDoc.html}
          onMethodCall={runSuperMethod}
          onSuperLink={(href) => {
            const target = parseSuperHref(href)
            if (target) handleSuperLink(target)
          }}
        />
      )
    }

    if (ref.kind === 'prompt') {
      return (
        <PromptFileView agentId={ref.agentId} layer={ref.layer} fileId={ref.fileId} />
      )
    }

    if (ref.kind === 'local' || ref.kind === 'ws') {
      const absPath =
        ref.kind === 'local'
          ? ref.path
          : (() => {
              const rel = wsRelOfTab(store, ref)
              return rel ? userAbsPath(rel) : null
            })()
      if (!absPath) {
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
            {t('这份工作区文件已经不在了（节点或项目被删掉了）')}
          </div>
        )
      }
      return (
        <LocalDoc
          path={absPath}
          view={viewOf(targetTab, false)}
          scale={docScale}
          editorScale={editorScale}
          draft={draftOf(store.drafts, targetTab.id)}
          savedText={localSaved?.path === absPath ? localSaved.text : undefined}
          tick={localTicks[absPath] ?? 0}
          onDraft={(text) => stageLocalDraft(targetTab.id, text)}
          saving={docSaving}
          saveError={docSaveError}
          onMissing={onClose}
          outlineSlot={getOutlineSlot('side:' + targetTab.id)}
          onNeedEdit={() => setTabView(targetTab.id, 'source')}
          onRevealSource={(loc) => {
            requestSourceReveal(localRevealKey(absPath), loc.start, loc.end)
            setTabView(targetTab.id, 'source')
          }}
          onToast={onToast}
        />
      )
    }

    if (ref.kind === 'exam') {
      const gExam = examCopyOf(store, targetTab)
      return gExam.exam && gExam.attempt ? (
        <ExamCopyView exam={gExam.exam} attempt={gExam.attempt} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
          {t('这份试卷已经被删了，这一次考试的内容也一并没了。')}
        </div>
      )
    }

    if (ref.kind === 'agentTeam') {
      return (
        <AgentTeamPage
          active
          focused={false}
          goalId={ref.goalId}
          persistLayout={false}
          agentSlotDeps={agentSlotDeps}
        />
      )
    }

    if (ref.kind === 'terminal') {
      const termId = ref.termId || targetTab.id
      return <TerminalTabPane tabId={scopePrefix + targetTab.id} termId={termId} shell={ref.shell} active onToast={onToast} />
    }

    if (ref.kind === 'settings' || ref.kind === 'agentSettings') {
      return (
        <SettingsPage
          ctx={ctx}
          initialSection={ref.kind === 'agentSettings' ? 'agent' : undefined}
        />
      )
    }

    if (ref.kind === 'mind') {
      return (
        <MindPanel
          goalId={ref.goalId}
          goals={store.goals}
          memory={store.memory ?? { long: [], work: {} }}
          onCreate={memoryCreate}
          onUpdate={memoryUpdate}
          onDelete={memoryDelete}
          onClearWork={memoryClearWork}
          onToast={onToast}
        />
      )
    }

    if (ref.kind === 'usage') return <UsagePanel />
    if (ref.kind === 'vim') return <VimCheatSheetView />
    if (ref.kind === 'pluginDoc') return <PluginDoc />
    if (ref.kind === 'sponsors') return <SponsorsDoc />

    if (ref.kind === 'schedule') {
      return (
        <SchedulePage
          store={store}
          actions={scheduleActions}
          onToast={onToast}
          ringingId={scheduleRinging?.id ?? null}
        />
      )
    }

    if (ref.kind === 'user') {
      return (
        <UserTabPane
          users={users ?? []}
          activeUserId={activeUserId ?? null}
          onSelect={onSelectUser ?? (() => {})}
          onCreate={onCreateUser ?? (() => {})}
          onUpdate={onUpdateUser ?? (() => {})}
          onDelete={onDeleteUser ?? (() => {})}
          onSignOut={onSignOut ?? (() => {})}
          onToast={onToast}
        />
      )
    }

    if (ref.kind === 'classroom') {
      return (
        <ClassroomView
          key={'side:' + ref.classroomId}
          classroomId={ref.classroomId}
          store={store}
          onUpdateClassroom={(nextEntity) => {
            const latest = getLatest()
            const list = latest.classrooms ?? []
            const idx = list.findIndex((c) => c.id === nextEntity.id)
            const nextList = idx >= 0 ? list.map((c, i) => (i === idx ? nextEntity : c)) : [...list, nextEntity]
            set({ ...latest, classrooms: nextList })
          }}
          onOpenTab={(kind, targetId) => {
            if (kind === 'classroomShowcase') openTab({ kind: 'classroomShowcase', tag: targetId || undefined })
            else if (kind === 'doc') openTab({ kind: 'teach', nodeId: targetId })
          }}
          onGenerateClassroom={canvasChannel?.onGenerateClassroom}
        />
      )
    }

    if (ref.kind === 'classroomShowcase') {
      return <ClassroomShowcasePage initialTag={ref.tag} />
    }

    if (ref.kind === 'draft') {
      return (
        <DraftDoc
          draft={draftOf(store.drafts, targetTab.id) ?? ''}
          tabId={targetTab.id}
          scale={editorScale}
          onDraft={(text) => stageNewFileDraft(targetTab.id, text)}
          saving={docSaving}
          saveError={docSaveError}
          onSave={() => {}}
        />
      )
    }

    if (ref.kind === 'web') {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-card p-6 text-center">
          <Globe size={30} className="text-seal/70" />
          <div className="text-[13.5px] font-semibold text-ink-strong">{title}</div>
          <p className="max-w-sm break-all text-[12px] text-ink-faint">
            {ref.url || t('内置网页实例保留在原页签中，可通过下方按钮跳转或外部打开')}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => activateTab(targetTab.id)}
              className="flex items-center gap-1.5 rounded-lg border border-line-strong/80 bg-paper px-3 py-1.5 text-[12px] font-medium text-ink-strong transition hover:bg-line/40"
            >
              <Link2 size={13} />
              {t('切到原页签')}
            </button>
            {ref.url && (
              <button
                type="button"
                onClick={() => void openExternalLink(ref.url)}
                className="flex items-center gap-1.5 rounded-lg bg-seal px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-seal-deep"
              >
                <ExternalLink size={13} />
                {isWeb() ? t('在当前浏览器打开') : t('外部浏览器打开')}
              </button>
            )}
          </div>
        </div>
      )
    }

    if (ref.kind === 'video') {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-card p-6 text-center">
          <Video size={30} className="text-rose-400" />
          <div className="text-[13.5px] font-semibold text-ink-strong">{title}</div>
          <p className="max-w-sm text-[12px] text-ink-faint">
            {t('视频播放器保留在原页签中以免重播中断，点击下方可快速切回原页签')}
          </p>
          <button
            type="button"
            onClick={() => activateTab(targetTab.id)}
            className="flex items-center gap-1.5 rounded-lg border border-line-strong/80 bg-paper px-3 py-1.5 text-[12px] font-medium text-ink-strong transition hover:bg-line/40"
          >
            <Link2 size={13} />
            {t('切到原页签')}
          </button>
        </div>
      )
    }

    return (
      <EmptyDoc
        onNewFile={() => openNewFileInPlace(groupId, targetTab.id)}
        onPickLocal={() => void pickLocalInPlace(groupId, targetTab.id)}
        onOpenWeb={isWeb() ? undefined : () => openWebInPlace(groupId, targetTab.id)}
        onNewGoal={() => openNewGoalInPlace(groupId, targetTab.id)}
        hasGoals={(store.goals ?? []).length > 0}
        favorites={store.favorites ?? []}
        favoriteTitleOf={favoriteTitleOf}
        onOpenFavorite={openFavorite}
        recents={blankRecents}
        onOpenRecent={openRecent}
      />
    )
  }

  // note key on targetTab ensures switching :side target remounts cleanly when target changes
  void tabKey
  return (
    <div
      data-side-portal-id={targetTab.id}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card"
    >
      <header
        className={
          'flex shrink-0 items-center justify-between gap-2 px-3 select-none ' +
          (mode === 'fixside'
            ? 'h-[34px] pt-1 border-b border-line-strong bg-paper/40'
            : 'h-8 border-b border-line/60 bg-paper/75')
        }
      >
        <div className="flex min-w-0 items-center gap-2">
          <TabTypeIcon tab={targetTab.ref} />
          <span title={title} className="truncate text-[12px] font-medium text-ink-strong">
            {title}
          </span>
          <span className="shrink-0 rounded-md border border-seal/25 bg-seal/10 px-1.5 py-0.5 text-[9.5px] font-medium leading-none text-seal">
            {mode === 'fixside' ? t('固定外侧栏') : t('传送对照')}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onSwap}
            title={t('对调左右位置（也可双击中间分割线）')}
            aria-label={t('对调左右位置')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/50 hover:text-ink"
          >
            <ArrowLeftRight size={12.5} />
          </button>
          <button
            type="button"
            onClick={() => activateTab(targetTab.id)}
            title={t('定位到原页签')}
            aria-label={t('定位到原页签')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/50 hover:text-ink"
          >
            <ExternalLink size={12.5} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title={mode === 'fixside' ? t('关闭固定外侧栏') : t('关闭并排对照')}
            aria-label={mode === 'fixside' ? t('关闭固定外侧栏') : t('关闭并排对照')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-seal/15 hover:text-seal"
          >
            <X size={13} />
          </button>
        </div>
      </header>

      <div key={targetTab.id} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {renderContent()}
      </div>
    </div>
  )
}
