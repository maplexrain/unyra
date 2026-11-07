/**
 * 设置 → 外观：全局字体与文字描边分区。
 *
 * 从 AppearancePanel 拆出的展示组件：负责字体选择/扫描与描边颜色、厚度
 * 的展示；防抖草稿等状态与回调由门面 AppearancePanel 持有并逐项传入。
 */

import { RefreshCw, Type } from 'lucide-react'
import { type Appearance } from '../../lib/appearance'
import { t } from '../../i18n'
import Switch from '../Switch'

const PRESET_FONTS = [
  { label: '系统默认 (跟随系统)', value: '' },
  { label: '微软雅黑 (Microsoft YaHei)', value: "'Microsoft YaHei', sans-serif" },
  { label: '苹方 (PingFang SC)', value: "'PingFang SC', sans-serif" },
  { label: '思源黑体 (Source Han Sans)', value: "'Source Han Sans SC', 'Noto Sans SC', sans-serif" },
  { label: '鸿蒙字体 (HarmonyOS Sans)', value: "'HarmonyOS Sans SC', sans-serif" },
  { label: '霞鹜文楷 (LXGW WenKai)', value: "'LXGW WenKai', cursive, sans-serif" },
  { label: '思源宋体 (Source Han Serif)', value: "'Source Han Serif SC', 'Noto Serif SC', serif" },
  { label: '楷体 (KaiTi)', value: "'KaiTi', 'STKaiti', serif" },
  { label: '宋体 (SimSun)', value: "'SimSun', 'STSong', serif" },
  { label: '仿宋 (FangSong)', value: "'FangSong', 'STFangsong', serif" },
  { label: 'Segoe UI', value: "'Segoe UI', sans-serif" },
  { label: 'Inter', value: "'Inter', sans-serif" },
  { label: 'Cascadia Mono', value: "'Cascadia Mono', monospace" },
]

const STROKE_PRESET_COLORS = ['#1f1b17', '#ffffff', '#a8432f', '#6e665b', '#000000', '#d0705a', '#5c7a3f', '#2f6ea8']

interface Props {
  /** 当前子 tab 是否处于高亮态（由门面按 highlightSubTab 计算） */
  highlighted: boolean
  /** 高亮动画用的 key（由门面按 highlightSubTab 计算） */
  highlightKey: string
  fontFamily?: string
  textStrokeEnabled?: boolean
  textStrokeColor?: string
  systemFonts: string[]
  scanningFonts: boolean
  customFontInput: string
  onCustomFontInputChange: (v: string) => void
  onChange: (patch: Partial<Appearance>) => void
  onScanSystemFonts: () => void
  /** 描边颜色本地草稿（防抖中尚未提交的值，见门面） */
  strokeColorDraft: string
  /** 描边厚度本地草稿（防抖中尚未提交的值，见门面） */
  strokeWidthDraft: number
  onCommitStrokeColor: (val: string) => void
  onColorPickerChange: (val: string) => void
  onStrokeWidthChange: (val: number) => void
}

export function AppearanceTypographySection({
  highlighted,
  highlightKey,
  fontFamily,
  textStrokeEnabled,
  textStrokeColor,
  systemFonts,
  scanningFonts,
  customFontInput,
  onCustomFontInputChange,
  onChange,
  onScanSystemFonts,
  strokeColorDraft,
  strokeWidthDraft,
  onCommitStrokeColor,
  onColorPickerChange,
  onStrokeWidthChange,
}: Props) {
  return (
    <section id="settings-section-typography" className="flex flex-col gap-3 rounded-xl border border-line bg-card/60 p-3.5 scroll-mt-4">
      <div className="flex items-center justify-between">
        <div
          key={highlightKey}
          className={`flex items-center gap-1.5 text-[13px] font-medium text-ink-strong ${
            highlighted ? 'moji-setting-highlight' : ''
          }`}
        >
          <Type size={14} className="text-seal" />
          <span>{t('全局字体与排版')}</span>
        </div>
        <button
          type="button"
          onClick={onScanSystemFonts}
          disabled={scanningFonts}
          className="flex items-center gap-1 rounded-md border border-line bg-card px-2 py-0.5 text-[11px] text-ink-soft hover:border-seal hover:text-seal transition disabled:opacity-50"
          title={t('扫描操作系统已安装的所有字体')}
        >
          <RefreshCw size={11} className={scanningFonts ? 'animate-spin' : ''} />
          <span>{scanningFonts ? t('扫描中…') : t('检测系统字体')}</span>
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-faint">
        {t('选择全局渲染所使用的字体族。支持直接选用操作系统包含的字体，或选择常用精选中西文字体。')}
      </p>

      {/* 字体选择下拉与自定义输入 */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={
              PRESET_FONTS.some((f) => f.value === fontFamily)
                ? fontFamily
                : systemFonts.includes(fontFamily || '')
                  ? fontFamily
                  : '__custom__'
            }
            onChange={(e) => {
              const val = e.target.value
              if (val !== '__custom__') {
                onCustomFontInputChange(val)
                onChange({ fontFamily: val })
              }
            }}
            className="flex-1 min-w-[200px] rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-seal"
          >
            <optgroup label={t('精选字体预设')}>
              {PRESET_FONTS.map((f) => (
                <option key={f.value} value={f.value}>
                  {t(f.label)}
                </option>
              ))}
            </optgroup>
            {systemFonts.length > 0 && (
              <optgroup label={t('系统已安装字体 ({0})', systemFonts.length)}>
                {systemFonts.map((fam) => (
                  <option key={fam} value={`'${fam}', sans-serif`}>
                    {fam}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="__custom__">{t('自定义字体名称…')}</option>
          </select>

          <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
            <input
              type="text"
              placeholder={t('或直接输入本机字体名称，如 "楷体", "Fira Code"…')}
              value={customFontInput}
              onChange={(e) => {
                onCustomFontInputChange(e.target.value)
                onChange({ fontFamily: e.target.value })
              }}
              className="w-full rounded-lg border border-line bg-paper/60 px-2.5 py-1.5 text-[11.5px] text-ink outline-none focus:border-seal font-mono"
            />
            {fontFamily && (
              <button
                type="button"
                onClick={() => {
                  onCustomFontInputChange('')
                  onChange({ fontFamily: '' })
                }}
                className="shrink-0 text-[11px] text-ink-faint hover:text-seal px-1.5 py-1"
                title={t('恢复系统默认字体')}
              >
                {t('重置')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 文字描边 */}
      <div className="mt-1 border-t border-line/50 pt-2.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12.5px] font-medium text-ink-strong">{t('文字描边')}</div>
            <div className="text-[10.5px] text-ink-faint">
              {t('在开启自定义背景图片时强化文字轮廓，避免复杂壁纸干扰阅读。')}
            </div>
          </div>
          <Switch
            on={Boolean(textStrokeEnabled)}
            onChange={(next) => onChange({ textStrokeEnabled: next })}
            label=""
          />
        </div>

        {textStrokeEnabled && (
          <div className="flex flex-col gap-2.5 rounded-lg border border-line/60 bg-card/40 p-2.5 text-[11.5px]">
            {/* 描边颜色选择 */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-ink-soft shrink-0">{t('描边颜色')}：</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={strokeColorDraft}
                  onChange={(e) => onColorPickerChange(e.target.value)}
                  onBlur={() => onCommitStrokeColor(strokeColorDraft)}
                  className="h-6 w-7 cursor-pointer rounded border border-line bg-transparent p-0"
                />
                <input
                  type="text"
                  value={strokeColorDraft}
                  onChange={(e) => onColorPickerChange(e.target.value)}
                  onBlur={() => onCommitStrokeColor(strokeColorDraft)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onCommitStrokeColor(strokeColorDraft)
                  }}
                  className="w-20 rounded border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-seal"
                />
                {strokeColorDraft.toLowerCase() !== (textStrokeColor || '#1f1b17').toLowerCase() && (
                  <button
                    type="button"
                    onClick={() => onCommitStrokeColor(strokeColorDraft)}
                    className="rounded bg-seal px-2 py-0.5 text-[10.5px] font-medium text-white shadow-xs transition hover:bg-seal-deep"
                    title={t('立即应用')}
                  >
                    {t('应用')}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1 ml-auto">
                {STROKE_PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onCommitStrokeColor(c)}
                    title={c}
                    style={{ backgroundColor: c }}
                    className={`h-4 w-4 rounded-full border transition ${
                      strokeColorDraft.toLowerCase() === c.toLowerCase()
                        ? 'border-seal scale-110 shadow-xs ring-1 ring-seal'
                        : 'border-line/70 opacity-80 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* 描边厚度滑块 (0.0 - 1.0) */}
            <div className="flex items-center gap-3 border-t border-line/40 pt-2">
              <span className="text-ink-soft shrink-0">{t('描边厚度')}：</span>
              <div className="flex flex-1 items-center gap-2.5 max-w-xs">
                <input
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={strokeWidthDraft}
                  onChange={(e) => onStrokeWidthChange(Number(e.target.value))}
                  className="h-1.5 flex-1 cursor-pointer accent-seal"
                />
                <span className="w-12 font-mono text-[11px] font-medium text-seal text-right">
                  {strokeWidthDraft.toFixed(2)}px
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10.5px] text-ink-faint">
                {[0.3, 0.5, 0.8, 1.0].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => onStrokeWidthChange(w)}
                    className={`rounded border px-1.5 py-0.5 transition ${
                      Math.abs(strokeWidthDraft - w) < 0.02
                        ? 'border-seal bg-seal/10 font-medium text-seal-deep shadow-2xs'
                        : 'border-line bg-card hover:border-seal hover:text-seal'
                    }`}
                  >
                    {w.toFixed(1)}px
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 字体与描边即时效果预览框 */}
      <div
        className="rounded-lg border border-line/80 bg-paper/70 p-3 text-center transition select-none"
        style={{
          fontFamily: fontFamily || undefined,
          textShadow: textStrokeEnabled
            ? `-${strokeWidthDraft}px -${strokeWidthDraft}px 0 ${strokeColorDraft}, 0 -${strokeWidthDraft}px 0 ${strokeColorDraft}, ${strokeWidthDraft}px -${strokeWidthDraft}px 0 ${strokeColorDraft}, -${strokeWidthDraft}px 0 0 ${strokeColorDraft}, ${strokeWidthDraft}px 0 0 ${strokeColorDraft}, -${strokeWidthDraft}px ${strokeWidthDraft}px 0 ${strokeColorDraft}, 0 ${strokeWidthDraft}px 0 ${strokeColorDraft}, ${strokeWidthDraft}px ${strokeWidthDraft}px 0 ${strokeColorDraft}`
            : undefined,
        }}
      >
        <div className="text-[14px] font-medium text-ink">
          {t('纸墨相发，研精覃思。')} The quick brown fox jumps over the lazy dog.
        </div>
        <div className="mt-1 text-[11px] text-ink-soft">
          {t('当前字体')}：{fontFamily || t('系统默认')}
          {textStrokeEnabled &&
            ` · ${t('已启用硬描边')} (${strokeWidthDraft.toFixed(2)}px · ${strokeColorDraft})`}
        </div>
      </div>
    </section>
  )
}
