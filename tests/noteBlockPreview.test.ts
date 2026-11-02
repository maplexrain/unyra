import { describe, it, expect } from 'vitest'
import { splitMarkdownBlocks, joinMarkdownBlocks } from '../src/components/learn/note/NoteBlockPreview'

describe('NoteBlockPreview block splitting and joining', () => {
  it('correctly round-trips markdown text without modifications', () => {
    const md = `# Title\n\nParagraph 1 with **bold** text.\n\n- item 1\n- item 2\n\n\`\`\`ts\nconst x = 1\n\`\`\`\n`
    const { blocks, trailing } = splitMarkdownBlocks(md)
    expect(blocks.length).toBeGreaterThan(0)
    const result = joinMarkdownBlocks(blocks, trailing)
    expect(result).toBe(md)
  })

  it('handles empty or whitespace strings', () => {
    const { blocks: b1, trailing: t1 } = splitMarkdownBlocks('')
    expect(b1).toEqual([])
    expect(t1).toBe('')
    expect(joinMarkdownBlocks(b1, t1)).toBe('')

    const { blocks: b2, trailing: t2 } = splitMarkdownBlocks('   \n\n  ')
    expect(b2).toEqual([])
    expect(joinMarkdownBlocks(b2, t2)).toBe('')
  })

  it('allows editing a single block without corrupting other blocks', () => {
    const md = `# Title\n\nFirst paragraph\n\nSecond paragraph\n`
    const { blocks, trailing } = splitMarkdownBlocks(md)
    expect(blocks.length).toBe(3)

    // Edit the second block (First paragraph)
    const nextBlocks = [...blocks]
    nextBlocks[1] = {
      ...nextBlocks[1],
      raw: 'Updated paragraph with *italic*',
    }

    const updated = joinMarkdownBlocks(nextBlocks, trailing)
    expect(updated).toBe(`# Title\n\nUpdated paragraph with *italic*\n\nSecond paragraph\n`)
  })

  it('handles deleting a block cleanly', () => {
    const md = `# Title\n\nTo be deleted\n\nRemaining\n`
    const { blocks, trailing } = splitMarkdownBlocks(md)
    expect(blocks.length).toBe(3)

    const nextBlocks = [blocks[0], blocks[2]]
    const updated = joinMarkdownBlocks(nextBlocks, trailing)
    expect(updated).toBe(`# Title\n\nRemaining\n`)
  })
})
