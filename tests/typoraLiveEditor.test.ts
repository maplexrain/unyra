// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
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

  it('generates line decorations for headings, hr, and lists', () => {
    const text = `# Title 1\n## Subtitle 2\n### Heading 3\n---\n- List item\n1. Numbered item`
    const view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [markdown({ base: markdownLanguage }), typoraLinePlugin],
      }),
    })

    const decos = view.plugin(typoraLinePlugin)?.decorations
    expect(decos).toBeDefined()
    const classes: string[] = []
    const iter = decos!.iter()
    while (iter.value) {
      classes.push(iter.value.spec.class)
      iter.next()
    }

    expect(classes).toContain('cm-typora-h1')
    expect(classes).toContain('cm-typora-h2')
    expect(classes).toContain('cm-typora-h3')
    expect(classes).toContain('cm-typora-hr')
    expect(classes.filter((c) => c.includes('cm-typora-list-item')).length).toBe(2)
  })

  it('hides markdown source and renders bullets/tasks/hr in delimiter plugin when inactive', () => {
    const text = `## H2\n---\n- Bullet\n- [ ] Todo\n- [x] Done\n1. Number`
    const view = new EditorView({
      state: EditorState.create({
        doc: text,
        // Place selection in the middle of 'Bullet' text (pos 15), outside any mark
        selection: { anchor: 15 },
        extensions: [
          markdown({ base: markdownLanguage }),
          typoraLinePlugin,
          typoraDelimiterPlugin,
        ],
      }),
    })

    const decos = view.plugin(typoraDelimiterPlugin)?.decorations
    expect(decos).toBeDefined()
    const markClasses: string[] = []
    const iter = decos!.iter()
    while (iter.value) {
      markClasses.push(iter.value.spec.class)
      iter.next()
    }

    // HR should hide --- when cursor is not on that line
    expect(markClasses).toContain('cm-typora-hr-text-hidden')
    // Bullet should render as cm-typora-bullet
    expect(markClasses).toContain('cm-typora-bullet')
    // Tasks should render as unchecked and checked
    expect(markClasses).toContain('cm-typora-task-unchecked')
    expect(markClasses).toContain('cm-typora-task-checked')
    // Ordered list mark should have ordered mark styling
    expect(markClasses).toContain('cm-typora-ordered-mark')
  })

  it('reveals markdown source when cursor touches delimiter or line', () => {
    const text = `## H2\n---\n- Bullet`
    // Cursor on line 2 (---)
    const viewHr = new EditorView({
      state: EditorState.create({
        doc: text,
        selection: { anchor: 7 }, // inside '---'
        extensions: [markdown({ base: markdownLanguage }), typoraDelimiterPlugin],
      }),
    })
    const hrDecos = viewHr.plugin(typoraDelimiterPlugin)?.decorations
    const hrClasses: string[] = []
    const iterHr = hrDecos!.iter()
    while (iterHr.value) {
      hrClasses.push(iterHr.value.spec.class)
      iterHr.next()
    }
    expect(hrClasses).toContain('cm-typora-hr-text-active')

    // Cursor touching bullet mark '-' on line 3 (pos 10)
    const viewBullet = new EditorView({
      state: EditorState.create({
        doc: text,
        selection: { anchor: 10 }, // at the '-' of '- Bullet'
        extensions: [markdown({ base: markdownLanguage }), typoraDelimiterPlugin],
      }),
    })
    const bulletDecos = viewBullet.plugin(typoraDelimiterPlugin)?.decorations
    const bulletClasses: string[] = []
    const iterB = bulletDecos!.iter()
    while (iterB.value) {
      bulletClasses.push(iterB.value.spec.class)
      iterB.next()
    }
    expect(bulletClasses).toContain('cm-typora-mark-active')
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
