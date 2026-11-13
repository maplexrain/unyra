import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'
import {
  X,
  Trophy,
  ArrowRight,
  RotateCcw,
  Sparkles,
  Gamepad2,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react'
import { useVimGameEngine } from './useVimGameEngine'
import { VIM_TUTOR_LEVELS } from './vimTutorLevels'
import { smoothCursor } from '../../../lib/cmSmoothCursor'
import { markdownEditorTheme } from '../../../lib/cmMarkdown'
import VimIcon from '../VimIcon'
import { t } from '../../../i18n'

interface Props {
  onClose: () => void
}

export default function VimTutorView({ onClose }: Props) {
  const {
    levelIndex,
    currentLevel,
    totalLevels,
    collectedDiamonds,
    isLevelCleared,
    stepCount,
    keyHistory,
    vimMode,
    setVimMode,
    recordKeyStroke,
    restartLevel,
    selectLevel,
    nextLevel,
    prevLevel,
    handleCursorMove,
    handleDocChange,
    handleVimCommand,
  } = useVimGameEngine()

  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // 当关卡切换或重置时，重新初始化 CodeMirror 关卡沙盘
  useEffect(() => {
    const host = editorHostRef.current
    if (!host) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const initialText = currentLevel.initialLines.join('\n')
    const theme = markdownEditorTheme({ top: 12, bottom: 16, left: 14, right: 14, gutterLeft: 12 })

    const startPos = currentLevel.startPos
    let initOffset = 0

    const state = EditorState.create({
      doc: initialText,
      extensions: [
        lineNumbers(),
        theme,
        vim(),
        smoothCursor(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            handleDocChange(update.state.doc.toString())
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            const row = line.number - 1
            const col = head - line.from
            handleCursorMove(row, col)
          }
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: host,
    })
    viewRef.current = view

    // 计算初时光标位置
    if (startPos) {
      try {
        const line = view.state.doc.line(Math.min(startPos.row + 1, view.state.doc.lines))
        initOffset = Math.min(line.from + startPos.col, line.to)
        view.dispatch({
          selection: { anchor: initOffset, head: initOffset },
          scrollIntoView: true,
        })
      } catch {
        // 安全容错
      }
    }

    view.focus()

    // 监听按键与 Vim 模式变化
    const cm = (view as any).cm
    if (cm && typeof cm.on === 'function') {
      const modeHandler = (e: any) => {
        const m = (e?.mode || 'normal').toUpperCase()
        if (m.includes('INSERT')) setVimMode('INSERT')
        else if (m.includes('VISUAL')) setVimMode('VISUAL')
        else setVimMode('NORMAL')
      }
      cm.on('vim-mode-change', modeHandler)
      cm.on('vim-command-done', (cmd: any) => {
        if (typeof cmd === 'string') handleVimCommand(cmd)
      })
    }

    const keyHandler = (e: KeyboardEvent) => {
      recordKeyStroke(e.key)
      if (e.key === 'Escape') {
        setVimMode('NORMAL')
      }
    }
    view.dom.addEventListener('keydown', keyHandler)

    return () => {
      view.dom.removeEventListener('keydown', keyHandler)
      view.destroy()
      viewRef.current = null
    }
  }, [
    levelIndex,
    currentLevel,
    setVimMode,
    recordKeyStroke,
    handleCursorMove,
    handleDocChange,
    handleVimCommand,
  ])

  // 全局 Escape 退出监听
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && vimMode === 'NORMAL' && !isLevelCleared) {
        // 在普通模式下按 Esc 可快捷关闭沙盘
        // 为避免打字时误关，仅在处于 Normal 模式且双击 Esc 时关闭
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [vimMode, isLevelCleared, onClose])

  const totalDiamonds = currentLevel.meta.diamonds?.length ?? 0
  const gotDiamonds = collectedDiamonds.length
  const isFinalLevel = levelIndex === totalLevels - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      {/* 弹窗主视窗 */}
      <div className="relative flex h-[88vh] max-h-[820px] w-[92vw] max-w-[1100px] flex-col overflow-hidden rounded-xl border border-line-strong/80 bg-card shadow-2xl">
        {/* 顶部导航工具条 */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line/70 px-5 bg-card/80 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#019833]/15 text-[#019833] border border-[#019833]/30 shadow-xs">
              <VimIcon size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[14px] font-bold text-ink-strong tracking-wide">
                  {t('Vim 闯关道场')}
                </h1>
                <span className="rounded-full bg-[#019833]/15 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-[#019833]">
                  Level {levelIndex + 1}/{totalLevels}
                </span>
              </div>
              <p className="text-[11px] text-ink-faint">{currentLevel.subtitle}</p>
            </div>
          </div>

          {/* 关卡步进选择条 */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={levelIndex === 0}
              onClick={prevLevel}
              className="flex h-7 w-7 items-center justify-center rounded border border-line text-ink-soft hover:bg-line/40 hover:text-ink disabled:opacity-30 cursor-pointer"
              title={t('上一关')}
            >
              <ChevronLeft size={15} />
            </button>
            <div className="flex items-center gap-1 px-1">
              {VIM_TUTOR_LEVELS.map((lvl, idx) => (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => selectLevel(idx)}
                  className={`flex h-7 w-7 items-center justify-center rounded font-mono text-[11px] font-medium transition cursor-pointer ${
                    idx === levelIndex
                      ? 'border border-[#019833] bg-[#019833]/20 font-bold text-[#019833]'
                      : idx < levelIndex
                        ? 'border border-line/60 bg-line/20 text-[#019833]'
                        : 'border border-line/40 text-ink-faint hover:border-line hover:text-ink'
                  }`}
                  title={lvl.title}
                >
                  {idx < levelIndex ? '✓' : idx + 1}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={levelIndex === totalLevels - 1}
              onClick={nextLevel}
              className="flex h-7 w-7 items-center justify-center rounded border border-line text-ink-soft hover:bg-line/40 hover:text-ink disabled:opacity-30 cursor-pointer"
              title={t('下一关')}
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* 右侧模式与关闭 */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-2.5 py-1 font-mono text-[11px] font-bold tracking-wider uppercase transition-colors ${
                  vimMode === 'INSERT'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : vimMode === 'VISUAL'
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                      : 'bg-teal-500/20 text-teal-400 border border-teal-500/40'
                }`}
              >
                -- {vimMode} --
              </span>
              <span className="font-mono text-[11px] text-ink-faint">
                {stepCount} {t('步')}
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded border border-transparent text-ink-faint transition hover:bg-line/40 hover:text-ink cursor-pointer"
              title={t('关闭 (Esc)')}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* 主体双栏区域 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧目标与心法指示栏 */}
          <aside className="flex w-72 shrink-0 flex-col border-r border-line/70 bg-card/40 p-4 overflow-y-auto">
            {/* 关卡目标卡片 */}
            <div className="rounded-lg border border-line bg-card/60 p-3.5 shadow-xs">
              <div className="flex items-center justify-between pb-2 border-b border-line/60">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-strong">
                  <Gamepad2 size={14} className="text-seal" />
                  {t('通关目标')}
                </span>
                {totalDiamonds > 0 && (
                  <span className="font-mono text-[11px] font-bold text-amber-400">
                    💎 {gotDiamonds}/{totalDiamonds}
                  </span>
                )}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink font-medium">
                {currentLevel.goalText}
              </p>
            </div>

            {/* 心法秘籍 */}
            <div className="mt-3.5 rounded-lg border border-line/70 bg-card/30 p-3.5">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-strong">
                <Sparkles size={14} className="text-amber-400" />
                {t('快捷招式')}
              </span>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
                {currentLevel.instruction}
              </p>

              {/* 按键卡片清单 */}
              <div className="mt-3 flex flex-col gap-1.5">
                {currentLevel.keyGuide.map((kg) => (
                  <div
                    key={kg.key}
                    className="flex items-center justify-between rounded border border-line/60 bg-line/20 px-2 py-1 text-[11px]"
                  >
                    <kbd className="rounded border border-line-strong bg-card px-1.5 py-0.5 font-mono text-[11px] font-semibold text-seal shadow-2xs">
                      {kg.key}
                    </kbd>
                    <span className="text-[11px] text-ink-faint">{kg.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 提示与重开按钮 */}
            <div className="mt-auto pt-3 flex items-center justify-between">
              <span className="text-[10.5px] text-ink-faint">💡 {currentLevel.hint}</span>
              <button
                type="button"
                onClick={restartLevel}
                className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] text-ink-soft hover:bg-line/40 hover:text-ink cursor-pointer"
                title={t('重新开始当前关卡')}
              >
                <RotateCcw size={12} />
                <span>{t('重置')}</span>
              </button>
            </div>
          </aside>

          {/* 右侧沙盘编辑器与按键监视器 */}
          <main className="relative flex flex-1 flex-col overflow-hidden bg-card/20">
            {/* CodeMirror 游戏容器 */}
            <div
              ref={editorHostRef}
              className="flex-1 w-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:h-full font-mono text-[13.5px]"
            />

            {/* 底部按键监视流光条 (KeyCast Monitor) */}
            <div className="flex h-11 shrink-0 items-center justify-between border-t border-line/60 px-4 bg-card/60 backdrop-blur">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-ink-faint">{t('按键回显：')}</span>
                <div className="flex items-center gap-1.5 overflow-hidden">
                  {keyHistory.map((rec) => (
                    <span
                      key={rec.id}
                      className="inline-flex items-center rounded border border-seal/40 bg-seal/10 px-2 py-0.5 font-mono text-[11.5px] font-bold text-seal animate-in zoom-in-75 fade-in duration-150"
                    >
                      {rec.key === ' ' ? '␣ Space' : rec.key}
                    </span>
                  ))}
                  {keyHistory.length === 0 && (
                    <span className="text-[11px] text-ink-faint italic">{t('等待按键...')}</span>
                  )}
                </div>
              </div>

              <span className="font-mono text-[10.5px] text-ink-faint">
                {t('按 Esc 切换普通模式，输入 : 进行命令号令')}
              </span>
            </div>

            {/* 胜利通关悬浮结算卡片 (Overlay) */}
            {isLevelCleared && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
                <div className="flex w-[380px] flex-col items-center rounded-xl border border-[#019833]/50 bg-card p-6 text-center shadow-2xl">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#019833]/20 text-[#019833] border border-[#019833]/40 shadow-md">
                    <Trophy size={28} className="animate-bounce" />
                  </div>
                  <h2 className="mt-3.5 text-[17px] font-bold text-ink-strong">
                    {isFinalLevel ? t('🏆 恭喜晋升 Vim 宗师！') : t('🎉 关卡突破！')}
                  </h2>
                  <p className="mt-1 text-[12px] text-ink-soft">
                    {isFinalLevel
                      ? t('你已融会贯通移动、模式、斩除、分身与号令，编码如飞！')
                      : t('身法矫健，利落通关！共耗费 ') + stepCount + t(' 步')}
                  </p>

                  <div className="mt-5 flex w-full gap-2">
                    <button
                      type="button"
                      onClick={restartLevel}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-[12px] font-medium text-ink-soft hover:bg-line/40 hover:text-ink cursor-pointer"
                    >
                      <RotateCcw size={14} />
                      <span>{t('重练一次')}</span>
                    </button>
                    {!isFinalLevel ? (
                      <button
                        type="button"
                        onClick={nextLevel}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#019833] py-2 text-[12px] font-bold text-white shadow-md hover:bg-[#019833]/90 transition cursor-pointer"
                      >
                        <span>{t('下一关')}</span>
                        <ArrowRight size={14} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onClose}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#019833] py-2 text-[12px] font-bold text-white shadow-md hover:bg-[#019833]/90 transition cursor-pointer"
                      >
                        <CheckCircle2 size={14} />
                        <span>{t('完成试炼')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
