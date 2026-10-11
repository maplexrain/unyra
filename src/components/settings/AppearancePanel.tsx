/**
 * 设置 → 外观：主题配色、界面语言与教学模式。
 */

import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Eye,
  Image as ImageIcon,
  Languages,
  Layers,
  Link as LinkIcon,
  Palette,
  Play,
  Plus,
  Presentation,
  RefreshCw,
  Shuffle,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react'
import {
  THEME_LABEL,
  THEME_SWATCH,
  isDarkTheme,
  type Appearance,
  type ThemeMode,
} from '../../lib/appearance'
import {
  DEFAULT_CUSTOM_BACKGROUND,
  PRESET_WALLPAPERS,
  PRESET_GROUPS,
  type BackgroundFit,
  type BackgroundGroup,
  type BackgroundImageItem,
  type CustomBackgroundConfig,
} from '../../lib/customBackground'
import { LOCALES, LOCALE_LABEL, t, useLocale } from '../../i18n'
import { changeUiLocale } from '../../lib/uiLocale'
import Switch from '../Switch'
import { pane } from '../Pane'

const INTERVAL_OPTIONS = [
  { label: '15 秒', value: 15 },
  { label: '30 秒', value: 30 },
  { label: '1 分钟', value: 60 },
  { label: '5 分钟', value: 300 },
  { label: '15 分钟', value: 900 },
  { label: '30 分钟', value: 1800 },
  { label: '1 小时', value: 3600 },
]

const FIT_OPTIONS: Array<{ key: BackgroundFit; label: string }> = [
  { key: 'cover', label: '铺满裁剪' },
  { key: 'contain', label: '完整包含' },
  { key: 'center', label: '原始居中' },
  { key: 'repeat', label: '平铺重复' },
]

interface Props {
  appearance: Appearance
  onChange: (patch: Partial<Appearance>) => void
  onToast: (msg: string) => void
  activeSubTab?: string
  highlightSubTab?: { key: string; nonce: number } | null
  onSubTabChange?: (sub: string) => void
}

interface ThemeGroup {
  name: string
  hint: string
  modes: ThemeMode[]
}

const THEME_GROUPS: ThemeGroup[] = [
  {
    name: '系统与基础',
    hint: '支持自动根据操作系统浅色/深色切换，或固定基础纸墨',
    modes: ['system', 'light', 'dark'],
  },
  {
    name: '纸墨质感',
    hint: '模拟经典暖调古纸与极简净白',
    modes: ['sepia', 'amber', 'white'],
  },
  {
    name: '雅致色调',
    hint: '柔和舒缓的彩色雅致纸张氛围',
    modes: ['green', 'blue', 'purple', 'pink'],
  },
  {
    name: '深邃暗色',
    hint: '低眩光夜读配色与高对比黑度',
    modes: ['graphite', 'navy', 'contrast', 'black'],
  },
]

const LOCALE_INFO: Record<string, { sub: string }> = {
  'zh-CN': { sub: 'Chinese (Simplified)' },
  en: { sub: 'English' },
}

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

export function AppearancePanel({
  appearance,
  onChange,
  onToast,
  highlightSubTab,
  onSubTabChange,
}: Props) {
  const locale = useLocale()
  const customBg = appearance.customBg ?? DEFAULT_CUSTOM_BACKGROUND
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadTargetGroupId, setUploadTargetGroupId] = useState<string | null>(null)
  const [isCreatingGroup, setIsCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [isAddingUrl, setIsAddingUrl] = useState(false)
  const [imageUrlInput, setImageUrlInput] = useState('')
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [scanningFonts, setScanningFonts] = useState(false)
  const [customFontInput, setCustomFontInput] = useState(appearance.fontFamily || '')

  // 调色盘本地草稿与防抖：避免拖拽选色过程中高频触发全局重绘和存储导致严重卡顿
  const [strokeColorDraft, setStrokeColorDraft] = useState(appearance.textStrokeColor || '#1f1b17')
  const [prevStrokeColor, setPrevStrokeColor] = useState(appearance.textStrokeColor)
  if (appearance.textStrokeColor !== prevStrokeColor) {
    setPrevStrokeColor(appearance.textStrokeColor)
    setStrokeColorDraft(appearance.textStrokeColor || '#1f1b17')
  }
  const strokeTimerRef = useRef<number | null>(null)

  // 描边厚度本地草稿与防抖 (0.0 - 1.0)
  const [strokeWidthDraft, setStrokeWidthDraft] = useState<number>(appearance.textStrokeWidth ?? 1.0)
  const [prevStrokeWidth, setPrevStrokeWidth] = useState(appearance.textStrokeWidth)
  if (appearance.textStrokeWidth !== prevStrokeWidth) {
    setPrevStrokeWidth(appearance.textStrokeWidth)
    setStrokeWidthDraft(appearance.textStrokeWidth ?? 1.0)
  }
  const strokeWidthTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (strokeTimerRef.current) {
        window.clearTimeout(strokeTimerRef.current)
      }
      if (strokeWidthTimerRef.current) {
        window.clearTimeout(strokeWidthTimerRef.current)
      }
    }
  }, [])

  const isHighlighted = (sub: string) => highlightSubTab?.key === sub
  const getHighlightKey = (sub: string) =>
    highlightSubTab?.key === sub ? `${sub}-${highlightSubTab.nonce}` : sub

  const commitStrokeColor = (val: string) => {
    if (strokeTimerRef.current) {
      window.clearTimeout(strokeTimerRef.current)
      strokeTimerRef.current = null
    }
    setStrokeColorDraft(val)
    onChange({ textStrokeColor: val })
  }

  const handleColorPickerChange = (val: string) => {
    setStrokeColorDraft(val)
    if (strokeTimerRef.current) {
      window.clearTimeout(strokeTimerRef.current)
    }
    // 防抖 350ms：在调色盘拖拽或输入颜色时不立即频繁触发全局重绘和存储，避免卡顿
    strokeTimerRef.current = window.setTimeout(() => {
      onChange({ textStrokeColor: val })
    }, 350)
  }

  const handleStrokeWidthChange = (val: number) => {
    const clamped = Math.round(Math.min(1.0, Math.max(0.0, val)) * 100) / 100
    setStrokeWidthDraft(clamped)
    // 实时更新当前页面 CSS 变量以获取 60fps 丝滑拖拽手感
    if (appearance.textStrokeEnabled) {
      document.documentElement.style.setProperty('--text-stroke-width', `${clamped}px`)
    }
    if (strokeWidthTimerRef.current) {
      window.clearTimeout(strokeWidthTimerRef.current)
    }
    strokeWidthTimerRef.current = window.setTimeout(() => {
      onChange({ textStrokeWidth: clamped })
    }, 200)
  }

  // 二级 tab 滚动联动监听：当用户在面板内滚动时，自动高亮视口上方的对应二级 tab
  useEffect(() => {
    const container = containerRef.current
    if (!container || !onSubTabChange) return

    const subIds = ['theme', 'background', 'typography', 'locale', 'features']
    const handleScroll = () => {
      const cTop = container.getBoundingClientRect().top
      let currentSub = subIds[0]
      for (const id of subIds) {
        const el = document.getElementById(`settings-section-${id}`)
        if (el) {
          const rect = el.getBoundingClientRect()
          if (rect.top - cTop <= 100) {
            currentSub = id
          }
        }
      }
      onSubTabChange(currentSub)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [onSubTabChange])

  const activeGroup =
    customBg.groups.find((g) => g.id === customBg.activeGroupId) ??
    customBg.groups[0] ??
    PRESET_GROUPS[0]

  const updateCustomBg = (patch: Partial<CustomBackgroundConfig>) => {
    onChange({ customBg: { ...customBg, ...patch } })
  }

  const handleThemeChange = (m: ThemeMode) => {
    onChange({ theme: m })
    onToast(t('已切换至「{0}」主题', t(THEME_LABEL[m])))
  }

  const handleCreateGroup = () => {
    const name = newGroupName.trim() || t('未命名图组')
    const newGroup: BackgroundGroup = {
      id: `group-${Date.now()}`,
      name,
      images: [],
    }
    const nextGroups = [...customBg.groups, newGroup]
    updateCustomBg({ groups: nextGroups, activeGroupId: newGroup.id })
    setNewGroupName('')
    setIsCreatingGroup(false)
    onToast(t('已创建图组「{0}」', name))
  }

  const handleDeleteGroup = (groupId: string) => {
    if (customBg.groups.length <= 1) {
      onToast(t('至少保留一个图组'))
      return
    }
    const nextGroups = customBg.groups.filter((g) => g.id !== groupId)
    const nextActiveId =
      customBg.activeGroupId === groupId ? nextGroups[0].id : customBg.activeGroupId
    updateCustomBg({ groups: nextGroups, activeGroupId: nextActiveId })
    onToast(t('已删除图组'))
  }

  const handleAddImage = (groupId: string, img: { name: string; url: string }) => {
    const newItem: BackgroundImageItem = {
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: img.name,
      url: img.url,
    }
    const nextGroups = customBg.groups.map((g) => {
      if (g.id !== groupId) return g
      return { ...g, images: [...g.images, newItem] }
    })
    updateCustomBg({
      groups: nextGroups,
      singleImageUrl: customBg.singleImageUrl || img.url,
    })
    onToast(t('已添加图片「{0}」', t(img.name)))
  }

  const handleRemoveImage = (groupId: string, imageId: string) => {
    const nextGroups = customBg.groups.map((g) => {
      if (g.id !== groupId) return g
      return { ...g, images: g.images.filter((img) => img.id !== imageId) }
    })
    updateCustomBg({ groups: nextGroups })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      onToast(t('请选择图片格式文件'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const targetId = uploadTargetGroupId || activeGroup.id
        handleAddImage(targetId, {
          name: file.name.replace(/\.[^/.]+$/, ''),
          url: reader.result,
        })
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleAddUrlSubmit = () => {
    const url = imageUrlInput.trim()
    if (!url) return
    handleAddImage(activeGroup.id, {
      name: t('网络壁纸') + ' ' + (activeGroup.images.length + 1),
      url,
    })
    setImageUrlInput('')
    setIsAddingUrl(false)
  }

  const handleScanSystemFonts = async () => {
    if (typeof window !== 'undefined' && 'queryLocalFonts' in window) {
      setScanningFonts(true)
      try {
        // @ts-expect-error queryLocalFonts API in modern chromium
        const fonts = await window.queryLocalFonts()
        const names = new Set<string>()
        for (const f of fonts) {
          if (f.family) names.add(f.family)
        }
        const list = Array.from(names).sort()
        setSystemFonts(list)
        onToast(t('已成功获取 {0} 个系统可用字体', list.length))
      } catch {
        onToast(t('获取系统字体未授权或当前环境受限'))
      } finally {
        setScanningFonts(false)
      }
    } else {
      onToast(t('当前环境不支持枚举系统字体，可在下方输入框直接填写本机字体名称'))
    }
  }

  return (
    <div ref={containerRef} className={pane(5, true)}>
      {/* 头部简介 */}
      <div className="flex items-center justify-between border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Palette size={16} className="text-seal" />
            <h2 className="text-[14px] font-semibold text-ink-strong">{t('外观与主题')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-soft">
            {t('自定义墨记的界面色彩、界面语言与辅助教学演示模式。')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-1 text-[11px] text-ok-deep">
          <Sparkles size={11} />
          <span>{t('即时生效 · 自动保存')}</span>
        </div>
      </div>

      {/* 主题选择卡片网格 */}
      <section id="settings-section-theme" className="flex flex-col gap-4 scroll-mt-4">
        <div>
          <div
            key={getHighlightKey('theme')}
            className={`flex items-center gap-1.5 text-[13px] font-medium text-ink-strong ${
              isHighlighted('theme') ? 'moji-setting-highlight' : ''
            }`}
          >
            <span>{t('主题配色')}</span>
            <span className="text-[11px] font-normal text-ink-faint">
              ({t('当前：{0}', t(THEME_LABEL[appearance.theme]))})
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {t('跟随系统只在浅色 / 深色之间自动切换；其余主题是独立配色，选定即固定。')}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {THEME_GROUPS.map((group) => (
            <div key={group.name} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[11.5px] text-ink-soft">
                <span className="font-medium text-ink">{t(group.name)}</span>
                <span className="text-[11px] text-ink-faint">· {t(group.hint)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                {group.modes.map((m) => {
                  const swatch = THEME_SWATCH[m]
                  const isSelected = appearance.theme === m
                  const isDark = isDarkTheme(m)

                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleThemeChange(m)}
                      className={`group relative flex flex-col rounded-xl border p-2 text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-seal/50 ${
                        isSelected
                          ? 'border-seal bg-seal/[0.04] shadow-sm ring-1 ring-seal/20'
                          : 'border-line bg-card hover:border-line-strong hover:bg-card/90 hover:shadow-xs'
                      }`}
                    >
                      {/* 迷你微缩视觉预览框 */}
                      {m === 'system' ? (
                        <div className="relative mb-2 flex h-12 w-full overflow-hidden rounded-lg border border-line-strong/30 shadow-inner">
                          <div
                            className="absolute inset-0"
                            style={{
                              background:
                                'linear-gradient(135deg, #f5f2eb 0%, #f5f2eb 50%, #17150f 50%, #17150f 100%)',
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-between px-2.5 text-[10.5px]">
                            <span className="font-medium text-[#2e2a25]">{t('浅')}</span>
                            <span className="font-medium text-[#e6e0d4]">{t('深')}</span>
                          </div>
                          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/40 px-1 py-0.5 text-[9px] text-white backdrop-blur-xs">
                            OS
                          </div>
                        </div>
                      ) : (
                        <div
                          className="relative mb-2 flex h-12 w-full flex-col justify-between overflow-hidden rounded-lg border border-black/10 p-1.5 shadow-inner dark:border-white/10"
                          style={{ backgroundColor: swatch.paper }}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className="h-2 w-2 rounded-full shadow-xs"
                              style={{ backgroundColor: swatch.accent }}
                            />
                            <span
                              className="h-1 w-5 rounded-full opacity-25"
                              style={{ backgroundColor: isDark ? '#ffffff' : '#000000' }}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <span
                              className="h-1.5 w-3/4 rounded-full opacity-20"
                              style={{ backgroundColor: isDark ? '#ffffff' : '#000000' }}
                            />
                            <span
                              className="h-1.5 w-1/2 rounded-full opacity-10"
                              style={{ backgroundColor: isDark ? '#ffffff' : '#000000' }}
                            />
                          </div>
                        </div>
                      )}

                      {/* 卡片底部名称与选中态指示 */}
                      <div className="flex items-center justify-between px-0.5">
                        <span
                          className={`text-[12px] ${
                            isSelected ? 'font-semibold text-seal-deep' : 'font-medium text-ink'
                          }`}
                        >
                          {t(THEME_LABEL[m])}
                        </span>
                        {isSelected ? (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-seal text-white shadow-xs">
                            <Check size={10} className="stroke-[3]" />
                          </span>
                        ) : (
                          <span
                            className="h-2 w-2 rounded-full opacity-0 transition-opacity group-hover:opacity-60"
                            style={{ backgroundColor: swatch.accent }}
                          />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 全局图片背景与幻灯片 */}
      <section id="settings-section-background" className="flex flex-col gap-4 rounded-xl border border-line bg-card/60 p-4 scroll-mt-4">
        {/* 隐藏的文件输入框 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* 开关头部 */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
              <ImageIcon size={15} />
            </div>
            <div>
              <div
                key={getHighlightKey('background')}
                className={`flex items-center gap-2 ${
                  isHighlighted('background') ? 'moji-setting-highlight' : ''
                }`}
              >
                <span className="text-[13px] font-medium text-ink-strong">{t('全局图片背景')}</span>
                {customBg.enabled && (
                  <span className="rounded-full bg-seal/10 px-2 py-0.5 text-[10px] font-medium text-seal-deep">
                    {customBg.mode === 'slideshow' ? t('幻灯片模式') : t('单图壁纸')}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                {t('在应用视口底层渲染自定义壁纸，降低界面底色不透明度以透出背景，支持创建图组幻灯片播放。')}
              </p>
            </div>
          </div>
          <div className="shrink-0 pt-0.5">
            <Switch
              on={customBg.enabled}
              onChange={(enabled) => {
                updateCustomBg({ enabled })
                onToast(enabled ? t('已启用全局图片背景') : t('已停用全局图片背景'))
              }}
              label=""
            />
          </div>
        </div>

        {customBg.enabled && (
          <div className="flex flex-col gap-4 border-t border-line/60 pt-3">
            {/* 1. 播放模式选择器（单张壁纸 vs 图组幻灯片） */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[12px] font-medium text-ink-strong">
                <span>{t('背景显示模式')}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateCustomBg({ mode: 'single' })}
                  className={`flex items-center justify-center gap-2 rounded-lg border py-2 text-[12px] font-medium transition ${
                    customBg.mode === 'single'
                      ? 'border-seal bg-seal/10 text-seal-deep shadow-xs ring-1 ring-seal/20'
                      : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'
                  }`}
                >
                  <Eye size={13} />
                  <span>{t('单张固定壁纸')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateCustomBg({ mode: 'slideshow' })}
                  className={`flex items-center justify-center gap-2 rounded-lg border py-2 text-[12px] font-medium transition ${
                    customBg.mode === 'slideshow'
                      ? 'border-seal bg-seal/10 text-seal-deep shadow-xs ring-1 ring-seal/20'
                      : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'
                  }`}
                >
                  <Play size={13} />
                  <span>{t('图组幻灯片播放')}</span>
                </button>
              </div>
            </div>

            {/* 2. 界面透明度与滤镜调节 */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-lg border border-line/50 bg-paper/30 p-3">
              {/* 界面不透明度 */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="text-ink-soft">{t('界面不透明度')}</span>
                  <span className="font-mono text-[11px] font-medium text-seal">{customBg.uiOpacity ?? 70}%</span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={95}
                  step={1}
                  value={customBg.uiOpacity ?? 70}
                  onChange={(e) => updateCustomBg({ uiOpacity: Number(e.target.value) })}
                  className="h-1.5 w-full cursor-pointer accent-seal"
                />
                <span className="text-[10px] text-ink-faint">{t('降低底色透出背景')}</span>
              </div>

              {/* 背景虚化 */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="text-ink-soft">{t('背景虚化模糊')}</span>
                  <span className="font-mono text-[11px] font-medium text-seal">{customBg.blur ?? 0}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={customBg.blur ?? 0}
                  onChange={(e) => updateCustomBg({ blur: Number(e.target.value) })}
                  className="h-1.5 w-full cursor-pointer accent-seal"
                />
                <span className="text-[10px] text-ink-faint">{t('柔化壁纸减少干扰')}</span>
              </div>
            </div>

            {/* 3. 填充策略 (Fit) */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium text-ink-soft">{t('填充策略')}</span>
              <div className="grid grid-cols-4 gap-1.5">
                {FIT_OPTIONS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => updateCustomBg({ fit: f.key })}
                    className={`rounded-md border py-1.5 text-center text-[11px] transition ${
                      (customBg.fit || 'cover') === f.key
                        ? 'border-seal/60 bg-seal/10 font-medium text-seal-deep ring-1 ring-seal/20'
                        : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    {t(f.label)}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. 幻灯片专属参数 (轮播间隔 + 顺序) */}
            {customBg.mode === 'slideshow' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-seal/20 bg-seal/[0.03] p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-ink-soft">{t('切换间隔')}</span>
                  <select
                    value={customBg.slideshowInterval || 60}
                    onChange={(e) => updateCustomBg({ slideshowInterval: Number(e.target.value) })}
                    className="rounded-md border border-line bg-card px-2 py-1 text-[11.5px] text-ink outline-none focus:border-seal"
                  >
                    {INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(opt.label)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11.5px] text-ink-soft">{t('播放顺序')}</span>
                  <div className="flex rounded-md border border-line bg-card p-0.5">
                    <button
                      type="button"
                      onClick={() => updateCustomBg({ slideshowOrder: 'sequence' })}
                      className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${
                        customBg.slideshowOrder !== 'random'
                          ? 'bg-seal text-white font-medium shadow-xs'
                          : 'text-ink-soft hover:text-ink'
                      }`}
                    >
                      <span>{t('顺序')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateCustomBg({ slideshowOrder: 'random' })}
                      className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${
                        customBg.slideshowOrder === 'random'
                          ? 'bg-seal text-white font-medium shadow-xs'
                          : 'text-ink-soft hover:text-ink'
                      }`}
                    >
                      <Shuffle size={10} />
                      <span>{t('随机')}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 5. 图组管理与壁纸画廊 */}
            <div className="flex flex-col gap-3 rounded-xl border border-line/70 bg-card/40 p-3">
              {/* 图组标签条 */}
              <div className="flex items-center justify-between border-b border-line/50 pb-2">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                  <Layers size={13} className="shrink-0 text-seal mr-1" />
                  {Array.from(new Map(customBg.groups.map((g) => [g.id, g])).values()).map((group) => {
                    const isGroupActive = group.id === activeGroup.id
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => updateCustomBg({ activeGroupId: group.id })}
                        className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] transition shrink-0 ${
                          isGroupActive
                            ? 'bg-seal text-white font-medium shadow-xs'
                            : 'bg-card border border-line text-ink-soft hover:text-ink hover:border-line-strong'
                        }`}
                      >
                        <span>{t(group.name)}</span>
                        <span className="text-[10px] opacity-75">({group.images.length})</span>
                      </button>
                    )
                  })}
                  {!isCreatingGroup ? (
                    <button
                      type="button"
                      onClick={() => setIsCreatingGroup(true)}
                      title={t('新建图组')}
                      className="flex items-center gap-1 rounded-lg border border-dashed border-line px-2 py-1 text-[11px] text-ink-soft transition hover:border-seal hover:text-seal"
                    >
                      <Plus size={11} />
                      <span>{t('新建图组')}</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        autoFocus
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder={t('图组名称')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateGroup()
                          if (e.key === 'Escape') setIsCreatingGroup(false)
                        }}
                        className="w-24 rounded border border-seal bg-card px-1.5 py-0.5 text-[11px] text-ink outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleCreateGroup}
                        className="rounded bg-seal px-1.5 py-0.5 text-[10.5px] text-white"
                      >
                        {t('确定')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsCreatingGroup(false)}
                        className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-soft"
                      >
                        {t('取消')}
                      </button>
                    </div>
                  )}
                </div>

                {/* 当前图组操作（删除） */}
                {customBg.groups.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteGroup(activeGroup.id)}
                    title={t('删除当前图组')}
                    className="flex items-center gap-1 text-[11px] text-ink-faint transition hover:text-seal-deep"
                  >
                    <Trash2 size={11} />
                    <span>{t('删除图组')}</span>
                  </button>
                )}
              </div>

              {/* 当前图组内的图片网格 */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                {Array.from(new Map(activeGroup.images.map((img) => [img.id, img])).values()).map((img) => {
                  const isCurrentSingle = customBg.singleImageUrl === img.url
                  return (
                    <div
                      key={img.id}
                      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-card p-1 transition ${
                        isCurrentSingle && customBg.mode === 'single'
                          ? 'border-seal ring-2 ring-seal/30'
                          : 'border-line hover:border-line-strong hover:shadow-xs'
                      }`}
                    >
                      {/* 图片缩略图预览 */}
                      <div
                        onClick={() => {
                          updateCustomBg({ singleImageUrl: img.url })
                          onToast(t('已设为当前壁纸：{0}', t(img.name)))
                        }}
                        className="relative h-20 w-full cursor-pointer overflow-hidden rounded-lg bg-cover bg-center shadow-inner transition group-hover:scale-[1.02]"
                        style={{ backgroundImage: `url("${img.url}")` }}
                      >
                        {isCurrentSingle && customBg.mode === 'single' && (
                          <div className="absolute top-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-seal text-white shadow-xs">
                            <Check size={9} className="stroke-[3]" />
                          </div>
                        )}
                      </div>

                      {/* 图片名与移除按钮 */}
                      <div className="mt-1 flex items-center justify-between px-1">
                        <span className="truncate text-[11px] font-medium text-ink" title={t(img.name)}>
                          {t(img.name)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(activeGroup.id, img.id)}
                          title={t('从图组中移除')}
                          className="opacity-0 transition-opacity group-hover:opacity-100 text-ink-faint hover:text-seal-deep"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* 添加图片操作卡片 */}
                <div className="flex flex-col justify-center gap-1.5 rounded-xl border border-dashed border-line bg-card/40 p-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setUploadTargetGroupId(activeGroup.id)
                      fileInputRef.current?.click()
                    }}
                    className="flex flex-col items-center justify-center rounded-lg p-2 text-ink-soft transition hover:bg-card hover:text-seal"
                  >
                    <Upload size={15} />
                    <span className="mt-1 text-[11px] font-medium">{t('上传本地图片')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingUrl(true)}
                    className="flex items-center justify-center gap-1 border-t border-line/40 pt-1 text-[10.5px] text-ink-faint hover:text-ink"
                  >
                    <LinkIcon size={10} />
                    <span>{t('添加网络图片')}</span>
                  </button>
                </div>
              </div>

              {/* 输入网络图片 URL 的小弹层 */}
              {isAddingUrl && (
                <div className="flex items-center gap-1.5 rounded-lg border border-line bg-card p-2">
                  <input
                    type="text"
                    autoFocus
                    placeholder={t('输入图片 URL 地址 (http/https)...')}
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddUrlSubmit()
                      if (e.key === 'Escape') setIsAddingUrl(false)
                    }}
                    className="flex-1 rounded border border-line bg-paper/60 px-2 py-1 text-[11.5px] text-ink outline-none focus:border-seal"
                  />
                  <button
                    type="button"
                    onClick={handleAddUrlSubmit}
                    className="rounded bg-seal px-2.5 py-1 text-[11px] font-medium text-white shadow-xs"
                  >
                    {t('添加')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingUrl(false)}
                    className="rounded border border-line px-2 py-1 text-[11px] text-ink-soft"
                  >
                    {t('取消')}
                  </button>
                </div>
              )}

              {/* 预设壁纸快捷添加到图组 */}
              <div className="mt-1 border-t border-line/40 pt-2">
                <div className="flex items-center justify-between text-[11px] text-ink-faint mb-1.5">
                  <div className="flex items-center gap-1">
                    <Sparkles size={11} className="text-seal/80" />
                    <span>{t('内置离线雅致壁纸库（随时一键添加）')}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  {PRESET_WALLPAPERS.map((preset) => {
                    const alreadyInGroup = activeGroup.images.some((img) => img.url === preset.url)
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          if (alreadyInGroup) {
                            updateCustomBg({ singleImageUrl: preset.url })
                            onToast(t('已设为当前壁纸：{0}', t(preset.name)))
                          } else {
                            handleAddImage(activeGroup.id, { name: preset.name, url: preset.url })
                          }
                        }}
                        title={alreadyInGroup ? t('已在图组中，点击直接设为当前壁纸') : t('点击添加至当前图组')}
                        className={`group relative flex flex-col items-center overflow-hidden rounded-lg border p-1 text-center transition ${
                          alreadyInGroup
                            ? 'border-seal/40 bg-seal/[0.04]'
                            : 'border-line bg-card hover:border-seal hover:shadow-xs'
                        }`}
                      >
                        <div
                          className="h-9 w-full rounded bg-cover bg-center shadow-inner"
                          style={{ backgroundImage: `url("${preset.url}")` }}
                        />
                        <span className="mt-1 truncate w-full text-[10px] text-ink-soft group-hover:text-ink">
                          {t(preset.name)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 全局字体与文字描边 */}
      <section id="settings-section-typography" className="flex flex-col gap-3 rounded-xl border border-line bg-card/60 p-3.5 scroll-mt-4">
        <div className="flex items-center justify-between">
          <div
            key={getHighlightKey('typography')}
            className={`flex items-center gap-1.5 text-[13px] font-medium text-ink-strong ${
              isHighlighted('typography') ? 'moji-setting-highlight' : ''
            }`}
          >
            <Type size={14} className="text-seal" />
            <span>{t('全局字体与排版')}</span>
          </div>
          <button
            type="button"
            onClick={handleScanSystemFonts}
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
                PRESET_FONTS.some((f) => f.value === appearance.fontFamily)
                  ? appearance.fontFamily
                  : systemFonts.includes(appearance.fontFamily || '')
                    ? appearance.fontFamily
                    : '__custom__'
              }
              onChange={(e) => {
                const val = e.target.value
                if (val !== '__custom__') {
                  setCustomFontInput(val)
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
                  setCustomFontInput(e.target.value)
                  onChange({ fontFamily: e.target.value })
                }}
                className="w-full rounded-lg border border-line bg-paper/60 px-2.5 py-1.5 text-[11.5px] text-ink outline-none focus:border-seal font-mono"
              />
              {appearance.fontFamily && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomFontInput('')
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
              on={Boolean(appearance.textStrokeEnabled)}
              onChange={(next) => onChange({ textStrokeEnabled: next })}
              label=""
            />
          </div>

          {appearance.textStrokeEnabled && (
            <div className="flex flex-col gap-2.5 rounded-lg border border-line/60 bg-card/40 p-2.5 text-[11.5px]">
              {/* 描边颜色选择 */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-ink-soft shrink-0">{t('描边颜色')}：</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={strokeColorDraft}
                    onChange={(e) => handleColorPickerChange(e.target.value)}
                    onBlur={() => commitStrokeColor(strokeColorDraft)}
                    className="h-6 w-7 cursor-pointer rounded border border-line bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={strokeColorDraft}
                    onChange={(e) => handleColorPickerChange(e.target.value)}
                    onBlur={() => commitStrokeColor(strokeColorDraft)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitStrokeColor(strokeColorDraft)
                    }}
                    className="w-20 rounded border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-seal"
                  />
                  {strokeColorDraft.toLowerCase() !== (appearance.textStrokeColor || '#1f1b17').toLowerCase() && (
                    <button
                      type="button"
                      onClick={() => commitStrokeColor(strokeColorDraft)}
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
                      onClick={() => commitStrokeColor(c)}
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
                    onChange={(e) => handleStrokeWidthChange(Number(e.target.value))}
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
                      onClick={() => handleStrokeWidthChange(w)}
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
            fontFamily: appearance.fontFamily || undefined,
            textShadow: appearance.textStrokeEnabled
              ? `-${strokeWidthDraft}px -${strokeWidthDraft}px 0 ${strokeColorDraft}, 0 -${strokeWidthDraft}px 0 ${strokeColorDraft}, ${strokeWidthDraft}px -${strokeWidthDraft}px 0 ${strokeColorDraft}, -${strokeWidthDraft}px 0 0 ${strokeColorDraft}, ${strokeWidthDraft}px 0 0 ${strokeColorDraft}, -${strokeWidthDraft}px ${strokeWidthDraft}px 0 ${strokeColorDraft}, 0 ${strokeWidthDraft}px 0 ${strokeColorDraft}, ${strokeWidthDraft}px ${strokeWidthDraft}px 0 ${strokeColorDraft}`
              : undefined,
          }}
        >
          <div className="text-[14px] font-medium text-ink">
            {t('纸墨相发，研精覃思。')} The quick brown fox jumps over the lazy dog.
          </div>
          <div className="mt-1 text-[11px] text-ink-soft">
            {t('当前字体')}：{appearance.fontFamily || t('系统默认')}
            {appearance.textStrokeEnabled &&
              ` · ${t('已启用硬描边')} (${strokeWidthDraft.toFixed(2)}px · ${strokeColorDraft})`}
          </div>
        </div>
      </section>

      {/* 界面语言 */}
      <section id="settings-section-locale" className="flex flex-col gap-2 rounded-xl border border-line bg-card/60 p-3.5 scroll-mt-4">
        <div
          key={getHighlightKey('locale')}
          className={`flex items-center gap-1.5 text-[13px] font-medium text-ink-strong ${
            isHighlighted('locale') ? 'moji-setting-highlight' : ''
          }`}
        >
          <Languages size={14} className="text-seal" />
          <span>{t('界面语言')}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {t('语言跟机器走，对所有用户生效；正文与对话内容不翻译。')}
        </p>

        <div className="mt-1 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {LOCALES.map((l) => {
            const isSelected = locale === l
            const info = LOCALE_INFO[l]
            return (
              <button
                key={l}
                type="button"
                onClick={() => changeUiLocale(l)}
                className={`flex items-center justify-between rounded-lg border p-2.5 text-left transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-seal/50 ${
                  isSelected
                    ? 'border-seal/60 bg-seal/10 font-medium text-seal-deep ring-1 ring-seal/20'
                    : 'border-line bg-card text-ink hover:border-line-strong hover:bg-card/90'
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-[12.5px] font-medium">{LOCALE_LABEL[l]}</span>
                  {info?.sub && (
                    <span className="text-[10.5px] text-ink-faint">{info.sub}</span>
                  )}
                </div>
                {isSelected && (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-seal text-white">
                    <Check size={10} className="stroke-[3]" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* 辅助与提示（教学演示模式 + 顶栏小技巧提示） */}
      <div id="settings-section-features" className="flex flex-col gap-3 scroll-mt-4">
        {/* 教学与演示模式 */}
        <section className="rounded-xl border border-line bg-card/60 p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-2.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
                <Presentation size={15} />
              </div>
              <div>
                <div
                  key={getHighlightKey('features')}
                  className={`text-[13px] font-medium text-ink-strong ${
                    isHighlighted('features') ? 'moji-setting-highlight' : ''
                  }`}
                >
                  {t('教学演示模式')}
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                  {t('打开后左下角常驻一块小窗，实时显示你按下的键（Ctrl + K 这样）。录屏讲课时观众看得见操作，而不是只看结果在变。它不挡点击，也不改任何按键行为。')}
                </div>
              </div>
            </div>
            <div className="shrink-0 pt-0.5">
              <Switch
                on={appearance.teachingMode}
                onChange={(next) => onChange({ teachingMode: next })}
                label=""
              />
            </div>
          </div>
        </section>

        {/* 顶栏小技巧提示 */}
        <section className="rounded-xl border border-line bg-card/60 p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-2.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
                <Sparkles size={15} />
              </div>
              <div>
                <div className="text-[13px] font-medium text-ink-strong">{t('顶栏技巧提示')}</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                  {t('在应用顶栏居中显示实用隐藏小技巧与快捷键轮播。每 10 秒平滑切换，鼠标悬停时暂停播放，点击可直接跳到下一条。')}
                </div>
              </div>
            </div>
            <div className="shrink-0 pt-0.5">
              <Switch
                on={appearance.showTips !== false}
                onChange={(next) => onChange({ showTips: next })}
                label=""
              />
            </div>
          </div>
        </section>
      </div>

      {/* 自动保存状态提示条 */}
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-card/50 px-3 py-2 text-[11px] text-ink-soft">
        <Check size={12} className="text-ok-deep stroke-[2.5]" />
        <span>{t('外观改动即时生效并自动保存。')}</span>
      </div>
    </div>
  )
}
