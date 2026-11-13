import { useState, useEffect } from 'react'
import { BookOpen, Gamepad2 } from 'lucide-react'
import VimIcon from '../VimIcon'
import VimCheatSheetView from './VimCheatSheetView'
import VimTutorView from './VimTutorView'
import { t } from '../../../i18n'

interface Props {
  initialSection?: 'tutor' | 'commands'
}

export default function VimStudyPage({ initialSection = 'commands' }: Props) {
  const [section, setSection] = useState<'tutor' | 'commands'>(initialSection)

  useEffect(() => {
    if (initialSection) {
      setSection(initialSection)
    }
  }, [initialSection])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-card/15">
      {/* 顶部统一页面导览头 */}
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-line/70 px-6 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#019833]/15 text-[#019833] border border-[#019833]/30 shadow-xs">
            <VimIcon size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[14px] font-bold text-ink-strong tracking-wide">
                {t('Vim 学习与命令大全')}
              </h1>
              <span className="rounded-full bg-[#019833]/15 px-2 py-0.5 font-mono text-[10px] font-bold text-[#019833]">
                {section === 'commands' ? t('命令速查') : t('闯关道场')}
              </span>
            </div>
            <p className="text-[11px] text-ink-faint">
              {t('交互式闯关道场 · 全量按键与进阶技巧速查手册')}
            </p>
          </div>
        </div>

        {/* 顶部视窗分栏切换器 (Segmented Control) */}
        <div className="flex items-center rounded-lg border border-line bg-card/80 p-0.5 shadow-2xs">
          <button
            type="button"
            onClick={() => setSection('commands')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition cursor-pointer ${
              section === 'commands'
                ? 'bg-seal text-white shadow-2xs font-semibold'
                : 'text-ink-soft hover:text-ink hover:bg-line/40'
            }`}
          >
            <BookOpen size={14} />
            <span>{t('命令大全')}</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('tutor')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition cursor-pointer ${
              section === 'tutor'
                ? 'bg-[#019833] text-white shadow-2xs font-semibold'
                : 'text-ink-soft hover:text-ink hover:bg-line/40'
            }`}
          >
            <Gamepad2 size={14} />
            <span>{t('闯关道场')}</span>
          </button>
        </div>
      </header>

      {/* 主体视窗内容 */}
      <main className="flex-1 overflow-hidden">
        {section === 'commands' ? (
          <VimCheatSheetView />
        ) : (
          <VimTutorView embedded />
        )}
      </main>
    </div>
  )
}
