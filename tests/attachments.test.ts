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
    expect(block).toContain('【附件：a.ts（共 40 字）】')
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
    expect(block).toBe('【附件：a.ts（共 40 字）】')
  })

  it('二进制附件只说名字与体积，且不带正文', () => {
    const block = fileBlock([file({ uuid: undefined, rel: undefined, chars: undefined, binary: true, bytes: 2048 })], new Map())
    expect(block).toBe('【附件：a.ts（2 KB，二进制文件，没有文本内容）】')
  })

  it('截断过的附件在说明里写清楚「只附上了开头一部分」', () => {
    expect(attachHead(file({ truncated: true }))).toContain('只附上了开头一部分')
  })

  it('多个附件各自成段', () => {
    const block = fileBlock(
      [file(), file({ name: 'b.csv', uuid: 'u2' })],
      new Map([
        ['u1', 'one'],
        ['u2', 'two'],
      ]),
    )
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
