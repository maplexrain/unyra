// @vitest-environment happy-dom
/**
 * 就地图片（lib/docImages）的用例：文档目录旁的相对路径图片在生产环境能显示出来的
 * 那条水合通道。生产页面以 file:// 加载、CSP 的 img-src 'self' 对 file: 来源什么也不
 * 匹配——本地图片必须读字节贴成 data URL，这一层的就是「哪些 src 该水合、相对路径
 * 解析到哪、水合做什么」的边界。
 */
import { describe, expect, it } from 'vitest'
import {
  fileUrlToPath,
  hydrateDocImages,
  isRelativeImageSrc,
  joinUnderDir,
  pathInside,
} from '../src/lib/docImages'

describe('isRelativeImageSrc：哪些 src 是「文档旁边的相对路径」', () => {
  it('相对写法认，协议写法不认', () => {
    for (const src of ['hero.png', 'shots/a.png', './a.png', '../b.png', 'a b.png']) {
      expect(isRelativeImageSrc(src), src).toBe(true)
    }
    for (const src of [
      'https://example.com/x.png',
      'http://example.com/x.png',
      'data:image/png;base64,AAA',
      'blob:abc',
      'file:///C:/x.png',
      'moji:static/abc123',
      '/abs.png',
      '//cdn.example.com/x.png',
      '#anchor',
      '',
    ]) {
      expect(isRelativeImageSrc(src), src).toBe(false)
    }
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

describe('hydrateDocImages：DOM 提交后把就地引用贴成 data URL', () => {
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('相对路径贴上图；读不到的钉上 missing 类；协议写法一概不碰', async () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<img src="hero.png"><img src="missing.png"><img src="https://example.com/x.png"><img src="data:image/png;base64,AAA">'
    const calls: string[] = []
    const undo = hydrateDocImages(root, async (src) => {
      calls.push(src)
      return src === 'hero.png' ? 'data:image/png;base64,BBB' : null
    })
    await tick()
    expect(calls).toEqual(['hero.png', 'missing.png'])
    const [hero, missing, remote, data] = Array.from(root.querySelectorAll('img'))
    expect(hero!.getAttribute('src')).toBe('data:image/png;base64,BBB')
    expect(missing!.classList.contains('moji-local-img-missing')).toBe(true)
    // https 与 data 本来就能渲染（CSP 已放行），水合不碰它们
    expect(remote!.getAttribute('src')).toBe('https://example.com/x.png')
    expect(data!.getAttribute('src')).toBe('data:image/png;base64,AAA')
    undo()
  })

  it('同一份 src 只解析一次；重跑水合（resolver 换身份 / 正文重建）不重复读', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<img src="hero.png"><img src="hero.png"><img src="shots/hero.png">'
    let calls = 0
    const resolver = async (): Promise<string | null> => {
      calls++
      return 'data:image/png;base64,AAA'
    }
    const undo = hydrateDocImages(root, resolver)
    await tick()
    expect(calls).toBe(2) // hero.png 一次（两处共享）、shots/hero.png 一次
    const again = hydrateDocImages(root, resolver)
    await tick()
    expect(calls).toBe(2)
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
