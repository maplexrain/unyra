// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseQuoteBlock,
  parseMappingRule,
  applyRulesToLine,
  renderQuotedLines,
  quoteBlock,
  hydrateQuotes,
  setQuoteBlockHost,
  type QuoteBlockHost,
} from '../src/lib/quoteBlock'
import type { PluginRenderContext } from '../src/lib/renderPlugins'

const mockCtx: PluginRenderContext = {
  escape: (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  attr: (s) => s.replace(/"/g, '&quot;'),
}

describe('quoteBlock', () => {
  beforeEach(() => {
    setQuoteBlockHost(null)
  })

  describe('parseMappingRule', () => {
    it('parses standard rule [15:5, 16:7] => <strong>{{content}}</strong>', () => {
      const rule = parseMappingRule('[15:5, 16:7] => <strong>{{content}}</strong>')
      expect(rule).toEqual({
        startLine: 15,
        startCol: 5,
        endLine: 16,
        endCol: 7,
        template: '<strong>{{content}}</strong>',
      })
    })

    it('handles single position rule [10:3] => <mark>{{content}}</mark>', () => {
      const rule = parseMappingRule('[10:3] => <mark>{{content}}</mark>')
      expect(rule).toEqual({
        startLine: 10,
        startCol: 3,
        endLine: 10,
        endCol: 3,
        template: '<mark>{{content}}</mark>',
      })
    })

    it('normalizes reversed coordinates [20:8, 15:2]', () => {
      const rule = parseMappingRule('[20:8, 15:2] => <em>{{content}}</em>')
      expect(rule).toEqual({
        startLine: 15,
        startCol: 2,
        endLine: 20,
        endCol: 8,
        template: '<em>{{content}}</em>',
      })
    })

    it('strips dangerous tags like <script> in template', () => {
      const rule = parseMappingRule('[1:1, 1:5] => <script>alert(1)</script><b>{{content}}</b>')
      expect(rule?.template).toBe('<b>{{content}}</b>')
    })

    it('replaces rounded classes with rounded-none', () => {
      const rule = parseMappingRule('[1:1, 1:5] => <span class="bg-seal rounded-lg">{{content}}</span>')
      expect(rule?.template).toContain('rounded-none')
      expect(rule?.template).not.toContain('rounded-lg')
    })
  })

  describe('parseQuoteBlock', () => {
    it('parses user prompt sample with plain text and @ reference', () => {
      const source = [
        '这是一段普通文本',
        '@E:/demo/index.html(10-34){',
        '  [15:5,16:7] => <strong>{{content}}</strong> ',
        '}',
        '以上代码片段来自xxx',
      ].join('\n')

      const parsed = parseQuoteBlock(source)
      expect(parsed.items.length).toBe(3)

      expect(parsed.items[0]).toEqual({
        type: 'text',
        text: '这是一段普通文本',
      })

      expect(parsed.items[1].type).toBe('ref')
      if (parsed.items[1].type === 'ref') {
        const ref = parsed.items[1].ref
        expect(ref.filePath).toBe('E:/demo/index.html')
        expect(ref.startLine).toBe(10)
        expect(ref.endLine).toBe(34)
        expect(ref.rules.length).toBe(1)
        expect(ref.rules[0]).toEqual({
          startLine: 15,
          startCol: 5,
          endLine: 16,
          endCol: 7,
          template: '<strong>{{content}}</strong>',
        })
      }

      expect(parsed.items[2]).toEqual({
        type: 'text',
        text: '以上代码片段来自xxx',
      })
    })

    it('parses single line reference with braces', () => {
      const source = '@src/app.ts(5-20){ [8:1, 8:10] => <em>{{content}}</em> }'
      const parsed = parseQuoteBlock(source)
      expect(parsed.items.length).toBe(1)
      expect(parsed.items[0].type).toBe('ref')
      if (parsed.items[0].type === 'ref') {
        expect(parsed.items[0].ref.filePath).toBe('src/app.ts')
        expect(parsed.items[0].ref.startLine).toBe(5)
        expect(parsed.items[0].ref.endLine).toBe(20)
        expect(parsed.items[0].ref.rules.length).toBe(1)
      }
    })

    it('parses reference without rules and various line range delimiters', () => {
      const p1 = parseQuoteBlock('@main.py(10~25)')
      expect(p1.items[0].type).toBe('ref')
      if (p1.items[0].type === 'ref') {
        expect(p1.items[0].ref.startLine).toBe(10)
        expect(p1.items[0].ref.endLine).toBe(25)
      }

      const p2 = parseQuoteBlock('@main.py(30至50)')
      if (p2.items[0].type === 'ref') {
        expect(p2.items[0].ref.startLine).toBe(30)
        expect(p2.items[0].ref.endLine).toBe(50)
      }

      const p3 = parseQuoteBlock('@main.py(42)')
      if (p3.items[0].type === 'ref') {
        expect(p3.items[0].ref.startLine).toBe(42)
        expect(p3.items[0].ref.endLine).toBe(42)
      }
    })
  })

  describe('applyRulesToLine and renderQuotedLines', () => {
    it('applies multi-line mapping [15:5, 16:7] across line 15 and line 16', () => {
      const fileLines = [
        'line 14',
        '    const count = 42;', // line 15 (index 1)
        '    console.log(count);', // line 16 (index 2)
        'line 17',
      ]
      const content = fileLines.join('\n')
      // line 15 is line index 2 (1-based is 2 in this small file, or if startLine is 15)
      const lines = renderQuotedLines(content, 2, 3, [
        {
          startLine: 2,
          startCol: 5,
          endLine: 3,
          endCol: 7,
          template: '<strong>{{content}}</strong>',
        },
      ])

      expect(lines.length).toBe(2)
      // Line 2 (corresponds to line 15 in user scenario):
      // chars 1-4: "    "
      // chars 5-21: "const count = 42;" wrapped in <strong>
      expect(lines[0].html).toBe('    <strong>const count = 42;</strong>')
      // Line 3 (corresponds to line 16 in user scenario):
      // chars 1-7: "    con" wrapped in <strong>
      // chars 8-23: "sole.log(count);" unmapped
      expect(lines[1].html).toBe('<strong>    con</strong>sole.log(count);')
    })

    it('applies multiple mappings on the same line', () => {
      const line = 'let alpha = beta + gamma;'
      // let (cols 1-3), beta (cols 13-16)
      const res = applyRulesToLine(line, 1, [
        { startLine: 1, startCol: 1, endLine: 1, endCol: 3, template: '<b>{{content}}</b>' },
        { startLine: 1, startCol: 13, endLine: 1, endCol: 16, template: '<em>{{content}}</em>' },
      ])
      expect(res).toBe('<b>let</b> alpha = <em>beta</em> + gamma;')
    })

    it('escapes unmapped HTML tags in source code', () => {
      const line = '<div>Hello & World</div>'
      const res = applyRulesToLine(line, 1, [])
      expect(res).toBe('&lt;div&gt;Hello &amp; World&lt;/div&gt;')
    })
  })

  describe('quoteBlock synchronous rendering', () => {
    it('strictly outputs rounded-none and zero rounded-* classes', () => {
      const source = [
        '说明文字',
        '@E:/demo/index.html(10-34){',
        '  [15:5,16:7] => <strong>{{content}}</strong>',
        '}',
      ].join('\n')

      const html = quoteBlock(source, mockCtx)
      expect(html).toContain('moji-quote-block')
      expect(html).toContain('rounded-none')

      // Check that no other rounded classes (e.g. rounded-md, rounded-xl, rounded-full) exist
      const roundedMatches = html.match(/\brounded(?:-[a-z0-9]+)?\b/g) ?? []
      for (const m of roundedMatches) {
        expect(m).toBe('rounded-none')
      }
    })
  })

  describe('hydrateQuotes', () => {
    it('loads file from host and renders code lines', async () => {
      const sampleFile = [
        'line 1',
        'line 2',
        'line 3: const x = 1;',
        'line 4: const y = 2;',
        'line 5',
      ].join('\n')

      const mockHost: QuoteBlockHost = {
        readFile: vi.fn().mockResolvedValue(sampleFile),
        onOpenFile: vi.fn(),
      }
      setQuoteBlockHost(mockHost)

      const container = document.createElement('div')
      container.innerHTML = quoteBlock(
        '@demo.ts(3-4){ [3:9, 3:17] => <strong>{{content}}</strong> }',
        mockCtx,
      )
      document.body.appendChild(container)

      const cleanup = hydrateQuotes(container)
      await vi.waitFor(() => {
        expect(container.querySelector('.moji-quote-code')).not.toBeNull()
      })

      expect(mockHost.readFile).toHaveBeenCalledWith('demo.ts')
      const codeHtml = container.querySelector('.moji-quote-code')?.innerHTML
      expect(codeHtml).toContain('<strong>const x =</strong>')
      expect(codeHtml).toContain('line 4:')

      // Test open file click
      const pathBtn = container.querySelector<HTMLButtonElement>('.moji-quote-path')
      pathBtn?.click()
      expect(mockHost.onOpenFile).toHaveBeenCalledWith('demo.ts', 3)

      cleanup()
      document.body.removeChild(container)
    })

    it('shows graceful fallback when file cannot be read', async () => {
      const mockHost: QuoteBlockHost = {
        readFile: vi.fn().mockResolvedValue(null),
      }
      setQuoteBlockHost(mockHost)

      const container = document.createElement('div')
      container.innerHTML = quoteBlock('@not-found.ts(1-10)', mockCtx)
      document.body.appendChild(container)

      const cleanup = hydrateQuotes(container)
      await vi.waitFor(() => {
        expect(container.textContent).toContain('无法读取引用的源文件')
      })

      cleanup()
      document.body.removeChild(container)
    })
  })
})
