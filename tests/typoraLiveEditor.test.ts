// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  typoraLinePlugin,
  typoraInlinePlugin,
  typoraDelimiterPlugin,
  BulletWidget,
  TaskWidget,
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

  it('renders bullets, task widgets, and hr in delimiter plugin when inactive', () => {
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
    const widgets: any[] = []
    const iter = decos!.iter()
    while (iter.value) {
      if (iter.value.spec.class) {
        markClasses.push(iter.value.spec.class)
      }
      if (iter.value.spec.widget) {
        widgets.push(iter.value.spec.widget)
      }
      iter.next()
    }

    // HR hides --- when cursor is not on that line
    expect(markClasses).toContain('cm-typora-hr-text-hidden')
    // Ordered list mark styled
    expect(markClasses).toContain('cm-typora-ordered-mark')

    // Bullet should render as native BulletWidget
    const bulletWidget = widgets.find((w) => w instanceof BulletWidget)
    expect(bulletWidget).toBeDefined()
    const bulletDom = bulletWidget!.toDOM(view)
    expect(bulletDom.className).toContain('cm-typora-bullet')
    expect(bulletDom.textContent).toBe('•')

    // Task widgets should render unchecked and checked
    const uncheckedTask = widgets.find((w) => w instanceof TaskWidget && !w.checked)
    expect(uncheckedTask).toBeDefined()
    const uncheckedDom = uncheckedTask!.toDOM(view)
    expect(uncheckedDom.className).toContain('cm-typora-task-unchecked')

    const checkedTask = widgets.find((w) => w instanceof TaskWidget && w.checked)
    expect(checkedTask).toBeDefined()
    const checkedDom = checkedTask!.toDOM(view)
    expect(checkedDom.className).toContain('cm-typora-task-checked')
    expect(checkedDom.textContent).toBe('✓')
  })

  it('clicking task widget toggles checked state', () => {
    const text = `- [ ] Task item`
    let docChanged = ''
    const view = new EditorView({
      state: EditorState.create({
        doc: text,
        selection: { anchor: 10 },
        extensions: [
          markdown({ base: markdownLanguage }),
          typoraDelimiterPlugin,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) docChanged = u.state.doc.toString()
          }),
        ],
      }),
    })

    const decos = view.plugin(typoraDelimiterPlugin)?.decorations
    const iter = decos!.iter()
    let taskWidget: TaskWidget | null = null
    while (iter.value) {
      if (iter.value.spec.widget instanceof TaskWidget) {
        taskWidget = iter.value.spec.widget
        break
      }
      iter.next()
    }

    expect(taskWidget).toBeDefined()
    const dom = taskWidget!.toDOM(view)
    // Dispatch mousedown event
    const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    dom.dispatchEvent(evt)

    expect(docChanged).toBe('- [x] Task item')
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
      if (iterHr.value.spec.class) hrClasses.push(iterHr.value.spec.class)
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
      if (iterB.value.spec.class) bulletClasses.push(iterB.value.spec.class)
      iterB.next()
    }
    expect(bulletClasses).toContain('cm-typora-mark-active')

    // Cursor in heading body (pos 4, 'H2') keeps header mark hidden so line does not shift
    const viewHeaderBody = new EditorView({
      state: EditorState.create({
        doc: text,
        selection: { anchor: 4 }, // inside 'H2'
        extensions: [markdown({ base: markdownLanguage }), typoraDelimiterPlugin],
      }),
    })
    const headBodyDecos = viewHeaderBody.plugin(typoraDelimiterPlugin)?.decorations
    const headBodyClasses: string[] = []
    const iterHB = headBodyDecos!.iter()
    while (iterHB.value) {
      if (iterHB.value.spec.class) headBodyClasses.push(iterHB.value.spec.class)
      iterHB.next()
    }
    expect(headBodyClasses).not.toContain('cm-typora-mark-active')

    // Cursor at start of heading (pos 0, touching '## ') reveals header mark
    const viewHeaderMark = new EditorView({
      state: EditorState.create({
        doc: text,
        selection: { anchor: 0 },
        extensions: [markdown({ base: markdownLanguage }), typoraDelimiterPlugin],
      }),
    })
    const headMarkDecos = viewHeaderMark.plugin(typoraDelimiterPlugin)?.decorations
    const headMarkClasses: string[] = []
    const iterHM = headMarkDecos!.iter()
    while (iterHM.value) {
      if (iterHM.value.spec.class) headMarkClasses.push(iterHM.value.spec.class)
      iterHM.next()
    }
    expect(headMarkClasses).toContain('cm-typora-mark-active')
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
