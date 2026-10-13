import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CUSTOM_BACKGROUND,
  PRESET_GROUPS,
  PRESET_IMAGES,
  normalizeCustomBackground,
  presetIdOf,
  presetRef,
  presetSrcOf,
} from '../src/lib/customBackground'

describe('customBackground', () => {
  it('默认配置使用 70% 不透明度', () => {
    expect(DEFAULT_CUSTOM_BACKGROUND.uiOpacity).toBe(70)
    expect(DEFAULT_CUSTOM_BACKGROUND.enabled).toBe(false)
    expect(DEFAULT_CUSTOM_BACKGROUND.mode).toBe('single')
  })

  it('normalizeCustomBackground 规范化非法与缺省参数', () => {
    const empty = normalizeCustomBackground({})
    expect(empty.uiOpacity).toBe(70)
    expect(empty.blur).toBe(0)
    expect(empty.enabled).toBe(false)

    const custom = normalizeCustomBackground({
      enabled: true,
      uiOpacity: 55,
      blur: 12,
    })
    expect(custom.enabled).toBe(true)
    expect(custom.uiOpacity).toBe(55)
    expect(custom.blur).toBe(12)
  })

  it('normalizeCustomBackground 限制不透明度与虚化在有效范围', () => {
    const low = normalizeCustomBackground({ uiOpacity: 10, blur: -5 })
    expect(low.uiOpacity).toBe(30)
    expect(low.blur).toBe(0)

    const high = normalizeCustomBackground({ uiOpacity: 120, blur: 50 })
    expect(high.uiOpacity).toBe(95)
    expect(high.blur).toBe(30)
  })

  it('normalizeCustomBackground 严格去重图组 ID', () => {
    const dup = normalizeCustomBackground({
      groups: [
        { id: 'g1', name: 'Group 1', images: [] },
        { id: 'g1', name: 'Group 1 duplicate', images: [] },
        { id: 'g2', name: 'Group 2', images: [] },
      ],
    })
    const g1Count = dup.groups.filter((g) => g.id === 'g1').length
    expect(g1Count).toBe(1)
  })
})

/**
 * 配置里**只放地址，不放图片字节**（用户定的纪律，与头像同一条）。
 *
 * 这一组盯的就是这件事：内置壁纸也要按引用记，配置里不许出现它的整段 SVG。
 */
describe('背景图引用 (preset:)', () => {
  const isInlineData = (v: string) => v.startsWith('data:')

  it('内置壁纸的地址是 preset: 引用，不是那段 SVG', () => {
    expect(presetRef('preset-xuan')).toBe('preset:preset-xuan')
    expect(presetIdOf('preset:preset-xuan')).toBe('preset-xuan')
    // 认不出来的：没有这张壁纸、前缀不对、空串
    expect(presetIdOf('preset:不存在的壁纸')).toBeNull()
    expect(presetIdOf('https://example.com/a.png')).toBeNull()
    expect(presetIdOf('asset:bg-1.png')).toBeNull()
    expect(presetIdOf('')).toBeNull()
  })

  it('引用能解析回本体（内置矢量图就在代码里）', () => {
    const src = presetSrcOf('preset:preset-xuan')
    expect(src).toBe(PRESET_IMAGES[0].url)
    expect(src?.startsWith('data:image/svg+xml')).toBe(true)
    expect(presetSrcOf('preset:不存在的壁纸')).toBeNull()
  })

  it('默认配置与内置图组里存的是引用，一个图片字节都没有', () => {
    expect(isInlineData(DEFAULT_CUSTOM_BACKGROUND.singleImageUrl)).toBe(false)
    expect(presetIdOf(DEFAULT_CUSTOM_BACKGROUND.singleImageUrl)).toBe(PRESET_IMAGES[0].id)

    for (const g of PRESET_GROUPS) {
      for (const img of g.images) {
        expect(isInlineData(img.url)).toBe(false)
        expect(presetIdOf(img.url)).toBe(img.id)
      }
    }
  })

  it('老配置里存着内置壁纸的整段 SVG：读回来时换成引用', () => {
    const legacy = normalizeCustomBackground({
      enabled: true,
      singleImageUrl: PRESET_IMAGES[0].url,
      groups: [
        {
          id: 'g-legacy',
          name: '老图组',
          images: [
            { id: 'i1', name: '仿古宣纸', url: PRESET_IMAGES[0].url },
            { id: 'i2', name: '水墨江山', url: PRESET_IMAGES[1].url },
          ],
        },
      ],
    })
    // 单张那张：整段 SVG → 引用
    expect(legacy.singleImageUrl).toBe(presetRef(PRESET_IMAGES[0].id))
    // 图组里两张同理，并且 isPreset 由地址推出来（老配置里那个标记可能是空的）
    const group = legacy.groups.find((g) => g.id === 'g-legacy')
    const urls = group?.images.map((i) => i.url) ?? []
    expect(urls).toEqual([presetRef('preset-xuan'), presetRef('preset-ink')])
    expect(group?.images.every((i) => i.isPreset)).toBe(true)
  })

  it('用户上传的老图（data:）先原样留着——它要靠启动时的对账迁进 assets/', () => {
    // 这里是**纯函数**，读盘写盘都不是它的事；丢掉才是错的（那等于把用户的图删了）
    const legacy = normalizeCustomBackground({
      singleImageUrl: 'data:image/png;base64,iVBORw0KGgo=',
    })
    expect(legacy.singleImageUrl).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('asset: 与外链原样保留', () => {
    const refs = ['asset:bg-1730000000000.png', 'https://example.com/w.jpg']
    const cfg = normalizeCustomBackground({
      singleImageUrl: refs[0],
      groups: [{ id: 'g1', name: 'g', images: [{ id: 'i1', name: 'n', url: refs[1] }] }],
    })
    expect(cfg.singleImageUrl).toBe(refs[0])
    expect(cfg.groups.find((g) => g.id === 'g1')?.images[0]?.url).toBe(refs[1])
    // 外链与 asset 都不是内置壁纸
    expect(cfg.groups.find((g) => g.id === 'g1')?.images[0]?.isPreset).toBe(false)
  })
})
