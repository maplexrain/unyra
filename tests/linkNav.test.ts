/**
 * 外链判定（见 electron/link-core）。
 *
 * 钉的是那条用户看得见的边界：**外链一律在系统浏览器里打开，绝不在应用内打开**。
 * 它同时是条安全边界：file:、data:、blob: 这些不该被网页导航带走。
 */
import { describe, expect, it } from 'vitest'

import { canOpenExternal, linkAction } from '../electron/link-core'

const APP = 'file:///C:/app/dist/index.html'
const DEV = 'http://localhost:5173/'

describe('应用自己走', () => {
  it('刷新：地址没变（打包的 file:// 与 dev 的 http:// 都算）', () => {
    expect(linkAction(APP, APP)).toBe('allow')
    expect(linkAction(DEV, DEV)).toBe('allow')
    expect(linkAction(DEV, 'http://localhost:5173/index.html?x=1')).toBe('allow')
  })

  it('页内锚点', () => {
    expect(linkAction(APP, '#section')).toBe('allow')
  })
})

describe('交给系统浏览器', () => {
  it('http/https/mailto', () => {
    expect(linkAction(APP, 'https://example.com/a')).toBe('open')
    expect(linkAction(DEV, 'http://example.com/a')).toBe('open')
    expect(linkAction(APP, 'mailto:a@b.c')).toBe('open')
  })

  it('相对地址按当前页补全后再判（补出别的源就是外链）', () => {
    expect(linkAction('https://e.com/x/y', '/a')).toBe('allow')
    expect(linkAction('https://e.com/x/y', '//other.com/a')).toBe('open')
  })
})

describe('拦掉', () => {
  it('别的 file:（打包运行时不能顺着链接读本机文件）', () => {
    expect(linkAction(APP, 'file:///C:/Windows/win.ini')).toBe('block')
  })

  it('data: / blob: / javascript: / 自定义协议 / 空地址', () => {
    expect(linkAction(APP, 'data:text/html,<b>x</b>')).toBe('block')
    expect(linkAction(APP, 'blob:https://e.com/abc')).toBe('block')
    expect(linkAction(APP, 'javascript:void(0)')).toBe('block')
    expect(linkAction(APP, 'llm-proxy://api.deepseek.com/x')).toBe('block')
    expect(linkAction(APP, '')).toBe('block')
    expect(linkAction(APP, '   ')).toBe('block')
  })
})

describe('交给系统浏览器之前再过一道', () => {
  it('只有 http/https/mailto 会被递出去', () => {
    expect(canOpenExternal('https://example.com')).toBe(true)
    expect(canOpenExternal('mailto:a@b.c')).toBe(true)
    expect(canOpenExternal('file:///C:/x.txt')).toBe(false)
    expect(canOpenExternal('javascript:alert(1)')).toBe(false)
    expect(canOpenExternal('随便写的')).toBe(false)
  })
})
