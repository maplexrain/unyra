// @vitest-environment happy-dom
/**
 * 就地图片（lib/docImages + markdown 解析期标记）的用例。
 *
 * 生产的两条硬约束钉在这里：① 解析期对相对/file 引用**不发 src**（浏览器自己发的
 * 那次请求就是控制台 ERR_FILE_NOT_FOUND 的来源），只标 data-moji-local-src；
 * ② 水合按文档目录读字节贴回 src，读不到换成一枚灰字（不加边框与底色）。
 */
import { describe, expect, it } from 'vitest'
import {
  fileUrlToPath,
  hydrateDocImages,
  isLocalPendingImageSrc,
  isRelativeImageSrc,
  joinUnderDir,
  pathInside,
} from '../src/lib/docImages'
import { renderNote, renderNoteGfm } from '../src/lib/markdown'

describe('isRelativeImageSrc / isLocalPendingImageSrc：哪些 src 是「文档旁边的图片」', () => {
  it('相对写法认（相对+file: 要水合），协议写法不认', () => {
    for (const src of ['hero.png', 'shots/a.png', './a.png', '../b.png', 'a b.png']) {
      expect(isRelativeImageSrc(src), src).toBe(true)
      expect(isLocalPendingImageSrc(src), src).toBe(true)
    }
    for (const src of [
      'https://example.com/x.png',
      'http://example.com/x.png',
      'data:image/png;base64,AAA',
      'blob:abc',
      'moji:static/abc123',
      '/abs.png',
      '//cdn.example.com/x.png',
      '#anchor',
      '',
    ]) {
      expect(isRelativeImageSrc(src), src).toBe(false)
      expect(isLocalPendingImageSrc(src), src).toBe(false)
    }
    // file: 不是相对路径，但要水合（CSP 不放行它，只能读字节贴 data URL）
    expect(isRelativeImageSrc('file:///C:/x.png')).toBe(false)
    expect(isLocalPendingImageSrc('file:///C:/x.png')).toBe(true)
  })
})

describe('joinUnderDir：按文档目录解析，基准第一段就是顶', () => {
  it('同目录、子目录、点号写法都归一成 posix rel', () => {
    expect(joinUnderDir('docs/微积分/极限.notes', 'hero.png')).toBe('docs/微积分/极限.notes/hero.png')
    expect(joinUnderDir('docs/微积分', './shots/a.png')).toBe('docs/微积分/shots/a.png')
    expect(joinUnderDir('docs/微积分', '../logo.png')).toBe('docs/logo.png')
  })

  it('爬出基准（数据树之外）回 null', () => {
    expect(joinUnderDir('docs/微积分', '../../../x.png')).toBeNull()
    expect(joinUnderDir('docs', '../x.png')).toBeNull()
  })
})

describe('fileUrlToPath / pathInside：file:/// 引用的边界', () => {
  it('只收盘符路径，%20 解回空格', () => {
    expect(fileUrlToPath('file:///C:/Users/me/hero.png')).toBe('C:/Users/me/hero.png')
    expect(fileUrlToPath('file:///C:/a%20b.png')).toBe('C:/a b.png')
    expect(fileUrlToPath('file://server/share/x.png')).toBeNull()
    expect(fileUrlToPath('https://example.com/x.png')).toBeNull()
  })

  it('pathInside 认子目录、不认前缀巧合，比较不分大小写', () => {
    expect(pathInside('C:/root', 'C:/root/users/a.png')).toBe(true)
    expect(pathInside('C:/root', 'C:/root/a.png')).toBe(true)
    expect(pathInside('C:/root', 'C:/rootx/a.png')).toBe(false)
    expect(pathInside('C:/Root', 'c:/root/users/a.png')).toBe(true)
  })
})

describe('解析期标记（renderNote / renderNoteGfm）：相对引用不发 src', () => {
  it('相对引用只带 data-moji-local-src，没有 src', () => {
    for (const render of [renderNote, renderNoteGfm]) {
      const html = render('![产品图](assets/logo.png)')
      expect(html).toContain('data-moji-local-src="assets/logo.png"')
      expect(html).toContain('alt="产品图"')
      // data-moji-local-src 自己带着 -src= 子串：断言的是「没有真的发 src 属性」
      expect(html).not.toMatch(/\ssrc=/)
    }
  })

  it('https 引用照常发 src（各走各的通道）', () => {
    expect(renderNote('![远](https://example.com/x.png)')).toContain('src="https://example.com/x.png"')
  })
})

describe('hydrateDocImages：把就地引用读字节贴回 src', () => {
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('标记好的引用贴上 data URL；读不到的换成一枚灰字（无边框无底色）；协议写法不碰', async () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<img data-moji-local-src="assets/logo.png" alt="标志">' +
      '<img data-moji-local-src="missing.png" alt="不在的图">' +
      '<img src="https://example.com/x.png">' +
      '<img src="data:image/png;base64,AAA">'
    const calls: string[] = []
    const undo = hydrateDocImages(root, async (src) => {
      calls.push(src)
      return src === 'assets/logo.png' ? 'data:image/png;base64,BBB' : null
    })
    await tick()
    expect(calls).toEqual(['assets/logo.png', 'missing.png'])
    // 读不到的那张被换成了灰字，所以只剩三张 img
    const imgs = Array.from(root.querySelectorAll('img'))
    expect(imgs).toHaveLength(3)
    expect(imgs[0]!.getAttribute('src')).toBe('data:image/png;base64,BBB')
    expect(imgs[0]!.getAttribute('data-moji-local-state')).toBe('done')
    expect(root.querySelector('span.moji-local-img-missing')?.textContent).toBe('不在的图')
    // https 与 data 本来就能渲染（CSP 已放行），水合不碰它们
    expect(imgs[1]!.getAttribute('src')).toBe('https://example.com/x.png')
    expect(imgs[2]!.getAttribute('src')).toBe('data:image/png;base64,AAA')
    undo()
  })

  it('手写的原始 src 在水合开始时就被摘掉（浏览器不再自己发 404 请求）', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<img src="hero.png" alt="hero">'
    hydrateDocImages(root, async () => 'data:image/png;base64,AAA')
    // 同步阶段：src 已经没了，原文记在 data 属性里等结果
    const img = root.querySelector('img')!
    expect(img.hasAttribute('src')).toBe(false)
    expect(img.getAttribute('data-moji-local-src')).toBe('hero.png')
    await tick()
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAA')
  })

  it('同一份 src 只解析一次；重跑水合不动已完成的，接着 pending 的再来', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<img src="hero.png"><img src="hero.png"><img src="shots/hero.png">'
    let calls = 0
    // 持有对象而不是裸 let：TS 会把「只在闭包里赋值」的 let 收窄成 never
    const gate: { release: ((v: string | null) => void) | null } = { release: null }
    const resolver = async (): Promise<string | null> => {
      calls++
      if (calls === 1) return 'data:image/png;base64,AAA'
      return new Promise<string | null>((r) => {
        gate.release = r
      })
    }
    const undo = hydrateDocImages(root, resolver)
    await tick()
    expect(calls).toBe(2) // hero.png 一次（两处共享）、shots/hero.png 一次（还在等）
    // 重跑：done 的两张不再解析；pending 的那张在新一轮里接着等（不会悬死）——那是第 3 次调用
    const again = hydrateDocImages(root, resolver)
    await tick()
    expect(calls).toBe(3)
    gate.release?.(null)
    await tick()
    const imgs = Array.from(root.querySelectorAll('img'))
    expect(imgs[0]!.getAttribute('data-moji-local-state')).toBe('done')
    expect(imgs[1]!.getAttribute('data-moji-local-state')).toBe('done')
    expect(imgs[2]).toBeUndefined() // 读不到：换成了灰字
    expect(root.querySelector('span.moji-local-img-missing')).not.toBeNull()
    again()
    undo()
  })
})

describe('resolver 的边界（不联网、不碰磁盘就能判定的那些）', () => {
  it('没有文档目录、或解析结果爬出数据树：直接回 null', async () => {
    const { createNodeDocImageResolver } = await import('../src/lib/docImages')
    const noDir = createNodeDocImageResolver({ dirRel: () => null })
    expect(await noDir('hero.png')).toBeNull()
    // 解析结果不带 docs/ 前缀（爬出了数据树）——这一判定发生在任何 IO 之前
    const outside = createNodeDocImageResolver({ dirRel: () => 'notes/随便' })
    expect(await outside('../../x.png')).toBeNull()
  })
})
