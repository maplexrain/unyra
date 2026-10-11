import { describe, expect, it } from 'vitest'
import { emptyDocs, type KnowledgeNode, type LearnStore } from '../src/learn/types'
import { makeTab, tabKey } from '../src/learn/tabs'
import { nodeById, updateDoc } from '../src/learn/graph/nodes'

function computeDocAreaSig(store: LearnStore) {
  const docs = store.docArea
  const groupParts = Object.values(docs.groups)
    .map((g) => `${g.id}:${g.active}:[${g.tabs.map((t) => `${t.id}:${tabKey(t.ref)}`).join(',')}]`)
    .join('|')
  const tabSig = `${docs.focus}::${groupParts}`

  const contentParts: string[] = []
  const allTabs = Object.values(docs.groups).flatMap((g) => g.tabs)
  for (const t of allTabs) {
    const ref = t.ref
    if (ref.kind === 'teach') {
      const node = nodeById(store, ref.nodeId)
      contentParts.push(`${t.id}:teach:${node?.docs?.teaching?.length ?? 0}:${node?.updatedAt ?? 0}`)
    } else if (ref.kind === 'note') {
      const node = nodeById(store, ref.nodeId)
      const n = node?.notes.find((item) => item.name === ref.note)
      contentParts.push(`${t.id}:note:${n?.content?.length ?? 0}:${n?.updatedAt ?? 0}`)
    }
  }
  return { tabSig, contentSig: contentParts.join(';') }
}

function shouldExpandSide(
  prevSig: { tabSig: string; contentSig: string } | null,
  currentSig: { tabSig: string; contentSig: string },
  agentLeft: boolean,
  sideCollapsed: boolean,
  pure: boolean,
): boolean {
  if (prevSig === null) return false
  const tabChanged = prevSig.tabSig !== currentSig.tabSig
  const contentChanged = prevSig.contentSig !== currentSig.contentSig
  return (tabChanged || contentChanged) && agentLeft && sideCollapsed && !pure
}

describe('文档区在右侧栏收起时的自动弹出机制', () => {
  const mockNode: KnowledgeNode = {
    id: 'n1',
    goalId: 'g1',
    key: 'n1',
    title: '知识点 1',
    description: '',
    docs: emptyDocs(),
    notes: [],
    annotations: [],
    origin: 'user',
    status: 'learning',
    createdAt: 1000,
    updatedAt: 1000,
  }

  const initialStore: LearnStore = {
    version: 2,
    nodes: [mockNode],
    edges: [],
    goals: [],
    conversations: [],
    exams: [],
    tmp: {},
    resources: {},
    activeGoalId: 'g1',
    activeNodeId: 'n1',
    activeConversationId: null,
    docArea: {
      layout: { kind: 'group', group: 'main' },
      groups: [
        {
          id: 'main',
          tabs: [makeTab({ kind: 'teach', nodeId: 'n1' }, 1000)],
          active: 't:n1',
        },
      ],
      focus: 'main',
    },
    drafts: {},
    docScroll: {},
    localFiles: [],
  }

  it('初始挂载记录快照，即使收起也不误弹', () => {
    const sig = computeDocAreaSig(initialStore)
    const should = shouldExpandSide(null, sig, true, true, false)
    expect(should).toBe(false)
  })

  it('文件未变动且页签未变动，保持收起不弹', () => {
    const sig = computeDocAreaSig(initialStore)
    const should = shouldExpandSide(sig, sig, true, true, false)
    expect(should).toBe(false)
  })

  it('文档区在右侧栏收起时，教学文档内容被导师改写，自动触发弹出', () => {
    const sig1 = computeDocAreaSig(initialStore)
    const nextStore = updateDoc(initialStore, 'n1', '# 新编写的教学内容')
    const sig2 = computeDocAreaSig(nextStore)

    expect(sig1.contentSig).not.toBe(sig2.contentSig)
    const should = shouldExpandSide(sig1, sig2, true, true, false)
    expect(should).toBe(true)
  })

  it('文档区在右侧栏收起时，打开新页签或切换页签，自动触发弹出', () => {
    const sig1 = computeDocAreaSig(initialStore)
    const nextStore: LearnStore = {
      ...initialStore,
      docArea: {
        ...initialStore.docArea,
        groups: [
          {
            id: 'main',
            tabs: [
              ...initialStore.docArea.groups[0].tabs,
              makeTab({ kind: 'note', nodeId: 'n1', note: '随堂笔记' }, 2000),
            ],
            active: 'n:n1:随堂笔记',
          },
        ],
      },
    }
    const sig2 = computeDocAreaSig(nextStore)

    expect(sig1.tabSig).not.toBe(sig2.tabSig)
    const should = shouldExpandSide(sig1, sig2, true, true, false)
    expect(should).toBe(true)
  })

  it('纯净阅读模式下有变动亦不打扰用户，保护全屏沉浸', () => {
    const sig1 = computeDocAreaSig(initialStore)
    const nextStore = updateDoc(initialStore, 'n1', '新正文')
    const sig2 = computeDocAreaSig(nextStore)

    const should = shouldExpandSide(sig1, sig2, true, true, true)
    expect(should).toBe(false)
  })

  it('文档区在左侧主位（!agentLeft）时，右侧为导师栏，不触发右侧栏由于文档变动的误展开', () => {
    const sig1 = computeDocAreaSig(initialStore)
    const nextStore = updateDoc(initialStore, 'n1', '新正文')
    const sig2 = computeDocAreaSig(nextStore)

    const should = shouldExpandSide(sig1, sig2, false, true, false)
    expect(should).toBe(false)
  })
})
