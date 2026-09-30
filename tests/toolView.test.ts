/**
 * 工具气泡（execute）那点显示逻辑的单元用例。
 *
 * 钉三件事：流式参数里也抠得出正文、平铺的代码掰得开、结果里的"旁白"被摘成注释。
 * 这三条都是纯字符串变换，出了错界面上看着"差不多"，只有用例能钉住。
 */
import { describe, expect, it } from 'vitest'

import { executeArgs, formatJs, toolResultView } from '../src/lib/toolView'

describe('execute 参数', () => {
  it('收全了就直接解析', () => {
    const args = executeArgs(JSON.stringify({ description: '写文档', body: 'return 1' }))
    expect(args).toEqual({ description: '写文档', body: 'return 1' })
  })

  it('流式收了一半也抠得出 body（转义还原）', () => {
    const partial = '{"description":"写文档","body":"const a = 1\\nconst b = 2'
    const args = executeArgs(partial)
    expect(args.description).toBe('写文档')
    expect(args.body).toBe('const a = 1\nconst b = 2')
  })

  it('停在转义符上也不崩，已经到达的部分照常显示', () => {
    const args = executeArgs('{"body":"const s = \'a\\')
    expect(args.body).toContain('const s')
  })

  it('空参数给空结果', () => {
    expect(executeArgs('')).toEqual({ description: '', body: '' })
    expect(executeArgs('{')).toEqual({ description: '', body: '' })
  })
})

describe('代码排版', () => {
  it('本来就是多行的只做规范化：去行尾空白、去首尾空行、去掉共同缩进', () => {
    const src = '\n    const a = 1   \n    const b = 2\n\n'
    expect(formatJs(src)).toBe('const a = 1\nconst b = 2')
  })

  it('有模板字符串时不动缩进（那里的空白是内容）', () => {
    const src = '  const a = \u0060\n    x\n  \u0060'
    expect(formatJs(src)).toBe('  const a = \u0060\n    x\n  \u0060')
  })

  it('一行平铺的按括号与分号掰开、按层缩进', () => {
    const src = 'const a = 1; if (a) { b(); } else { c(); }'
    expect(formatJs(src)).toBe(
      ['const a = 1;', 'if (a) {', '  b();', '} else {', '  c();', '}'].join('\n'),
    )
  })

  it('字符串里的分号与括号不当结构', () => {
    const src = 'const s = "a;b{c}"; f(s);'
    expect(formatJs(src)).toBe('const s = "a;b{c}";\nf(s);')
  })

  it('正则里的分号不当结构', () => {
    const src = 'const re = /[;{}]/g; re.test(x);'
    expect(formatJs(src)).toBe('const re = /[;{}]/g;\nre.test(x);')
  })

  it('短的一行不掰（本来就一眼看得完）', () => {
    expect(formatJs('return 1')).toBe('return 1')
  })
})

describe('结果分段', () => {
  it('尾部的调用统计摘成注释，正文原样', () => {
    const view = toolResultView('{ "ok": true }\n\n本次调用：doc.write（共 1 次）')
    expect(view.body).toBe('{\n  "ok": true\n}')
    expect(view.lang).toBe('json')
    expect(view.tail).toBe('本次调用：doc.write（共 1 次）')
    expect(view.lead).toBe('')
  })

  it('头部的失败说明也是元信息', () => {
    const raw = '⛔ 本次有 1 次调用**没有生效**：\n  - doc.write：位置越界\n请改正后重试。\n\n已写入 1200 字\n\n本次调用：doc.write（共 1 次）'
    const view = toolResultView(raw)
    expect(view.lead).toContain('⛔')
    expect(view.body).toBe('已写入 1200 字')
    expect(view.lang).toBe('text')
    expect(view.tail).toBe('本次调用：doc.write（共 1 次）')
  })

  it('日志段也摘出来（与统计各占一段）', () => {
    const view = toolResultView('ok\n\n本次调用：a（共 1 次）\n\n日志：\n[x] 读了 3 个节点')
    expect(view.tail).toBe('本次调用：a（共 1 次）\n日志：\n[x] 读了 3 个节点')
    expect(view.body).toBe('ok')
  })

  it('正文里的空行不被吃掉', () => {
    const view = toolResultView('第一段\n\n\n第二段')
    expect(view.body).toBe('第一段\n\n\n第二段')
  })

  it('截断的 JSON 不硬按 JSON 染色', () => {
    const view = toolResultView('{ "ok": true, "long": "被截')
    expect(view.lang).toBe('text')
    expect(view.body).toBe('{ "ok": true, "long": "被截')
  })

  it('没有元信息时三段里只有正文', () => {
    const view = toolResultView('（这段代码没有 return 任何值）')
    expect(view).toMatchObject({ lead: '', tail: '', body: '（这段代码没有 return 任何值）' })
  })
})
