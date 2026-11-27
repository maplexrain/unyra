// @vitest-environment happy-dom
/**
 * 源码编辑器底部状态栏的“格式化”入口：可按后缀格式化的可写文件才出现。
 * 真正的 Prettier 转换在 tests/formatSource.test.ts 里验，这里只验 UI 入口。
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SourceEditor from '../src/components/learn/SourceEditor'

function renderEditor(props: { ext?: string; readOnly?: boolean; label?: string }): string {
  return renderToStaticMarkup(
    <SourceEditor
      value="export default {}"
      onChange={() => {}}
      state="saved"
      label={props.label ?? 'doc-design/example.tsx'}
      ext={props.ext}
      readOnly={props.readOnly}
    />,
  )
}

describe('SourceEditor 格式化入口', () => {
  it('可写 .tsx 文件显示格式化按钮', () => {
    const html = renderEditor({ ext: '.tsx' })
    expect(html).toContain('格式化源码')
    expect(html).toContain('>格式化<')
  })

  it('只读文件不显示格式化按钮', () => {
    const html = renderEditor({ ext: '.tsx', readOnly: true })
    expect(html).not.toContain('格式化源码')
  })

  it('未知文本后缀不显示按钮', () => {
    const html = renderEditor({ ext: '.txt' })
    expect(html).not.toContain('格式化源码')
  })
})
