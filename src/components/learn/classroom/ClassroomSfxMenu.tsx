import { useState, useRef, useEffect } from 'react'
import {
  getSfxSettings,
  setSfxSettings,
  subscribeSfxSettings,
  playSfx,
  type SfxSettings,
} from '../../../learn/classroom/sfx/sfxEngine'
import { Volume2, VolumeX, SlidersHorizontal } from 'lucide-react'
import { t } from '../../../i18n'

export default function ClassroomSfxMenu() {
  const [sfx, setSfx] = useState<SfxSettings>(() => getSfxSettings())
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => subscribeSfxSettings(setSfx), [])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={menuRef} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setSfxSettings({ enabled: !sfx.enabled })}
        title={sfx.enabled ? t('关闭课堂音效') : t('开启课堂音效')}
        className={`flex h-8 items-center gap-1.5 px-2 rounded-l-lg border border-r-0 border-line/40 text-[12px] font-medium transition cursor-pointer ${
          sfx.enabled
            ? 'bg-seal/15 border-seal text-seal font-bold'
            : 'text-ink-faint hover:bg-line/50 hover:text-ink'
        }`}
      >
        {sfx.enabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        <span>{t('音效')}</span>
      </button>

      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        title={t('音效音量设置')}
        className={`flex h-8 w-6 items-center justify-center rounded-r-lg border border-line/40 text-ink-soft hover:bg-line/50 hover:text-ink transition cursor-pointer ${
          isOpen ? 'bg-line/60 text-ink' : ''
        }`}
      >
        <SlidersHorizontal size={12} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-64 p-3.5 rounded-2xl bg-card/95 border border-line/80 shadow-2xl backdrop-blur-md text-ink select-none z-50 animate-in fade-in zoom-in-95 duration-150 space-y-3">
          <div className="flex items-center justify-between border-b border-line/40 pb-2">
            <span className="text-[13px] font-bold text-ink-strong">{t('课堂伴音与音效')}</span>
            <button
              type="button"
              onClick={() => setSfxSettings({ enabled: !sfx.enabled })}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                sfx.enabled ? 'bg-seal text-white' : 'bg-line text-ink-soft'
              }`}
            >
              {sfx.enabled ? t('已开启') : t('已静音')}
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-ink-soft">
              <span>{t('主音量')}</span>
              <span className="font-mono font-bold text-ink">{Math.round(sfx.volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(sfx.volume * 100)}
              onChange={(e) => setSfxSettings({ volume: Number(e.target.value) / 100, enabled: true })}
              className="w-full accent-seal cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-ink-faint">{t('WebAudio 实时合成')}</span>
            <button
              type="button"
              onClick={() => playSfx('chime', { force: true })}
              className="px-2.5 py-1 rounded-lg bg-seal/15 text-seal hover:bg-seal/25 text-[11px] font-bold transition cursor-pointer"
            >
              {t('试听铃音')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
