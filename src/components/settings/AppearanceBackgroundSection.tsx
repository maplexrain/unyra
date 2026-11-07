/**
 * 设置 → 外观：全局图片背景与幻灯片分区。
 *
 * 从 AppearancePanel 拆出的展示组件：负责背景开关、播放模式、透明度/虚化、
 * 填充策略、幻灯片参数、图组管理与壁纸画廊的展示；上传/图组/URL 等状态与
 * 回调由门面 AppearancePanel 持有并逐项传入。
 */

import {
  type ChangeEvent,
  type CSSProperties,
  type RefObject,
} from 'react'
import {
  Check,
  Eye,
  Image as ImageIcon,
  Layers,
  Link as LinkIcon,
  Play,
  Plus,
  Shuffle,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  PRESET_WALLPAPERS,
  presetRef,
  type BackgroundFit,
  type BackgroundGroup,
  type CustomBackgroundConfig,
} from '../../lib/customBackground'
import { t } from '../../i18n'
import Switch from '../Switch'

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
  /** 当前子 tab 是否处于高亮态（由门面按 highlightSubTab 计算） */
  highlighted: boolean
  /** 高亮动画用的 key（由门面按 highlightSubTab 计算） */
  highlightKey: string
  customBg: CustomBackgroundConfig
  /** 当前激活的图组（由门面按 activeGroupId 解析，含兜底） */
  activeGroup: BackgroundGroup
  /** 把配置里的地址解析成可绘制的 src 后铺背景（解析逻辑在门面的 useBackgroundSrcs） */
  bgStyle: (url: string) => CSSProperties
  updateCustomBg: (patch: Partial<CustomBackgroundConfig>) => void
  /** 隐藏文件输入框的 ref：input 本体在本组件里渲染，上传动作由门面触发 */
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void
  isCreatingGroup: boolean
  onCreatingGroupChange: (v: boolean) => void
  newGroupName: string
  onNewGroupNameChange: (v: string) => void
  onCreateGroup: () => void
  onDeleteGroup: (groupId: string) => void
  onAddImage: (groupId: string, img: { name: string; url: string; isPreset?: boolean }) => void
  onRemoveImage: (groupId: string, imageId: string) => void
  /** 点「上传本地图片」：门面记录目标图组并触发隐藏 input */
  onUploadClick: () => void
  isAddingUrl: boolean
  onAddingUrlChange: (v: boolean) => void
  imageUrlInput: string
  onImageUrlInputChange: (v: string) => void
  onAddUrlSubmit: () => void
  onToast: (msg: string) => void
}

export function AppearanceBackgroundSection({
  highlighted,
  highlightKey,
  customBg,
  activeGroup,
  bgStyle,
  updateCustomBg,
  fileInputRef,
  onFileChange,
  isCreatingGroup,
  onCreatingGroupChange,
  newGroupName,
  onNewGroupNameChange,
  onCreateGroup,
  onDeleteGroup,
  onAddImage,
  onRemoveImage,
  onUploadClick,
  isAddingUrl,
  onAddingUrlChange,
  imageUrlInput,
  onImageUrlInputChange,
  onAddUrlSubmit,
  onToast,
}: Props) {
  return (
    <section id="settings-section-background" className="flex flex-col gap-4 rounded-xl border border-line bg-card/60 p-4 scroll-mt-4">
      {/* 隐藏的文件输入框 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChange}
      />

      {/* 开关头部 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
            <ImageIcon size={15} />
          </div>
          <div>
            <div
              key={highlightKey}
              className={`flex items-center gap-2 ${
                highlighted ? 'moji-setting-highlight' : ''
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
                    onClick={() => onCreatingGroupChange(true)}
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
                      onChange={(e) => onNewGroupNameChange(e.target.value)}
                      placeholder={t('图组名称')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onCreateGroup()
                        if (e.key === 'Escape') onCreatingGroupChange(false)
                      }}
                      className="w-24 rounded border border-seal bg-card px-1.5 py-0.5 text-[11px] text-ink outline-none"
                    />
                    <button
                      type="button"
                      onClick={onCreateGroup}
                      className="rounded bg-seal px-1.5 py-0.5 text-[10.5px] text-white"
                    >
                      {t('确定')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onCreatingGroupChange(false)}
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
                  onClick={() => onDeleteGroup(activeGroup.id)}
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
                      style={bgStyle(img.url)}
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
                        onClick={() => onRemoveImage(activeGroup.id, img.id)}
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
                  onClick={onUploadClick}
                  className="flex flex-col items-center justify-center rounded-lg p-2 text-ink-soft transition hover:bg-card hover:text-seal"
                >
                  <Upload size={15} />
                  <span className="mt-1 text-[11px] font-medium">{t('上传本地图片')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onAddingUrlChange(true)}
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
                  onChange={(e) => onImageUrlInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onAddUrlSubmit()
                    if (e.key === 'Escape') onAddingUrlChange(false)
                  }}
                  className="flex-1 rounded border border-line bg-paper/60 px-2 py-1 text-[11.5px] text-ink outline-none focus:border-seal"
                />
                <button
                  type="button"
                  onClick={onAddUrlSubmit}
                  className="rounded bg-seal px-2.5 py-1 text-[11px] font-medium text-white shadow-xs"
                >
                  {t('添加')}
                </button>
                <button
                  type="button"
                  onClick={() => onAddingUrlChange(false)}
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
                  /*
                   * 内置壁纸在配置里记的是 `preset:<id>` 引用（见 lib/customBackground）——
                   * 图组里的那一份与这张卡片上的是同一张，所以比对的是引用而不是那段 SVG。
                   */
                  const ref = presetRef(preset.id)
                  const alreadyInGroup = activeGroup.images.some((img) => img.url === ref)
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        if (alreadyInGroup) {
                          updateCustomBg({ singleImageUrl: ref })
                          onToast(t('已设为当前壁纸：{0}', t(preset.name)))
                        } else {
                          // 传 id 而不是 url：本体的 data URL 只在本文件里当图用，不进配置
                          onAddImage(activeGroup.id, {
                            name: preset.name,
                            url: preset.id,
                            isPreset: true,
                          })
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
  )
}
