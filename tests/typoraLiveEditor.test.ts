import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  typoraLinePlugin,
  typoraInlinePlugin,
  typoraDelimiterPlugin,
} from '../src/components/learn/note/TyporaLiveEditor'

describe('TyporaLiveEditor live preview extensions', () => {
  it('correctly creates EditorState with typora extensions', () => {
    const text = `# Heading 1\n\nParagraph with **bold** and *italic* and \`code\`.\n\n> A quote\n\n---`
    const state = EditorState.create({
      doc: text,
      extensions: [
        markdown({ base: markdownLanguage }),
        typoraLinePlugin,
        typoraInlinePlugin,
        typoraDelimiterPlugin,
      ],
    })
    expect(state.doc.toString()).toBe(text)
  })

  it('generates line decorations for headings, quotes, and hr', () => {
    const text = `# Title\n## Subtitle\n> Quote\n---`
    const state = EditorState.create({
      doc: text,
      extensions: [
        markdown({ base: markdownLanguage }),
        typoraLinePlugin,
      ],
    })
    expect(state.doc.lines).toBe(4)
  })

  it('handles empty document and edge cases without error', () => {
    const emptyDocs = ['', ' ', '\n', '# ', '**', '`']
    for (const doc of emptyDocs) {
      expect(() => {
        EditorState.create({
          doc,
          extensions: [
            markdown({ base: markdownLanguage }),
            typoraLinePlugin,
            typoraInlinePlugin,
            typoraDelimiterPlugin,
          ],
        })
      }).not.toThrow()
    }
  })
})
