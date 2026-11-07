/**
 * 设置 → 外观：主题配色、界面语言与教学模式。
 *
 * 门面组件：保留既有导出（AppearancePanel），集中持有全部状态、防抖草稿与
 * 回调（切换二级 tab 时分区会卸载重挂，状态留在门面才能跨 tab 保留）；
 * 各表单分区的 JSX 拆在同目录的 AppearanceXxxSection.tsx 展示组件里，逐项传 props。
 */

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { Check, Palette, Sparkles } from 'lucide-react'
import { type Appearance } from '../../lib/appearance'
import {
  DEFAULT_CUSTOM_BACKGROUND,
  PRESET_GROUPS,
  presetRef,
  type BackgroundGroup,
  type BackgroundImageItem,
  type CustomBackgroundConfig,
} from '../../lib/customBackground'
import { saveBackgroundImage } from '../../user/background'
import { useBackgroundSrcs } from '../background/useBackgroundSrc'
import { t, useLocale } from '../../i18n'
import { pane } from '../Pane'
import { AppearanceThemeSection } from './AppearanceThemeSection'
import { AppearanceBackgroundSection } from './AppearanceBackgroundSection'
import { AppearanceTypographySection } from './AppearanceTypographySection'
import { AppearanceLocaleSection } from './AppearanceLocaleSection'
import { AppearanceFeaturesSection } from './AppearanceFeaturesSection'

interface Props {
  appearance: Appearance
  onChange: (patch: Partial<Appearance>) => void
  onToast: (msg: string) => void
  activeSubTab?: string
  highlightSubTab?: { key: string; nonce: number } | null
  onSubTabChange?: (sub: string) => void
}

export function AppearancePanel({
  appearance,
  onChange,
  onToast,
  activeSubTab,
  highlightSubTab,
  onSubTabChange: _onSubTabChange,
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

  // 二级 tab 过滤模式：切换子 tab 时将面板滚动条重置到顶部
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
    }
  }, [activeSubTab])

  const activeGroup =
    customBg.groups.find((g) => g.id === customBg.activeGroupId) ??
    customBg.groups[0] ??
    PRESET_GROUPS[0]

  /*
   * 缩略图要的 src：配置里存的是地址（`preset:` / `asset:` / 外链），不是图片本身
   * （见 lib/customBackground 的文件头），所以先解析成能画的 src 再铺。
   * 只解当前这一组的：别的组等切过去再解。
   */
  const activeGroupImages = activeGroup.images
  const bgSrcs = useBackgroundSrcs(activeGroupImages.map((img) => img.url))
  const bgSrc = (url: string): string => (url ? (bgSrcs[url] ?? '') : '')
  const bgStyle = (url: string): CSSProperties => {
    const src = bgSrc(url)
    return src ? { backgroundImage: `url("${src}")` } : {}
  }

  const updateCustomBg = (patch: Partial<CustomBackgroundConfig>) => {
    onChange({ customBg: { ...customBg, ...patch } })
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

  const handleAddImage = (groupId: string, img: { name: string; url: string; isPreset?: boolean }) => {
    const newItem: BackgroundImageItem = {
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: img.name,
      // 内置壁纸记 id 引用、上传的记 asset: 地址——地址该长什么样由这里定死，
      // 别处只负责把图片放好（见 lib/customBackground 的 backgroundRefOf）
      url: img.isPreset ? presetRef(img.url) : img.url,
      ...(img.isPreset ? { isPreset: true } : {}),
    }
    const nextGroups = customBg.groups.map((g) => {
      if (g.id !== groupId) return g
      return { ...g, images: [...g.images, newItem] }
    })
    updateCustomBg({
      groups: nextGroups,
      singleImageUrl: customBg.singleImageUrl || newItem.url,
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

  /**
   * 本地图片走 assets/：图片本身写进 `{user}/assets/`，配置里只留一个 `asset:` 地址
   * （见 user/background）。从前是 FileReader 读成 data URL 直接塞进配置，
   * 几张照片就能把 setting.yaml 撑到几 MB。
   */
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      onToast(t('请选择图片格式文件'))
      return
    }
    try {
      const url = await saveBackgroundImage(file)
      const targetId = uploadTargetGroupId || activeGroup.id
      handleAddImage(targetId, { name: file.name.replace(/\.[^/.]+$/, ''), url })
    } catch (err) {
      onToast(err instanceof Error ? err.message : t('背景图处理失败'))
    } finally {
      e.target.value = ''
    }
  }

  const handleAddUrlSubmit = () => {
    const url = imageUrlInput.trim()
    if (!url) return
    /*
     * 明确挡掉 data: ——它是图片字节本身，不是地址。这一条既保住了「配置里只有地址」
     * 的纪律，也顺手把「拷一段 base64 粘进来」这条路堵上（要放本地图，走上面的上传）。
     */
    if (url.startsWith('data:')) {
      onToast(t('这里只能填图片地址（http / https）。本地图片请用上面的「上传图片」'))
      return
    }
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
      {(!activeSubTab || activeSubTab === 'theme') && (
        <AppearanceThemeSection
          theme={appearance.theme}
          onChange={onChange}
          onToast={onToast}
          highlighted={isHighlighted('theme')}
          highlightKey={getHighlightKey('theme')}
        />
      )}

      {/* 全局图片背景与幻灯片 */}
      {(!activeSubTab || activeSubTab === 'background') && (
        <AppearanceBackgroundSection
          highlighted={isHighlighted('background')}
          highlightKey={getHighlightKey('background')}
          customBg={customBg}
          activeGroup={activeGroup}
          bgStyle={bgStyle}
          updateCustomBg={updateCustomBg}
          fileInputRef={fileInputRef}
          onFileChange={handleFileChange}
          isCreatingGroup={isCreatingGroup}
          onCreatingGroupChange={setIsCreatingGroup}
          newGroupName={newGroupName}
          onNewGroupNameChange={setNewGroupName}
          onCreateGroup={handleCreateGroup}
          onDeleteGroup={handleDeleteGroup}
          onAddImage={handleAddImage}
          onRemoveImage={handleRemoveImage}
          onUploadClick={() => {
            setUploadTargetGroupId(activeGroup.id)
            fileInputRef.current?.click()
          }}
          isAddingUrl={isAddingUrl}
          onAddingUrlChange={setIsAddingUrl}
          imageUrlInput={imageUrlInput}
          onImageUrlInputChange={setImageUrlInput}
          onAddUrlSubmit={handleAddUrlSubmit}
          onToast={onToast}
        />
      )}

      {/* 全局字体与文字描边 */}
      {(!activeSubTab || activeSubTab === 'typography') && (
        <AppearanceTypographySection
          highlighted={isHighlighted('typography')}
          highlightKey={getHighlightKey('typography')}
          fontFamily={appearance.fontFamily}
          textStrokeEnabled={appearance.textStrokeEnabled}
          textStrokeColor={appearance.textStrokeColor}
          systemFonts={systemFonts}
          scanningFonts={scanningFonts}
          customFontInput={customFontInput}
          onCustomFontInputChange={setCustomFontInput}
          onChange={onChange}
          onScanSystemFonts={handleScanSystemFonts}
          strokeColorDraft={strokeColorDraft}
          strokeWidthDraft={strokeWidthDraft}
          onCommitStrokeColor={commitStrokeColor}
          onColorPickerChange={handleColorPickerChange}
          onStrokeWidthChange={handleStrokeWidthChange}
        />
      )}

      {/* 界面语言 */}
      {(!activeSubTab || activeSubTab === 'locale') && (
        <AppearanceLocaleSection
          locale={locale}
          onToast={onToast}
          highlighted={isHighlighted('locale')}
          highlightKey={getHighlightKey('locale')}
        />
      )}

      {/* 辅助与提示（教学演示模式 + 顶栏小技巧提示） */}
      {(!activeSubTab || activeSubTab === 'features') && (
        <AppearanceFeaturesSection
          teachingMode={appearance.teachingMode}
          showTips={appearance.showTips}
          onChange={onChange}
          highlighted={isHighlighted('features')}
          highlightKey={getHighlightKey('features')}
        />
      )}

      {/* 自动保存状态提示条 */}
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-card/50 px-3 py-2 text-[11px] text-ink-soft">
        <Check size={12} className="text-ok-deep stroke-[2.5]" />
        <span>{t('外观改动即时生效并自动保存。')}</span>
      </div>
    </div>
  )
}
