/**
 * 全局图片背景与幻灯片配置。
 *
 * 属于外观设置的一部分，存放在用户的 setting.yaml 中，跟随用户配置走。
 * 提供预设相册、自定义相册管理、本地图片与 URL 导入、显示策略（cover/contain/repeat/center）、
 * 虚化与遮罩调节、以及界面半透明毛玻璃效果。
 *
 * **配置里只放地址，图片本体放在别处**（用户定的纪律，与头像同一条）：
 * - `asset:bg-1730000000000.png` —— 用户上传的图，落在 `{user}/assets/`（见 user/assets）；
 * - `preset:preset-xuan` —— 内置壁纸，本体是这个文件里的那个 SVG 常量；
 * - `https://…` —— 外链。
 *
 * 从前上传的图是用 FileReader 读成 data URL 直接写进配置的，setting.yaml 会被几张照片
 * 撑到几 MB、每次启动都要整份解析。内置壁纸更有意思：它本来就在代码里，配置里却存着
 * **另一份拷贝**——壁纸改了，老用户的配置里还是旧的那张。现在两边都只记一个引用。
 */

export type BackgroundFit = 'cover' | 'contain' | 'center' | 'repeat'
export type SlideshowOrder = 'sequence' | 'random'

export interface BackgroundImageItem {
  id: string
  name: string
  /** 图片地址：`asset:` / `preset:` / `http(s):`（见文件头），绝不存图片字节 */
  url: string
  isPreset?: boolean
}

export interface BackgroundGroup {
  id: string
  name: string
  images: BackgroundImageItem[]
  isPreset?: boolean
}

export interface CustomBackgroundConfig {
  /** 是否开启全局图片背景 */
  enabled: boolean
  /** 模式：单张图片或图组幻灯片 */
  mode: 'single' | 'slideshow'
  /** 单张图片模式下的选中图片 URL */
  singleImageUrl: string
  /** 幻灯片当前激活的图组 ID */
  activeGroupId: string
  /** 所有图组列表（含预设与自定义） */
  groups: BackgroundGroup[]
  /** 幻灯片切换间隔（秒） */
  slideshowInterval: number
  /** 幻灯片播放顺序 */
  slideshowOrder: SlideshowOrder
  /** 图像填充方式 */
  fit: BackgroundFit
  /** 背景高斯模糊半径 (px, 0~30) */
  blur: number
  /** UI 表面不透明度 (%, 50~95) - 降低 UI 颜色不透明度以透出背景 */
  uiOpacity: number
  /** 背景遮罩浓度（已弃用） */
  dim?: number
}

/* ---------- 内置艺术壁纸预设（矢量 SVG 离线可用，轻量免网） ---------- */

/** 1. 仿古宣纸纹理 */
const SVG_XUAN_PAPER = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <radialGradient id="paperGlow" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#faf5ea"/>
      <stop offset="60%" stop-color="#f2ead7"/>
      <stop offset="100%" stop-color="#e8debe"/>
    </radialGradient>
    <filter id="paperFiber" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="noise"/>
      <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.08 0" result="colored"/>
      <feBlend mode="multiply" in="SourceGraphic" in2="colored"/>
    </filter>
  </defs>
  <rect width="800" height="600" fill="url(#paperGlow)"/>
  <rect width="800" height="600" fill="none" filter="url(#paperFiber)"/>
  <circle cx="680" cy="120" r="45" fill="#a8432f" opacity="0.06"/>
  <circle cx="680" cy="120" r="38" fill="none" stroke="#a8432f" stroke-width="1.5" opacity="0.12"/>
</svg>
`)}`

/** 2. 泼墨山峦 */
const SVG_INK_MOUNTAINS = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2c3038"/>
      <stop offset="45%" stop-color="#3d434d"/>
      <stop offset="70%" stop-color="#606670"/>
      <stop offset="100%" stop-color="#8a8e94"/>
    </linearGradient>
    <linearGradient id="m1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#181a1f" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#282c34" stop-opacity="0.8"/>
    </linearGradient>
    <linearGradient id="m2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#363c45" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#4e5663" stop-opacity="0.6"/>
    </linearGradient>
    <linearGradient id="m3" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#555d69" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#7a828f" stop-opacity="0.3"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#skyGrad)"/>
  <circle cx="950" cy="220" r="55" fill="#f4ebd9" opacity="0.75"/>
  <path d="M0 500 Q 250 360, 500 480 T 950 420 T 1200 470 L 1200 800 L 0 800 Z" fill="url(#m3)"/>
  <path d="M0 560 Q 300 430, 650 540 T 1100 500 T 1200 530 L 1200 800 L 0 800 Z" fill="url(#m2)"/>
  <path d="M0 640 Q 200 520, 480 620 T 920 590 T 1200 660 L 1200 800 L 0 800 Z" fill="url(#m1)"/>
</svg>
`)}`

/** 3. 烟雨竹林 */
const SVG_BAMBOO_MIST = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="bambooBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1f2923"/>
      <stop offset="50%" stop-color="#2d3b33"/>
      <stop offset="100%" stop-color="#415347"/>
    </linearGradient>
    <linearGradient id="stalk" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#3d5244"/>
      <stop offset="50%" stop-color="#607d6b"/>
      <stop offset="100%" stop-color="#2d3e33"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#bambooBg)"/>
  <g opacity="0.45">
    <rect x="120" y="0" width="16" height="800" fill="url(#stalk)"/>
    <rect x="280" y="0" width="22" height="800" fill="url(#stalk)"/>
    <rect x="460" y="0" width="14" height="800" fill="url(#stalk)"/>
    <rect x="740" y="0" width="26" height="800" fill="url(#stalk)"/>
    <rect x="920" y="0" width="18" height="800" fill="url(#stalk)"/>
    <rect x="1080" y="0" width="15" height="800" fill="url(#stalk)"/>
  </g>
  <g opacity="0.25">
    <rect x="60" y="0" width="10" height="800" fill="#a4b8ab"/>
    <rect x="390" y="0" width="12" height="800" fill="#a4b8ab"/>
    <rect x="620" y="0" width="9" height="800" fill="#a4b8ab"/>
    <rect x="850" y="0" width="14" height="800" fill="#a4b8ab"/>
  </g>
  <ellipse cx="600" cy="700" rx="650" ry="200" fill="#2d3e33" opacity="0.65"/>
</svg>
`)}`

/** 4. 远山青黛 */
const SVG_INDIGO_PEAKS = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="indigoBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#141d2b"/>
      <stop offset="50%" stop-color="#1e2d42"/>
      <stop offset="100%" stop-color="#344866"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#indigoBg)"/>
  <circle cx="280" cy="240" r="70" fill="#f7d9a0" opacity="0.6"/>
  <path d="M0 480 Q 220 320, 520 460 T 980 400 T 1200 480 L 1200 800 L 0 800 Z" fill="#253752" opacity="0.75"/>
  <path d="M0 580 Q 360 440, 720 560 T 1200 540 L 1200 800 L 0 800 Z" fill="#182436" opacity="0.9"/>
  <path d="M0 680 Q 240 580, 580 660 T 1200 640 L 1200 800 L 0 800 Z" fill="#0e1622"/>
</svg>
`)}`

/** 5. 晨曦微光 */
const SVG_SERENE_DAWN = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="dawnBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#36394d"/>
      <stop offset="40%" stop-color="#6b5b6e"/>
      <stop offset="75%" stop-color="#b8837e"/>
      <stop offset="100%" stop-color="#e4b39b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#dawnBg)"/>
  <circle cx="600" cy="520" r="130" fill="#ffeedd" opacity="0.55"/>
  <ellipse cx="600" cy="740" rx="700" ry="160" fill="#36394d" opacity="0.65"/>
</svg>
`)}`

/** 6. 星野夜读 */
const SVG_STARRY_NIGHT = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <radialGradient id="nebula" cx="60%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#2a2342"/>
      <stop offset="50%" stop-color="#171826"/>
      <stop offset="100%" stop-color="#0d0e17"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#nebula)"/>
  <g fill="#ffffff" opacity="0.65">
    <circle cx="150" cy="90" r="1.5"/><circle cx="280" cy="180" r="1"/><circle cx="420" cy="70" r="2"/>
    <circle cx="560" cy="210" r="1"/><circle cx="700" cy="110" r="1.8"/><circle cx="830" cy="160" r="1.2"/>
    <circle cx="950" cy="80" r="1.5"/><circle cx="1080" cy="220" r="2"/><circle cx="340" cy="310" r="1.4"/>
    <circle cx="620" cy="290" r="1.2"/><circle cx="880" cy="340" r="1.6"/><circle cx="180" cy="420" r="1"/>
  </g>
</svg>
`)}`

export const PRESET_IMAGES: BackgroundImageItem[] = [
  { id: 'preset-xuan', name: '仿古宣纸', url: SVG_XUAN_PAPER, isPreset: true },
  { id: 'preset-ink', name: '水墨江山', url: SVG_INK_MOUNTAINS, isPreset: true },
  { id: 'preset-bamboo', name: '烟雨竹林', url: SVG_BAMBOO_MIST, isPreset: true },
  { id: 'preset-indigo', name: '远山青黛', url: SVG_INDIGO_PEAKS, isPreset: true },
  { id: 'preset-dawn', name: '晨曦微光', url: SVG_SERENE_DAWN, isPreset: true },
  { id: 'preset-starry', name: '星野夜读', url: SVG_STARRY_NIGHT, isPreset: true },
]

export const PRESET_WALLPAPERS = PRESET_IMAGES

/* ---------- 图片引用：配置里只记地址 ---------- */

/**
 * 内置壁纸的引用前缀：`preset:preset-xuan`。
 *
 * 为什么内置壁纸也要走引用：它本来就住在这个文件里（PRESET_IMAGES 的 url），
 * 配置里再存一份拷贝，就多了一份**会过期的数据**——哪天把那张 SVG 调好看一点，
 * 老用户的配置里还是旧的那张，谁也没法知道该以哪一份为准。记 id 之后，
 * 壁纸永远跟着代码走，配置里那一个短字符串也再不会被误当成「用户自己的图」。
 */
export const PRESET_SCHEME = 'preset:'

/** 内置壁纸 id → 它在配置里的地址 */
export function presetRef(id: string): string {
  return PRESET_SCHEME + id
}

/** `preset:xxx` → id；认不出来（不是引用、或没有这张壁纸）时 null */
export function presetIdOf(v: string): string | null {
  if (!v.startsWith(PRESET_SCHEME)) return null
  const id = v.slice(PRESET_SCHEME.length)
  return PRESET_IMAGES.some((p) => p.id === id) ? id : null
}

/** `preset:xxx` → 那张内置壁纸的 data URL（内置矢量图，常量就是它的本体） */
export function presetSrcOf(v: string): string | null {
  const id = presetIdOf(v)
  if (!id) return null
  return PRESET_IMAGES.find((p) => p.id === id)?.url ?? null
}

/** 这张图该以什么地址进配置：内置壁纸记 id 引用，其余记它自己的 url */
export function backgroundRefOf(item: BackgroundImageItem): string {
  return presetIdOf(item.url) ? item.url : item.isPreset ? presetRef(item.id) : item.url
}

/** 老配置里把内置壁纸的整段 SVG 存了进来：按 url 认出来，好换成 id 引用 */
function presetIdByUrl(url: string): string | null {
  if (!url.startsWith('data:')) return null
  return PRESET_IMAGES.find((p) => p.url === url)?.id ?? null
}

/**
 * 把一段存下来的地址归一成「引用」形态。
 *
 * 两种改写：
 * - 内置壁纸的整段 SVG（老配置）→ `preset:<id>`——顺手消化掉那份拷贝；
 * - 其余原样留着，**包括 data: 开头的**：用户上传的老图此刻还只是一段 base64，
 *   落盘要读要写（异步），不是这个纯函数该干的事。它由启动时的
 *   reconcileBackgroundAssets 迁进 assets/，在那之前留着至少图还看得见。
 */
function normalizeImageRef(raw: string): string {
  const byPreset = presetIdByUrl(raw)
  return byPreset ? presetRef(byPreset) : raw
}

/** 内置图组（配置形态：里面的地址已经是 `preset:` 引用） */
export const PRESET_GROUPS: BackgroundGroup[] = [
  {
    id: 'group-ink-aesthetic',
    name: '纸墨雅集',
    images: [PRESET_IMAGES[0], PRESET_IMAGES[1], PRESET_IMAGES[2]].map((img) => ({
      ...img,
      url: presetRef(img.id),
    })),
    isPreset: true,
  },
  {
    id: 'group-nature-scenery',
    name: '山河天光',
    images: [PRESET_IMAGES[3], PRESET_IMAGES[4], PRESET_IMAGES[5]].map((img) => ({
      ...img,
      url: presetRef(img.id),
    })),
    isPreset: true,
  },
]

export const DEFAULT_CUSTOM_BACKGROUND: CustomBackgroundConfig = {
  enabled: false,
  mode: 'single',
  singleImageUrl: presetRef(PRESET_IMAGES[0].id),
  activeGroupId: PRESET_GROUPS[0].id,
  groups: [...PRESET_GROUPS],
  slideshowInterval: 60, // 默认 1 分钟轮播
  slideshowOrder: 'sequence',
  fit: 'cover',
  blur: 0,
  uiOpacity: 70, // 默认 70% 不透明度
}

export function normalizeCustomBackground(raw: unknown): CustomBackgroundConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CUSTOM_BACKGROUND }
  }
  const r = raw as Record<string, unknown>

  const enabled = r.enabled === true
  const mode = r.mode === 'slideshow' ? 'slideshow' : 'single'
  const singleImageUrl =
    typeof r.singleImageUrl === 'string' && r.singleImageUrl.trim()
      ? normalizeImageRef(r.singleImageUrl.trim())
      : DEFAULT_CUSTOM_BACKGROUND.singleImageUrl
  const activeGroupId =
    typeof r.activeGroupId === 'string' && r.activeGroupId.trim()
      ? r.activeGroupId
      : DEFAULT_CUSTOM_BACKGROUND.activeGroupId

  let groups: BackgroundGroup[] = PRESET_GROUPS
  if (Array.isArray(r.groups) && r.groups.length > 0) {
    groups = r.groups.map((g, idx) => {
      const gObj = g as Record<string, unknown>
      const gId = typeof gObj.id === 'string' && gObj.id.trim() ? gObj.id : `group-${idx}`
      const gName = typeof gObj.name === 'string' && gObj.name.trim() ? gObj.name : `图组 ${idx + 1}`
      const images: BackgroundImageItem[] = Array.isArray(gObj.images)
        ? gObj.images.map((img, iIdx) => {
            const iObj = img as Record<string, unknown>
            const url = typeof iObj.url === 'string' ? normalizeImageRef(iObj.url.trim()) : ''
            return {
              id: typeof iObj.id === 'string' && iObj.id.trim() ? iObj.id : `img-${idx}-${iIdx}`,
              name: typeof iObj.name === 'string' && iObj.name.trim() ? iObj.name : `图片 ${iIdx + 1}`,
              url,
              // 是不是内置壁纸**由地址说了算**，不看存下来的那个标记：
              // 老配置里存着整段 SVG 时它可能是空的，而地址迁成 preset: 之后它就是内置的
              isPreset: presetIdOf(url) !== null,
            }
          }).filter((img) => Boolean(img.url))
        : []

      // 确保组内每张图片 ID 唯一
      const seenImg = new Set<string>()
      const uniqueImages = images.filter((img) => {
        if (!img.id || seenImg.has(img.id)) return false
        seenImg.add(img.id)
        return true
      })

      return {
        id: gId,
        name: gName,
        images: uniqueImages,
        isPreset: gObj.isPreset === true,
      }
    })
  }

  // 强去重：按 ID 严格去重，杜绝任何重复键值
  const seenGroupIds = new Set<string>()
  const uniqueGroups: BackgroundGroup[] = []
  for (const g of groups) {
    if (g.id && !seenGroupIds.has(g.id)) {
      seenGroupIds.add(g.id)
      uniqueGroups.push(g)
    }
  }

  // 补齐缺失的预设图组（仅当确实不存在时补入，避免重复）
  for (const presetGroup of PRESET_GROUPS) {
    if (!seenGroupIds.has(presetGroup.id)) {
      seenGroupIds.add(presetGroup.id)
      uniqueGroups.push(presetGroup)
    }
  }

  groups = uniqueGroups.length > 0 ? uniqueGroups : [...PRESET_GROUPS]

  const validFits: BackgroundFit[] = ['cover', 'contain', 'center', 'repeat']
  const fit = validFits.includes(r.fit as BackgroundFit) ? (r.fit as BackgroundFit) : 'cover'

  const slideshowOrder: SlideshowOrder = r.slideshowOrder === 'random' ? 'random' : 'sequence'
  const slideshowInterval =
    typeof r.slideshowInterval === 'number' && r.slideshowInterval >= 5
      ? Math.round(r.slideshowInterval)
      : DEFAULT_CUSTOM_BACKGROUND.slideshowInterval

  const blur =
    typeof r.blur === 'number' && Number.isFinite(r.blur)
      ? Math.max(0, Math.min(30, Math.round(r.blur)))
      : DEFAULT_CUSTOM_BACKGROUND.blur

  const uiOpacity =
    typeof r.uiOpacity === 'number' && Number.isFinite(r.uiOpacity)
      ? Math.max(30, Math.min(95, Math.round(r.uiOpacity)))
      : DEFAULT_CUSTOM_BACKGROUND.uiOpacity

  return {
    enabled,
    mode,
    singleImageUrl,
    activeGroupId,
    groups,
    slideshowInterval,
    slideshowOrder,
    fit,
    blur,
    uiOpacity,
  }
}
