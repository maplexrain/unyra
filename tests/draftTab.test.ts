/**
 * 新建文件页签（draft）的单元用例。
 *
 * 钉的是三件事，它们错了都不会报错，只会让用户觉得「哪里不对」：
 *
 * 1. **身份**：`d:` 前缀的独立命名空间。混进 `b:` 就会跟「一个栏只有一枚新页签」
 *    那条规矩撞上——用户开了两份没保存的草稿，第二份把第一份顶掉了，而那是他正在写的东西。
 * 2. **没有类型**：标题是「未命名」、没有后缀、视图永远进编辑、不能预览、不能收藏、
 *    拖不出引用。它保存之后才由后缀定下类型（见 useDocSaveFlow 的 draft 分支）。
 * 3. **保存那一刻的换身**：draft → local，暂存撤掉、进本地文件清单。这一段是纯函数的
 *    组合（renameTabRef + dropDraft + addLocalFile），在这里钉住它的形状。
 */
import { describe, expect, it } from 'vitest'

import type { LearnTab, TabRef } from '../src/learn/types'
import {
  DRAFT_DEFAULT_EXT,
  draftFileName,
  isBlankTab,
  isDocumentTab,
  makeDraftTab,
  newDraftKey,
  tabIdNodeId,
  tabKey,
  tabNodeId,
  tabTitle,
  tabTrail,
  viewOf,
} from '../src/learn/tabs'
import { FIRST_GROUP, emptyDocs, openInGroup, renameTabRef } from '../src/learn/groups'
import { dropDraft, draftOf, putDraft, stageDraft } from '../src/learn/drafts'
import { addLocalFile } from '../src/learn/localfiles'

const noTitle = (): undefined => undefined

describe('新建文件页签：身份', () => {
  it('makeDraftTab 生成合法的草稿页签，身份以 d: 开头且每次不同', () => {
    const a = makeDraftTab()
    const b = makeDraftTab()
    expect(a.ref.kind).toBe('draft')
    expect(a.id.startsWith('d:')).toBe(true)
    expect(a.id).not.toBe(b.id)
  })

  it('不挂任何节点，也没有「住在哪儿」可言', () => {
    const tab = makeDraftTab()
    expect(tabNodeId(tab.ref)).toBeNull()
    expect(tabIdNodeId(tab.id)).toBeNull()
    expect(tabTrail(tab.ref, () => '不该被调用')).toBe('')
  })

  it('标题是「未命名」——它还没有文件名', () => {
    expect(tabTitle(makeDraftTab().ref, noTitle)).toBe('未命名')
  })

  it('算文档：它装着用户正在写的东西，「关闭非文档」不该把它一起收掉', () => {
    expect(isDocumentTab({ kind: 'draft', key: 'k' })).toBe(true)
  })

  it('不是「新页签」——一个栏只能有一枚新页签，草稿不受这条限制', () => {
    expect(isBlankTab(makeDraftTab())).toBe(false)
    expect(isBlankTab({ id: 'b:1', ref: { kind: 'blank', key: '1' }, createdAt: 1 })).toBe(true)
  })

  it('可以同时开好几枚：身份各是各的', () => {
    const refs: TabRef[] = [
      { kind: 'draft', key: newDraftKey() },
      { kind: 'draft', key: newDraftKey() },
      { kind: 'draft', key: newDraftKey() },
    ]
    expect(new Set(refs.map(tabKey)).size).toBe(3)
  })
})

describe('新建文件页签：还没有类型', () => {
  it('永远进编辑视图，且没有可预览的东西', () => {
    const tab = makeDraftTab()
    expect(viewOf(tab)).toBe('source')
    // 用户手动选过视图也听他的（但界面上不会给他预览按钮，见 panes 的 previewable）
    expect(viewOf({ ...tab, view: 'preview' })).toBe('preview')
  })

  it('保存对话框的默认文件名是 未命名.txt', () => {
    expect(DRAFT_DEFAULT_EXT).toBe('.txt')
    expect(draftFileName()).toBe('未命名.txt')
    // 后缀由调用方给（另存对话框的 filters 换档时用得上）
    expect(draftFileName('.md')).toBe('未命名.md')
  })
})

describe('新建文件页签：暂存的基准是空文档', () => {
  it('一个字都没写过时没有暂存条目——页签上不该有那颗圆点', () => {
    const id = makeDraftTab().id
    expect(draftOf({}, id)).toBeUndefined()
  })

  it('写了就有；又改回空串时那一条自己消失（等于「又回到没写过」）', () => {
    const id = makeDraftTab().id
    let drafts = stageDraft({}, id, '写了两行', '')
    expect(draftOf(drafts, id)).toBe('写了两行')
    drafts = stageDraft(drafts, id, '', '')
    expect(draftOf(drafts, id)).toBeUndefined()
  })

  it('保存成功之后暂存被撤掉：内容已经在文件里了', () => {
    const id = makeDraftTab().id
    const drafts = putDraft({}, id, '正文')
    expect(draftOf(dropDraft(drafts, id), id)).toBeUndefined()
  })
})

describe('新建文件页签：保存那一刻换身（draft → local）', () => {
  it('页签换成指向那个文件的本地文件页签，位置与创建时间不动', () => {
    const draftRef: TabRef = { kind: 'draft', key: 'k1' }
    let docs = openInGroup(emptyDocs(), FIRST_GROUP, draftRef, 42)
    const before = docs.groups[0].tabs[0]
    expect(before.ref.kind).toBe('draft')
    expect(before.createdAt).toBe(42)

    const localRef: TabRef = { kind: 'local', path: '/tmp/我的笔记.md' }
    docs = renameTabRef(docs, draftRef, localRef)

    const after = docs.groups[0].tabs[0]
    expect(after.id).toBe(tabKey(localRef))
    expect(after.ref.kind).toBe('local')
    expect(after.createdAt, '换的是身份，不是这一枚页签的历史').toBe(42)
    expect(docs.groups[0].active, '激活态跟着一起搬').toBe(tabKey(localRef))
    expect(docs.groups[0].tabs).toHaveLength(1)
  })

  it('后缀决定它是什么类型：md 进预览、txt 进编辑', () => {
    const md: LearnTab = { id: 'l:/a/笔记.md', ref: { kind: 'local', path: '/a/笔记.md' }, createdAt: 1 }
    const txt: LearnTab = { id: 'l:/a/随手记.txt', ref: { kind: 'local', path: '/a/随手记.txt' }, createdAt: 1 }
    expect(viewOf(md)).toBe('preview')
    expect(viewOf(txt)).toBe('source')
  })

  it('新建的文件进「本地文件」清单，之后还能从那儿再打开它', () => {
    const list = addLocalFile([], '/tmp/我的笔记.md', 100)
    expect(list).toEqual([{ path: '/tmp/我的笔记.md', name: '我的笔记.md', openedAt: 100 }])
    // 已经在清单里就把它挪到最前（最近打开）
    const again = addLocalFile(list, '/tmp/随手记.txt', 200)
    expect(again.map((f) => f.name)).toEqual(['随手记.txt', '我的笔记.md'])
  })
})
