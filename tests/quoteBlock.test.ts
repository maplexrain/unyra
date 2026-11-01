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
  detectLanguageFromPath,
  DEFAULT_MARK_TEMPLATE,
  type QuoteBlockHost,
} from '../src/lib/quoteBlock'
import { lineRangeToOffsets } from '../src/lib/docReveal'
import { encodeAttr, escapeHtml, type PluginRenderContext } from '../src/lib/renderPlugins'
import type { HighlightToken } from '../src/syntax/SyntaxHighlighter'

const mockCtx: PluginRenderContext = {
  escape: escapeHtml,
  attr: encodeAttr,
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

    it('parses new mark(15:5, 16:7) syntax with default mark template', () => {
      const rule = parseMappingRule('mark(15:5, 16:7)')
      expect(rule).toEqual({
        startLine: 15,
        startCol: 5,
        endLine: 16,
        endCol: 7,
        template: DEFAULT_MARK_TEMPLATE,
      })
    })

    it('parses mark with hyphen delimiter mark(10:2 - 12:8)', () => {
      const rule = parseMappingRule('mark(10:2 - 12:8)')
      expect(rule).toEqual({
        startLine: 10,
        startCol: 2,
        endLine: 12,
        endCol: 8,
        template: DEFAULT_MARK_TEMPLATE,
      })
    })

    it('parses single line col range mark(15:5, 20)', () => {
      const rule = parseMappingRule('mark(15:5, 20)')
      expect(rule).toEqual({
        startLine: 15,
        startCol: 5,
        endLine: 15,
        endCol: 20,
        template: DEFAULT_MARK_TEMPLATE,
      })
    })

    it('parses single position mark(15:5)', () => {
      const rule = parseMappingRule('mark(15:5)')
      expect(rule).toEqual({
        startLine: 15,
        startCol: 5,
        endLine: 15,
        endCol: 5,
        template: DEFAULT_MARK_TEMPLATE,
      })
    })

    it('parses line range mark(15-20) and single line mark(15)', () => {
      const rRange = parseMappingRule('mark(15-20)')
      expect(rRange).toEqual({
        startLine: 15,
        startCol: 1,
        endLine: 20,
        endCol: 999999,
        template: DEFAULT_MARK_TEMPLATE,
      })

      const rSingle = parseMappingRule('mark(15)')
      expect(rSingle).toEqual({
        startLine: 15,
        startCol: 1,
        endLine: 15,
        endCol: 999999,
        template: DEFAULT_MARK_TEMPLATE,
      })
    })

    it('parses brackets without arrow [15:5, 16:7] as mark template', () => {
      const rule = parseMappingRule('[15:5, 16:7]')
      expect(rule).toEqual({
        startLine: 15,
        startCol: 5,
        endLine: 16,
        endCol: 7,
        template: DEFAULT_MARK_TEMPLATE,
      })
    })
  })

  describe('detectLanguageFromPath', () => {
    it('detects language from common file extensions', () => {
      expect(detectLanguageFromPath('demo.ts')).toBe('typescript')
      expect(detectLanguageFromPath('demo.js')).toBe('javascript')
      expect(detectLanguageFromPath('demo.tsx')).toBe('tsx')
      expect(detectLanguageFromPath('main.py')).toBe('python')
      expect(detectLanguageFromPath('index.html')).toBe('html')
      expect(detectLanguageFromPath('style.css')).toBe('css')
      expect(detectLanguageFromPath('lib.rs')).toBe('rust')
      expect(detectLanguageFromPath('Dockerfile')).toBe('docker')
      expect(detectLanguageFromPath('unknown.xyz123')).toBeNull()
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

    it('integrates syntax highlight tokens with mark rules without tag conflicts', () => {
      const line = 'const val = 123;'
      // Mock tokens from TextMate:
      // 'const' (0..5, keyword), ' ' (5..6, plain), 'val' (6..9, variable), ' = ' (9..12, operator), '123' (12..15, number), ';' (15..16, punctuation)
      const mockTokens: HighlightToken[] = [
        { text: 'const', scopes: ['keyword.control.js'], startIndex: 0 },
        { text: ' ', scopes: [], startIndex: 5 },
        { text: 'val', scopes: ['variable.other.readwrite.js'], startIndex: 6 },
        { text: ' = ', scopes: ['keyword.operator.assignment.js'], startIndex: 9 },
        { text: '123', scopes: ['constant.numeric.decimal.js'], startIndex: 12 },
        { text: ';', scopes: ['punctuation.terminator.statement.js'], startIndex: 15 },
      ]

      // Mark from col 7 to col 15 ('val = 123')
      const rule = parseMappingRule('mark(1:7, 15)')!
      const res = applyRulesToLine(line, 1, [rule], mockTokens)

      // Expected:
      // 'const' is outside mark with <span class="tok tok-keyword">const</span>
      // ' ' is outside mark
      // 'val = 123' is wrapped in <mark class="moji-quote-mark">
      // inside mark: <span class="tok tok-variable">val</span><span class="tok tok-operator"> = </span><span class="tok tok-number">123</span>
      // ';' is outside mark with <span class="tok tok-punctuation">;</span>
      expect(res).toContain('<span class="tok tok-keyword">const</span> ')
      expect(res).toContain('<mark class="moji-quote-mark"><span class="tok tok-variable">val</span><span class="tok tok-operator"> = </span><span class="tok tok-number">123</span></mark>')
      expect(res).toContain('<span class="tok tok-punctuation">;</span>')
    })
  })

  describe('quoteBlock synchronous rendering', () => {
    it('strictly outputs rounded-none and zero rounded-* classes', () => {
      const source = [
        '说明文字',
        '@E:/demo/index.html(10-34){',
        '  mark(15:5, 16:7)',
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

    it('has zero border and zero padding on quote block container', () => {
      const source = '@demo.ts(1-10)'
      const html = quoteBlock(source, mockCtx)
      expect(html).not.toContain('border-l-4')
      expect(html).not.toContain('border-l-seal')
      const blockClass = html.match(/class="([^"]*moji-quote-block[^"]*)"/)?.[1] ?? ''
      expect(blockClass).not.toContain('border')
      expect(blockClass).not.toContain('p-3')
      expect(html).toContain('overflow-hidden')
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
      expect(codeHtml).toContain('whitespace-pre-wrap')
      expect(codeHtml).toContain('break-words')

      // Test open file click
      const pathBtn = container.querySelector<HTMLButtonElement>('.moji-quote-path')
      pathBtn?.click()
      expect(mockHost.onOpenFile).toHaveBeenCalledWith('demo.ts', 3, 4)

      cleanup()
      document.body.removeChild(container)
    })

    it('correctly decodes percent-encoded file paths and rules via decodeAttr', async () => {
      const complexPath = 'C:/Users/maxwell/AppData/Roaming/unyra/users/test/docs/DeepSeek新手入门/workspace/demo/router.js'
      const sampleFile = [
        '// header',
        'export function route(table, path) {',
        '  if (!table[path]) throw new Error("404");',
        '  return table[path]();',
        '}',
      ].join('\n')

      const mockHost: QuoteBlockHost = {
        readFile: vi.fn().mockResolvedValue(sampleFile),
        onOpenFile: vi.fn(),
      }
      setQuoteBlockHost(mockHost)

      const container = document.createElement('div')
      // Render with mockCtx which uses encodeAttr (encodeURIComponent)
      container.innerHTML = quoteBlock(
        `@${complexPath}(2-4){\n  [3:3, 3:19] => <strong class="text-seal">{{content}}</strong>\n}`,
        mockCtx,
      )
      document.body.appendChild(container)

      const cleanup = hydrateQuotes(container)
      await vi.waitFor(() => {
        expect(container.querySelector('.moji-quote-code')).not.toBeNull()
      })

      // mockHost.readFile should receive the clean, decoded path, NOT percent-encoded
      expect(mockHost.readFile).toHaveBeenCalledWith(complexPath)

      const codeHtml = container.querySelector('.moji-quote-code')?.innerHTML
      expect(codeHtml).toContain('export function route')
      expect(codeHtml).toContain('<strong class="text-seal">if (!table[path])</strong>')

      // Path button tooltip and text should be unencoded
      const pathBtn = container.querySelector<HTMLButtonElement>('.moji-quote-path')
      expect(pathBtn?.title).toBe(complexPath)
      expect(pathBtn?.textContent).toBe(complexPath)

      pathBtn?.click()
      expect(mockHost.onOpenFile).toHaveBeenCalledWith(complexPath, 2, 4)

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

  describe('lineRangeToOffsets', () => {
    it('computes exact character ranges for lines', () => {
      const text = 'line 1\nline 2: hello\nline 3: world\nline 4'
      // line 1: 0..6
      expect(lineRangeToOffsets(text, 1, 1)).toEqual({ start: 0, end: 6 })
      // line 2: 7..20 ("line 2: hello")
      expect(lineRangeToOffsets(text, 2, 2)).toEqual({ start: 7, end: 20 })
      // line 2 to line 3: 7..34 ("line 2: hello\nline 3: world")
      const r23 = lineRangeToOffsets(text, 2, 3)
      expect(r23).toEqual({ start: 7, end: 34 })
      expect(text.slice(r23.start, r23.end)).toBe('line 2: hello\nline 3: world')
    })
  })
})
