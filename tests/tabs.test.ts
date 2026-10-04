/**
 * 自由页签的单元用例。
 *
 * 钉的是「页签的身份、开关之后剩下什么、默认用哪种视图」这三件事。
 * 它们错了界面不会报错：右键「关闭右侧文件」把左边那个也关掉、或者点开一个 txt
 * 却进了预览视图（一片空白），用户只会觉得「这软件怪怪的」，说不出哪里错了。
 */
import { describe, expect, it } from 'vitest'

import type { LearnTab, TabRef } from '../src/learn/types'
import {
  closeTabs,
  closeTabsByIds,
  dragSlotDelta,
  extOf,
  fileNameOf,
  isPreviewable,
  openTab,
  reorderTabs,
  replaceTabRef,
  stepTab,
  tabIdNodeId,
  tabIndex,
  tabKey,
  tabNodeId,
  tabTitle,
  tabTrail,
  tabIdsOfNode,
  viewOf,
} from '../src/learn/tabs'

/** 造一个页签（时间戳固定，用例不依赖当前时间） */
const tab = (ref: TabRef, extra: Partial<LearnTab> = {}): LearnTab => ({
  id: tabKey(ref),
  ref,
  createdAt: 1700000000000,
  ...extra,
})

const teach = (nodeId: string): TabRef => ({ kind: 'teach', nodeId })
const note = (nodeId: string, name: string): TabRef => ({ kind: 'note', nodeId, note: name })
const local = (path: string): TabRef => ({ kind: 'local', path })

describe('页签的身份', () => {
  it('三种来源各有一个前缀，互不撞车', () => {
    // 前缀把三个命名空间分开：节点 id 与磁盘路径都不可能偶然变成对方
    expect(tabKey(teach('n1'))).toBe('t:n1')
    expect(tabKey(note('n1', '错题本'))).toBe('n:n1:错题本')
    expect(tabKey(local('C:/a/b.md'))).toBe('l:C:/a/b.md')
  })

  it('同一个东西再打开一次不会多出一个页签', () => {
    const list = openTab(openTab([], teach('n1'), 1), teach('n1'), 2)
    expect(list).toHaveLength(1)
    // 顺序也不能变：页签的位置是用户认路的一部分
    expect(list[0].createdAt).toBe(1)
  })

  it('页签挂在哪个节点上：本地文件不属于任何节点', () => {
    expect(tabNodeId(teach('n1'))).toBe('n1')
    expect(tabNodeId(note('n1', '笔记'))).toBe('n1')
    expect(tabNodeId(local('C:/a/b.md'))).toBeNull()
  })

  it('从 id 反解节点：与 tabKey 是一对（暂存区读回来时按它校验）', () => {
    expect(tabIdNodeId('t:n1')).toBe('n1')
    // 笔记名里可能有冒号：只切第一个，剩下的原样是名字
    expect(tabIdNodeId('n:n1:错题本:二')).toBe('n1')
    expect(tabIdNodeId('l:C:/a/b.md')).toBeNull()
    expect(tabIdNodeId('t:')).toBe('')
  })

  it('路径后缀：节点类给节点路径，本地文件给所在目录，试卷副本不给', () => {
    const path = (id: string) => '极限/' + id
    expect(tabTrail(teach('夹逼定理'), path)).toBe('极限/夹逼定理')
    expect(tabTrail(note('夹逼定理', '错题本'), path)).toBe('极限/夹逼定理')
    // 正反两种分隔符都认：本地文件的路径来自 Windows
    expect(tabTrail(local('C:\\a\\b\\notes.md'), path)).toBe('C:\\a\\b')
    expect(tabTrail(local('/home/me/notes.md'), path)).toBe('/home/me')
    // 文件名在盘根上：没有目录可说，给空串（上层据此不显示后缀）
    expect(tabTrail(local('notes.md'), path)).toBe('')
    // 试卷副本的名字里已经带着考试时间，再加路径只是噪声
    expect(tabTrail({ kind: 'exam', nodeId: 'n1', examId: 'e1', attemptId: 'a1' }, path)).toBe('')
  })
})

describe('默认视图', () => {
  it('教学文档与笔记都是 Markdown，默认看渲染结果', () => {
    expect(viewOf(tab(teach('n1')))).toBe('preview')
    expect(viewOf(tab(note('n1', '笔记')))).toBe('preview')
  })

  it('本地文件按扩展名：md 默认预览，媒体进媒体预览，其余文本一律编辑', () => {
    expect(viewOf(tab(local('C:/a/x.md')))).toBe('preview')
    expect(viewOf(tab(local('C:/a/x.markdown')))).toBe('preview')
    // 口径改了：除 markdown 外的文本（含 html）默认都是编辑模式
    expect(viewOf(tab(local('C:/a/x.HTML')))).toBe('source')
    // txt 没有渲染器：硬给一个「预览」只会是一片空白
    expect(viewOf(tab(local('C:/a/x.txt')))).toBe('source')
    // 图片 / 音频 / 视频：没有「源码」可言，直接进媒体预览
    expect(viewOf(tab(local('C:/a/x.png')))).toBe('media')
    expect(viewOf(tab(local('C:/a/x.mp4')))).toBe('media')
  })

  it('用户手动选过的视图优先，且只作用于那一个页签', () => {
    const a = tab(local('C:/a/x.md'), { view: 'source' })
    const b = tab(local('C:/a/y.md'))
    expect(viewOf(a)).toBe('source')
    expect(viewOf(b)).toBe('preview')
  })

  it('空的笔记默认落在源码（编辑）视图：预览是一片空白，打开它就是要往里写', () => {
    expect(viewOf(tab(note('n1', '笔记')), true)).toBe('source')
    // 教学文档不受影响：它空了多半是导师正要写，预览里的「待写」提示更有用
    expect(viewOf(tab(teach('n1')), false)).toBe('preview')
    // 用户自己点过视图就听他的（他刚在空笔记里点过预览，那是他的选择）
    expect(viewOf(tab(note('n1', '笔记'), { view: 'preview' }), true)).toBe('preview')
  })

  it('扩展名与可预览性', () => {
    expect(extOf('C:/a/x.MD')).toBe('.md')
    expect(extOf('C:/a/没有扩展名')).toBe('')
    // 点开头的文件（.gitignore）不算扩展名
    expect(extOf('C:/a/.gitignore')).toBe('')
    expect(isPreviewable('x.htm')).toBe(true)
    expect(isPreviewable('x.pdf')).toBe(false)
  })
})

describe('关闭页签', () => {
  const tabs = [tab(teach('a')), tab(teach('b')), tab(teach('c'))]
  const ids = tabs.map((t) => t.id)

  it('关掉当前这一个：往右找最近的一个', () => {
    const r = closeTabs(tabs, ids[1], 'self', ids[1])
    expect(r.tabs.map((t) => t.id)).toEqual([ids[0], ids[2]])
    expect(r.active).toBe(ids[2])
  })

  it('关掉最右边那一个：右边没有了就往左落', () => {
    const r = closeTabs(tabs, ids[2], 'self', ids[2])
    expect(r.active).toBe(ids[1])
  })

  it('关别人不该把我正在看的这个换掉', () => {
    const r = closeTabs(tabs, ids[0], 'self', ids[2])
    expect(r.active).toBe(ids[2])
  })

  it('关闭左侧 / 右侧 / 其他 / 全部', () => {
    expect(closeTabs(tabs, ids[2], 'left', ids[0]).tabs.map((t) => t.id)).toEqual([ids[2]])
    expect(closeTabs(tabs, ids[0], 'right', ids[2]).tabs.map((t) => t.id)).toEqual([ids[0]])
    expect(closeTabs(tabs, ids[1], 'others', ids[0]).tabs.map((t) => t.id)).toEqual([ids[1]])
    const all = closeTabs(tabs, ids[1], 'all', ids[1])
    expect(all.tabs).toEqual([])
    expect(all.active).toBeNull()
  })

  it('关闭右侧时，当前页签在右侧就跟着被关掉，落点不越界', () => {
    const r = closeTabs(tabs, ids[0], 'right', ids[2])
    expect(r.tabs.map((t) => t.id)).toEqual([ids[0]])
    expect(r.active).toBe(ids[0])
  })

  it('按 id 关掉一批（节点被删除）：指向它的页签全没了', () => {
    const mixed = [tab(teach('a')), tab(note('a', '笔记')), tab(teach('b')), tab(local('C:/x.md'))]
    expect(tabIdsOfNode(mixed, 'a')).toEqual([tabKey(teach('a')), tabKey(note('a', '笔记'))])
    const r = closeTabsByIds(mixed, tabIdsOfNode(mixed, 'a'), tabKey(teach('a')))
    expect(r.tabs.map((t) => t.id)).toEqual([tabKey(teach('b')), tabKey(local('C:/x.md'))])
    // 关掉的是当前那个：落到右边最近的一个（节点 b）
    expect(r.active).toBe(tabKey(teach('b')))
  })

  it('删节点不会动本地文件页签', () => {
    const mixed = [tab(local('C:/x.md')), tab(teach('a'))]
    const r = closeTabsByIds(mixed, tabIdsOfNode(mixed, 'a'), tabKey(local('C:/x.md')))
    expect(r.tabs.map((t) => t.id)).toEqual([tabKey(local('C:/x.md'))])
    expect(r.active).toBe(tabKey(local('C:/x.md')))
  })
})

describe('笔记改名要连页签一起改', () => {
  it('身份换成新名字，视图与创建时间留着', () => {
    const before = [tab(note('n1', '笔记'), { view: 'source' })]
    const after = replaceTabRef(before, note('n1', '笔记'), note('n1', '错题本'))
    expect(after[0].id).toBe(tabKey(note('n1', '错题本')))
    expect(after[0].view).toBe('source')
    expect(after[0].createdAt).toBe(before[0].createdAt)
  })

  it('没开过那份笔记时原样返回（不凭空造一个页签）', () => {
    const before = [tab(teach('n1'))]
    expect(replaceTabRef(before, note('n1', '笔记'), note('n1', '错题本'))).toBe(before)
  })
})

describe('页签标题', () => {
  it('教学文档用节点名（不再是「教学文档」四个字）', () => {
    const title = tabTitle(teach('n1'), (id) => (id === 'n1' ? '夹逼定理' : undefined))
    expect(title).toBe('夹逼定理')
  })

  it('节点已经不在时给一句能读懂的话', () => {
    expect(tabTitle(teach('没了'), () => undefined)).toBe('已删除的节点')
  })

  it('笔记用笔记名，本地文件用文件名', () => {
    expect(tabTitle(note('n1', '错题本'), () => '节点')).toBe('错题本')
    expect(tabTitle(local('C:/a/b/笔记.md'), () => undefined)).toBe('笔记.md')
    expect(fileNameOf('C:\\a\\b\\笔记.md')).toBe('笔记.md')
  })
})

describe('拖动排序与左右切换', () => {
  const three = () => [
    tab({ kind: 'teach', nodeId: 'a' }),
    tab({ kind: 'teach', nodeId: 'b' }),
    tab({ kind: 'teach', nodeId: 'c' }),
  ]

  it('按给定顺序重排，并且不认得、没提到的 id 都不会让页签消失', () => {
    const list = three()
    const [a, b, c] = list
    // 把 c 拖到最前
    expect(reorderTabs(list, [c.id, a.id, b.id]).map((t) => t.id)).toEqual([c.id, a.id, b.id])
    // 多出来的 id（刚被关掉的那个）忽略；没提到的按原顺序接在后面
    expect(reorderTabs(list, [c.id, 't:不存在']).map((t) => t.id)).toEqual([c.id, a.id, b.id])
    // 同一个 id 出现两次也只算一次
    expect(reorderTabs(list, [b.id, b.id, a.id]).map((t) => t.id)).toEqual([b.id, a.id, c.id])
    // 空列表：原样返回
    expect(reorderTabs(list, []).map((t) => t.id)).toEqual([a.id, b.id, c.id])
  })

  it('循环切换：到头绕回另一端', () => {
    const list = three()
    const [a, b, c] = list
    expect(stepTab(list, a.id, 1)).toBe(b.id)
    expect(stepTab(list, b.id, 1)).toBe(c.id)
    // 最后一个再往右 → 回到第一个（不卡住）
    expect(stepTab(list, c.id, 1)).toBe(a.id)
    expect(stepTab(list, a.id, -1)).toBe(c.id)
    expect(stepTab(list, b.id, -1)).toBe(a.id)
  })

  it('当前页签不在列表里、或一个页签都没有时也有确定的结果', () => {
    const list = three()
    expect(stepTab([], null, 1)).toBeNull()
    expect(stepTab(list, null, 1)).toBe(list[0].id)
    expect(stepTab(list, null, -1)).toBe(list[2].id)
    expect(stepTab(list, 't:没了', 1)).toBe(list[0].id)
    expect(stepTab(list, list[1].id, 0)).toBe(list[1].id)
  })

  it('序号用来判断切换方向；找不到给 -1', () => {
    const list = three()
    expect(tabIndex(list, list[2].id)).toBe(2)
    expect(tabIndex(list, null)).toBe(-1)
    expect(tabIndex(list, 't:没了')).toBe(-1)
  })

  /*
   * 落点位移：松手那一帧把「手指底下的位置」换算到新落点上用的那个数。
   * 它算错了不会报错，只是每次拖完页签都要横着抽一下——上一版就是这么抽的。
   */
  it('往左挪一格是负的一份「宽度 + 间距」，往右是正的', () => {
    const widths = [100, 100, 100, 100, 100]
    expect(dragSlotDelta(widths, 2, 1, 3)).toBe(-103)
    expect(dragSlotDelta(widths, 1, 2, 3)).toBe(103)
  })

  it('跨几格就算几格，页签宽度不一时各算各的', () => {
    // 拖的是第 3 个（宽 60），前面两个分别是 40 与 190
    const widths = [40, 190, 60, 190, 40]
    expect(dragSlotDelta(widths, 2, 0, 3)).toBe(-((40 + 3) + (190 + 3)))
    expect(dragSlotDelta(widths, 0, 3, 3)).toBe((190 + 3) + (60 + 3) + (190 + 3))
  })

  it('原地不动是 0', () => {
    expect(dragSlotDelta([100, 100, 100], 1, 1, 3)).toBe(0)
  })

  it('宽度数量对不上（拖动中别处关了一个页签）时只算间距，不抛异常', () => {
    expect(dragSlotDelta([100], 0, 2, 3)).toBe(6)
  })
})
