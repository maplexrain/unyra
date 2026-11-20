import { useState, useEffect } from 'react'
import { type SfxCategory, type SfxMeta } from '../../../learn/classroom/sfx/sfxLibrary'
import {
  getSfxSettings,
  setSfxSettings,
  subscribeSfxSettings,
  playSfx,
  type SfxSettings,
} from '../../../learn/classroom/sfx/sfxEngine'
import { Volume2, VolumeX, Play, Copy, Check } from 'lucide-react'
import { t } from '../../../i18n'

export interface ClassroomSfxSectionProps {
  sounds: SfxMeta[]
  copiedId: string | null
  onCopy: (e: React.MouseEvent, id: string, text: string) => void
}

const CATEGORY_LABELS: Array<[SfxCategory | 'all', string]> = [
  ['all', '全部音效'],
  ['transition', '转场空间'],
  ['accent', '焦点顿悟'],
  ['rhythm', '节奏拟音'],
  ['feedback', '情绪反馈'],
]

const CATEGORY_BADGE_MAP: Record<SfxCategory, { label: string; cls: string }> = {
  transition: { label: '转场', cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
  accent: { label: '焦点', cls: 'bg-seal/10 text-seal border-seal/20' },
  rhythm: { label: '节奏', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  feedback: { label: '反馈', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
}

export default function ClassroomSfxSection({ sounds, copiedId, onCopy }: ClassroomSfxSectionProps) {
  const [sfxCat, setSfxCat] = useState<SfxCategory | 'all'>('all')
  const [playingName, setPlayingName] = useState<string | null>(null)
  const [sfxSettings, setLocalSettings] = useState<SfxSettings>(() => getSfxSettings())

  useEffect(() => subscribeSfxSettings(setLocalSettings), [])

  const visibleSounds = sfxCat === 'all' ? sounds : sounds.filter((s) => s.category === sfxCat)

  const handleAudition = (name: string) => {
    playSfx(name, { force: true })
    setPlayingName(name)
    window.setTimeout(() => {
      setPlayingName((cur) => (cur === name ? null : cur))
    }, 550)
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Volume2 size={16} className="text-emerald-500" />
          <h2 className="text-[15px] font-bold text-ink-strong">{t('课堂音效库 (WebAudio SFX)')}</h2>
          <span className="text-[11px] text-ink-faint">{t('零资源文件实时合成 · 一幕只给 1~3 个关键节点配音')}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* 分类过滤 */}
          <div className="flex items-center gap-1 text-[11px] font-medium">
            {CATEGORY_LABELS.map(([catKey, label]) => (
              <button
                key={catKey}
                type="button"
                onClick={() => setSfxCat(catKey)}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  sfxCat === catKey
                    ? 'bg-card font-bold text-seal border border-seal/30 shadow-2xs'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                {t(label)}
              </button>
            ))}
          </div>

          {/* 快捷静音/音量 */}
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-card border border-line text-[11px]">
            <button
              type="button"
              onClick={() => setSfxSettings({ enabled: !sfxSettings.enabled })}
              className="flex items-center gap-1 text-ink-soft hover:text-ink cursor-pointer"
              title={sfxSettings.enabled ? t('课堂音效已开启') : t('课堂音效已静音')}
            >
              {sfxSettings.enabled ? (
                <Volume2 size={13} className="text-seal" />
              ) : (
                <VolumeX size={13} className="text-ink-faint" />
              )}
              <span>{Math.round(sfxSettings.volume * 100)}%</span>
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(sfxSettings.volume * 100)}
              onChange={(e) => setSfxSettings({ volume: Number(e.target.value) / 100, enabled: true })}
              className="w-16 accent-seal cursor-pointer"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {visibleSounds.map((sound) => {
          const catMeta = CATEGORY_BADGE_MAP[sound.category]
          const copyKey = `sfx:${sound.name}`
          const dslSnippet = `params: { sfx: '${sound.name}' }`
          const isPlaying = playingName === sound.name

          return (
            <div
              key={sound.name}
              className={`flex flex-col rounded-2xl bg-card border p-4 shadow-xs transition ${
                isPlaying ? 'border-emerald-500/70 shadow-md' : 'border-line/80 hover:border-emerald-500/40'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[14px] font-bold text-emerald-600 dark:text-emerald-400">
                  {sound.name}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${catMeta.cls}`}>
                  {t(catMeta.label)}
                </span>
              </div>

              <h3 className="text-[14.5px] font-bold text-ink-strong mb-1">{sound.label}</h3>
              <p className="text-[11.5px] text-ink-soft mb-1.5">{sound.mood}</p>
              <p className="text-[11.5px] text-ink-faint leading-relaxed flex-1 mb-3">{sound.use}</p>

              {/* 试听区 */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-paper-deep border border-line/60 mb-2.5">
                <div className="flex items-end gap-1 h-5 px-2">
                  {[0.45, 0.9, 0.65, 1, 0.55].map((h, i) => (
                    <span
                      key={i}
                      style={{ height: `${Math.round((isPlaying ? 1 : h) * 18)}px` }}
                      className={`w-1 rounded-full transition-all duration-150 ${
                        isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-ink-faint/45'
                      }`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => handleAudition(sound.name)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-bold transition shadow-2xs cursor-pointer active:scale-95"
                >
                  <Play size={11} fill="currentColor" />
                  <span>{t('试听')}</span>
                </button>
              </div>

              {/* DSL 拷贝条 */}
              <div className="flex items-center justify-between text-[11px] text-ink-soft rounded-xl bg-line/30 px-2.5 py-1.5 font-mono">
                <span className="truncate pr-2">{dslSnippet}</span>
                <button
                  type="button"
                  onClick={(e) => onCopy(e, copyKey, dslSnippet)}
                  className="p-1 text-ink-faint hover:text-ink transition cursor-pointer shrink-0"
                  title={t('复制音效参数')}
                >
                  {copiedId === copyKey ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
