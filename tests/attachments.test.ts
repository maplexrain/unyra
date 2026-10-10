/**
 * 文件附件的单元用例。
 *
 * 这里最要命的是 fileBlock 的**定界符**：附件正文里本来就可能有 \`\`\` 代码块，
 * 围栏比它短就会提前关掉，后面所有内容跑到围栏外面去——模型看到的是一段
 * 与正文混在一起的残片，而界面上一点异常都看不出来。
 * 另外「二进制只报名字」「截断了要说清楚」这两条也都是给模型看的信息，错了不会报错。
 */
import { describe, expect, it } from 'vitest'

import type { MessageFile } from '../src/agent/types'
import { ATTACH_MAX_CHARS, MAX_FILES, attachHead, fileBlock, isTextName } from '../src/learn/attachments'
import { transferPendingFiles } from '../src/learn/agent/transfer'
import { updateNode } from '../src/learn/graph/nodes'
import { normalizeLearnStore } from '../src/learn/store/normalize'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { LearnStore } from '../src/learn/types'

const file = (extra: Partial<MessageFile> = {}): MessageFile => ({
  name: 'a.ts',
  bytes: 120,
  uuid: 'u1',
  rel: 'docs/g/static/u1.ts',
  chars: 40,
  ...extra,
})

describe('附件怎么进上下文', () => {
  it('文本附件带围栏与语言提示，正文原样在里面', () => {
    const texts = new Map([['u1', 'const a = 1']])
    const block = fileBlock([file()], texts)
    expect(block).toContain('【附件 1：a.ts · 共 40 字 · 路径：docs/g/static/u1.ts】')
    expect(block).toContain('\n```ts\nconst a = 1\n```')
  })

  it('正文里有代码块时，围栏比最长的那一串反引号还长', () => {
    const inner = '说明\n```js\nlet x = 1\n```\n结束'
    const block = fileBlock([file()], new Map([['u1', inner]]))
    // 外层围栏是四个反引号：与正文里那组三个不同，不会被提前关掉
    expect(block).toContain('````ts')
    expect(block).toContain(inner)
  })

  it('读不到正文时只留一行说明（资源被删了也不该让整轮请求变形）', () => {
    const block = fileBlock([file()], new Map())
    expect(block).toBe('【附件 1：a.ts · 共 40 字 · 路径：docs/g/static/u1.ts】')
  })

  it('二进制附件只说名字与体积，且不带正文', () => {
    const block = fileBlock([file({ uuid: undefined, rel: undefined, chars: undefined, binary: true, bytes: 2048 })], new Map())
    expect(block).toBe('【附件 1：a.ts · 2 KB，二进制文件，没有文本内容】')
  })

  it('截断过的附件在说明里写清楚「只附上了开头一部分」', () => {
    expect(attachHead(file({ truncated: true }))).toContain('只附上了开头一部分')
  })

  it('多个附件各自成段并包含数量序号', () => {
    const block = fileBlock(
      [file(), file({ name: 'b.csv', uuid: 'u2', rel: 'docs/g/static/u2.csv' })],
      new Map([
        ['u1', 'one'],
        ['u2', 'two'],
      ]),
    )
    expect(block).toContain('【附件 1（共 2 份）：a.ts')
    expect(block).toContain('【附件 2（共 2 份）：b.csv')
    expect(block).toContain('one')
    expect(block).toContain('two')
    expect(block.indexOf('a.ts')).toBeLessThan(block.indexOf('b.csv'))
  })
})

describe('哪些文件按文本处理', () => {
  it('常见的文本类扩展名', () => {
    expect(isTextName('a.ts')).toBe(true)
    expect(isTextName('notes.md')).toBe(true)
    expect(isTextName('data.csv')).toBe(true)
    expect(isTextName('a.json')).toBe(true)
  })

  it('图片与二进制扩展名不算文本（它们另有出路）', () => {
    expect(isTextName('shot.png')).toBe(false)
    expect(isTextName('app.exe')).toBe(false)
  })

  it('上限是常量，界面与这里说的是同一个数', () => {
    expect(ATTACH_MAX_CHARS).toBe(60_000)
    expect(MAX_FILES).toBe(6)
  })
})

describe('transferPendingFiles 附件转存与目录解析', () => {
  it('当目标在 store 中时，文本附件正常转存并生成带 uuid 和 rel 的 MessageFile', async () => {
    const origWindow = (globalThis as unknown as { window?: unknown }).window
    ;(globalThis as unknown as { window: unknown }).window = {
      mojiNative: {
        storage: {
          write: async () => ({ ok: true }),
          info: async () => ({ root: '', defaultRoot: '', isDefault: true }),
        },
      },
    }
    const { setUserScope } = await import('../src/lib/storage')
    setUserScope('u1')

    try {
      let store: LearnStore = {
        ...emptyLearnStore(),
        nodes: [
          {
            id: 'n1',
            title: '微积分',
            key: '微积分',
            description: '',
            docs: { teaching: '' },
            notes: [],
            annotations: [],
            status: 'learning',
            origin: 'user',
            goalId: 'g1',
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        goals: [{ id: 'g1', rootNodeId: 'n1', question: '微积分', createdAt: 0, updatedAt: 0 }],
        edges: [],
        conversations: [],
        activeGoalId: 'g1',
        activeNodeId: 'n1',
        activeConversationId: null,
      }
      const res = await transferPendingFiles(
        () => store,
        (next) => {
          store = next
        },
        'g1',
        [{ id: 'p1', name: 'guide.md', text: '# 指南', bytes: 100 }],
      )
      expect(res.error).toBeUndefined()
      expect(res.files.length).toBe(1)
      expect(res.files[0].name).toBe('guide.md')
      expect(res.files[0].uuid).toBeDefined()
      expect(res.files[0].rel).toContain('docs/微积分/static/')
      // store 中的 resources 也有了这条记录
      expect(store.resources?.['g1']?.length).toBe(1)
    } finally {
      setUserScope(null)
      ;(globalThis as unknown as { window?: unknown }).window = origWindow
    }
  })

  it('当目标不在 store 中时，因找不到目标目录而转存失败', async () => {
    let store: LearnStore = {
      ...emptyLearnStore(),
    }
    const res = await transferPendingFiles(
      () => store,
      (next) => {
        store = next
      },
      'g1',
      [{ id: 'p1', name: 'guide.md', text: '# 指南', bytes: 100 }],
    )
    expect(res.error).toContain('找不到这个目标的目录')
    expect(res.files.length).toBe(0)
  })

  it('transferPendingFiles 自动跳过图片附件，不将其错误当做无内容的二进制文件', async () => {
    let store: LearnStore = {
      ...emptyLearnStore(),
    }
    const fakeImageFile = new File(['fake-bytes'], 'test.png', { type: 'image/png' })
    const res = await transferPendingFiles(
      () => store,
      (next) => {
        store = next
      },
      'g1',
      [{ id: 'p_img', name: 'test.png', bytes: 1000, image: fakeImageFile }],
    )
    expect(res.files.length).toBe(0)
  })
})

describe('附件与图片在目标改名/重载时的持久化与自愈', () => {
  it('updateNode 修改根节点标题时，自动将会话中图片与附件的 rel 自愈为新目标目录', () => {
    const rootNode = {
      id: 'root-1',
      title: '如何学习微积分',
      key: '如何学习微积分',
      description: '',
      docs: { teaching: '' },
      notes: [],
      annotations: [],
      status: 'learning' as const,
      origin: 'user' as const,
      goalId: 'g1',
      createdAt: 1000,
      updatedAt: 1000,
    }
    const goal = {
      id: 'g1',
      rootNodeId: 'root-1',
      question: '如何学习微积分',
      createdAt: 1000,
      updatedAt: 1000,
    }
    const initialStore: LearnStore = {
      ...emptyLearnStore(),
      nodes: [rootNode],
      goals: [goal],
      edges: [],
      conversations: [
        {
          id: 'c1',
          goalId: 'g1',
          createdAt: 1000,
          updatedAt: 1000,
          messages: [
            {
              id: 'm1',
              role: 'user',
              parts: [{ type: 'text', text: '你好' }],
              images: [
                {
                  id: 'img1',
                  rel: 'docs/如何学习微积分/static/img-uuid.png',
                  name: '截图.png',
                  mime: 'image/png',
                  bytes: 1000,
                },
              ],
              files: [
                {
                  name: 'notes.txt',
                  bytes: 50,
                  uuid: 'f1',
                  rel: 'docs/如何学习微积分/static/notes.txt',
                  chars: 20,
                  path: 'D:/source/notes.txt',
                },
              ],
              ts: 1000,
            },
            {
              id: 'm2',
              role: 'assistant',
              parts: [
                {
                  type: 'tool',
                  id: 'call1',
                  name: 'read',
                  args: '{}',
                  result: '',
                  ok: true,
                  status: 'done',
                  images: [
                    {
                      id: 'img2',
                      rel: 'docs/如何学习微积分/static/tool-img.png',
                      name: 'tool.png',
                      mime: 'image/png',
                      bytes: 2000,
                    },
                  ],
                },
              ],
              ts: 1001,
            },
          ],
        },
      ],
      activeGoalId: 'g1',
      activeNodeId: 'root-1',
      activeConversationId: 'c1',
    }

    const nextStore = updateNode(initialStore, 'root-1', { title: '微积分核心概念' })
    const msg = nextStore.conversations[0].messages[0]
    expect(msg.images?.[0].rel).toBe('docs/微积分核心概念/static/img-uuid.png')
    expect(msg.files?.[0].rel).toBe('docs/微积分核心概念/static/notes.txt')
    expect(msg.files?.[0].path).toBe('D:/source/notes.txt')

    const toolMsg = nextStore.conversations[0].messages[1]
    const toolPart = toolMsg.parts[0]
    if (toolPart.type === 'tool') {
      expect(toolPart.images?.[0].rel).toBe('docs/微积分核心概念/static/tool-img.png')
    }
  })

  it('normalizeLearnStore 反序列化时自动保留 file.path 并自愈旧路径', () => {
    const raw = {
      version: 2,
      nodes: [
        {
          id: 'root-1',
          title: '量子力学',
          goalId: 'g2',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      goals: [
        {
          id: 'g2',
          rootNodeId: 'root-1',
          question: '量子力学入门',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      edges: [],
      conversations: [
        {
          id: 'c2',
          goalId: 'g2',
          messages: [
            {
              id: 'm1',
              role: 'user',
              parts: [{ type: 'text', text: '问题' }],
              images: [
                {
                  id: 'img1',
                  rel: 'docs/量子力学入门/static/diagram.png',
                  name: '图.png',
                },
              ],
              files: [
                {
                  name: 'sample.pdf',
                  bytes: 4096,
                  binary: true,
                  path: 'C:/Users/test/Desktop/sample.pdf',
                },
              ],
              ts: 1000,
            },
          ],
        },
      ],
    }

    const normalized = normalizeLearnStore(raw)
    expect(normalized).not.toBeNull()
    const msg = normalized!.conversations[0].messages[0]
    // 根节点标题是「量子力学」，旧路径「docs/量子力学入门/static/...」被自愈为「docs/量子力学/static/...」
    expect(msg.images?.[0].rel).toBe('docs/量子力学/static/diagram.png')
    // file.path 必须被保留
    expect(msg.files?.[0].path).toBe('C:/Users/test/Desktop/sample.pdf')
  })
})
