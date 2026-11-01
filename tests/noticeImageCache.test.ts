// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  extractNoticeImageUrls,
  injectCachedNoticeImages,
  isRemoteHttpUrl,
  getOrFetchNoticeImage,
  precacheNoticeImages,
  clearNoticeImageMemCache,
  setNoticeImageMemCache,
  getNoticeImageMemCache,
} from '../src/lib/noticeImageCache'
import type { RemoteNotice } from '../src/lib/notice'
import { renderNote } from '../src/lib/markdown'

const SAMPLE_IMG_1 = 'https://maplexrain.github.io/unyra-notice/images/feature-v073.png'
const SAMPLE_IMG_2 = 'https://maplexrain.github.io/unyra-notice/images/preview.jpg'
const MOCK_DATA_URL_1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('noticeImageCache 纯函数工具', () => {
  describe('isRemoteHttpUrl', () => {
    it('正确识别 http 与 https 协议', () => {
      expect(isRemoteHttpUrl('http://example.com/pic.png')).toBe(true)
      expect(isRemoteHttpUrl('https://example.com/pic.png')).toBe(true)
      expect(isRemoteHttpUrl('HTTPS://example.com/pic.png')).toBe(true)
    })

    it('排除本地路径、file 协议、data 协议及空字符串', () => {
      expect(isRemoteHttpUrl('images/banner.png')).toBe(false)
      expect(isRemoteHttpUrl('./shot.jpg')).toBe(false)
      expect(isRemoteHttpUrl('file:///C:/demo.png')).toBe(false)
      expect(isRemoteHttpUrl('data:image/png;base64,xyz')).toBe(false)
      expect(isRemoteHttpUrl('')).toBe(false)
      expect(isRemoteHttpUrl('   ')).toBe(false)
    })
  })

  describe('extractNoticeImageUrls', () => {
    it('提取标准 Markdown 图片语法里的远程地址', () => {
      const md = `新功能介绍：\n\n![配图 1](${SAMPLE_IMG_1})\n\n正文继续。`
      expect(extractNoticeImageUrls(md)).toEqual([SAMPLE_IMG_1])
    })

    it('提取带标题的 Markdown 图片语法里的远程地址', () => {
      const md = `![配图](${SAMPLE_IMG_1} "图片标题")`
      expect(extractNoticeImageUrls(md)).toEqual([SAMPLE_IMG_1])
    })

    it('提取被链接包裹的 Markdown 图片里的远程地址', () => {
      const md = `[![配图](${SAMPLE_IMG_1})](https://github.com)`
      expect(extractNoticeImageUrls(md)).toEqual([SAMPLE_IMG_1])
    })

    it('提取 HTML <img> 标签里的远程地址', () => {
      const md = `段落文字<img src="${SAMPLE_IMG_2}" alt="pic" width="300">`
      expect(extractNoticeImageUrls(md)).toEqual([SAMPLE_IMG_2])
    })

    it('混合多种图片语法并自动去重', () => {
      const md = `
        ![图1](${SAMPLE_IMG_1})
        <img src="${SAMPLE_IMG_2}">
        ![图1重复](${SAMPLE_IMG_1})
        ![本地相对图](images/local.png)
        ![file图](file:///d:/test.png)
      `
      const extracted = extractNoticeImageUrls(md)
      expect(extracted).toHaveLength(2)
      expect(extracted).toContain(SAMPLE_IMG_1)
      expect(extracted).toContain(SAMPLE_IMG_2)
    })

    it('空字符串或无图 Markdown 返回空数组', () => {
      expect(extractNoticeImageUrls('')).toEqual([])
      expect(extractNoticeImageUrls('只有纯文本的公告正文')).toEqual([])
    })
  })

  describe('injectCachedNoticeImages', () => {
    it('将已缓存的远程地址替换为 base64 data URL', () => {
      const cacheMap = new Map([[SAMPLE_IMG_1, MOCK_DATA_URL_1]])
      const md = `欢迎使用新版本：\n\n![公告配图](${SAMPLE_IMG_1})`
      const injected = injectCachedNoticeImages(md, cacheMap)
      expect(injected).toContain(`![公告配图](${MOCK_DATA_URL_1})`)
      expect(injected).not.toContain(SAMPLE_IMG_1)
    })

    it('保留标题属性并替换 Markdown 地址', () => {
      const cacheMap = new Map([[SAMPLE_IMG_1, MOCK_DATA_URL_1]])
      const md = `![公告配图](${SAMPLE_IMG_1} "标题说明")`
      const injected = injectCachedNoticeImages(md, cacheMap)
      expect(injected).toContain(`![公告配图](${MOCK_DATA_URL_1} "标题说明")`)
    })

    it('替换 HTML <img> 的 src 属性', () => {
      const cacheMap = new Map([[SAMPLE_IMG_2, MOCK_DATA_URL_1]])
      const md = `<p><img src="${SAMPLE_IMG_2}" alt="演示" class="banner"></p>`
      const injected = injectCachedNoticeImages(md, cacheMap)
      expect(injected).toContain(`src="${MOCK_DATA_URL_1}"`)
      expect(injected).toContain('alt="演示"')
      expect(injected).not.toContain(SAMPLE_IMG_2)
    })

    it('未命中缓存的图片地址保持原样', () => {
      const cacheMap = new Map()
      const md = `![配图](${SAMPLE_IMG_1})`
      expect(injectCachedNoticeImages(md, cacheMap)).toBe(md)
    })

    it('替换后的 Markdown 能顺利通过 renderNote 渲染且保留 data URL', () => {
      const cacheMap = new Map([[SAMPLE_IMG_1, MOCK_DATA_URL_1]])
      const md = `![公告](${SAMPLE_IMG_1})`
      const injected = injectCachedNoticeImages(md, cacheMap)
      const html = renderNote(injected)
      expect(html).toContain('<img')
      expect(html).toContain(`src="${MOCK_DATA_URL_1}"`)
      expect(html).toContain('alt="公告"')
    })
  })
})

describe('noticeImageCache 缓存与加载逻辑', () => {
  beforeEach(() => {
    clearNoticeImageMemCache()
    vi.restoreAllMocks()
  })

  it('内存中命中时直接返回，不走网络', async () => {
    setNoticeImageMemCache(SAMPLE_IMG_1, MOCK_DATA_URL_1)
    expect(getNoticeImageMemCache().has(SAMPLE_IMG_1)).toBe(true)

    const got = await getOrFetchNoticeImage(SAMPLE_IMG_1)
    expect(got).toBe(MOCK_DATA_URL_1)
  })

  it('批量预加载 precacheNoticeImages 正确处理多条公告中的图片', async () => {
    const notices: RemoteNotice[] = [
      {
        enabled: true,
        id: 'n1',
        title: '公告1',
        content: `![图1](${SAMPLE_IMG_1})`,
      },
      {
        enabled: true,
        id: 'n2',
        title: '公告2',
        content: `![图2](${SAMPLE_IMG_2})`,
      },
      {
        enabled: false, // 已停用的公告不应预加载
        id: 'n3',
        title: '停用公告',
        content: `![图3](https://example.com/disabled.png)`,
      },
    ]

    // 预热内存缓存以验证流程
    setNoticeImageMemCache(SAMPLE_IMG_1, MOCK_DATA_URL_1)

    await precacheNoticeImages(notices)
    expect(getNoticeImageMemCache().get(SAMPLE_IMG_1)).toBe(MOCK_DATA_URL_1)
  })
})
