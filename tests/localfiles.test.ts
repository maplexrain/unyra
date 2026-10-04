/**
 * 本地文件列表的单元用例。
 *
 * 钉的是「哪些文件收、收进来之后列表怎么动」。列表是**最近打开**而不是收藏夹，
 * 所以顺序与去重是它唯一的语义；一个只收文本文件的白名单则决定了拖进来的东西
 * 会不会变成一堆乱码。
 */
import { describe, expect, it } from 'vitest'

import type { LocalFile } from '../src/learn/types'
import {
  addLocalFile,
  isSupportedLocalFile,
  LOCAL_FILE_LIMIT,
  removeLocalFile,
  sortLocalFiles,
} from '../src/learn/localfiles'

const file = (path: string, openedAt: number): LocalFile => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  openedAt,
})

describe('收哪些文件', () => {
  it('txt / markdown / html 收，大小写不敏感', () => {
    for (const name of ['a.txt', 'a.md', 'a.markdown', 'a.html', 'a.htm', 'A.MD']) {
      expect(isSupportedLocalFile(name)).toBe(true)
    }
  })

  it('来者不拒：图片、pdf 也能拖进来（媒体开预览页签，其余按文本尝试，见 viewOf）', () => {
    for (const name of ['a.png', 'a.pdf', 'a.docx', 'a', 'a.md.bak', 'a.md']) {
      expect(isSupportedLocalFile(name)).toBe(true)
    }
  })
})

describe('列表的顺序与去重', () => {
  it('新打开的排在最前面', () => {
    const list = addLocalFile(addLocalFile([], 'C:/a.md', 1), 'C:/b.txt', 2)
    expect(list.map((f) => f.path)).toEqual(['C:/b.txt', 'C:/a.md'])
  })

  it('already在列表里的：挪到最前并刷新时间，而不是出现两条', () => {
    const first = addLocalFile([], 'C:/a.md', 1)
    const second = addLocalFile([...first, ...addLocalFile([], 'C:/b.txt', 2)], 'C:/a.md', 3)
    expect(second).toHaveLength(2)
    expect(second[0].path).toBe('C:/a.md')
    expect(second[0].openedAt).toBe(3)
  })

  it('名字从路径里取（两种分隔符都认）', () => {
    expect(addLocalFile([], 'C:\\Users\\me\\笔记.md', 1)[0].name).toBe('笔记.md')
    expect(addLocalFile([], 'C:/Users/me/笔记.md', 1)[0].name).toBe('笔记.md')
  })

  it('超过上限时丢掉最久没打开的', () => {
    let list: LocalFile[] = []
    for (let i = 0; i < LOCAL_FILE_LIMIT + 5; i++) list = addLocalFile(list, 'C:/f' + i + '.md', i)
    expect(list).toHaveLength(LOCAL_FILE_LIMIT)
    expect(list[0].path).toBe('C:/f' + (LOCAL_FILE_LIMIT + 4) + '.md')
    expect(list.some((f) => f.path === 'C:/f0.md')).toBe(false)
  })

  it('移除只动列表，不碰磁盘（路径是身份）', () => {
    const list = [file('C:/a.md', 2), file('C:/b.md', 1)]
    expect(removeLocalFile(list, 'C:/a.md').map((f) => f.path)).toEqual(['C:/b.md'])
    expect(removeLocalFile(list, 'C:/没有这个.md')).toHaveLength(2)
  })

  it('排序按最近打开倒序（存盘读回来时用它兜底）', () => {
    const sorted = sortLocalFiles([file('C:/a.md', 1), file('C:/b.md', 9), file('C:/c.md', 5)])
    expect(sorted.map((f) => f.path)).toEqual(['C:/b.md', 'C:/c.md', 'C:/a.md'])
  })
})
