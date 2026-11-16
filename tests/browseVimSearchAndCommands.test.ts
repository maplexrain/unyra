import { describe, expect, it } from 'vitest'
import { canTabSwitchToEdit, makeTab } from '../src/learn/tabs'
import { matchVimCommands } from '../src/lib/vimCommandCatalog'
import { findSearchMatches } from '../src/lib/browseVimSearch'

describe('浏览模式 Vim 光标与搜索功能增强', () => {
  describe('1. canTabSwitchToEdit: 仅对允许切换为编辑模式的页签开放', () => {
    it('教学文档、笔记、超级文档、新建草稿均允许切换为编辑模式', () => {
      const teachTab = makeTab({ kind: 'teach', nodeId: 'node-1' }, 0)
      const noteTab = makeTab({ kind: 'note', nodeId: 'node-1', note: '笔记1' }, 0)
      const superTab = makeTab({ kind: 'super', nodeId: 'node-1', name: '超级文档' }, 0)
      const draftTab = makeTab({ kind: 'draft', key: 'draft-1' }, 0)

      expect(canTabSwitchToEdit(teachTab)).toBe(true)
      expect(canTabSwitchToEdit(noteTab)).toBe(true)
      expect(canTabSwitchToEdit(superTab)).toBe(true)
      expect(canTabSwitchToEdit(draftTab)).toBe(true)
    })

    it('外部普通文本文件与工作区代码文件允许编辑，而媒体与 PDF 不允许', () => {
      const mdLocal = makeTab({ kind: 'local', path: 'C:/docs/note.md' }, 0)
      const txtLocal = makeTab({ kind: 'local', path: 'C:/docs/data.txt' }, 0)
      const pngLocal = makeTab({ kind: 'local', path: 'C:/docs/img.png' }, 0)
      const pdfLocal = makeTab({ kind: 'local', path: 'C:/docs/book.pdf' }, 0)
      const wsCode = makeTab({ kind: 'ws', nodeId: 'n1', seg: 'src/main.ts' }, 0)
      const wsPdf = makeTab({ kind: 'ws', nodeId: 'n1', seg: 'assets/manual.pdf' }, 0)

      expect(canTabSwitchToEdit(mdLocal)).toBe(true)
      expect(canTabSwitchToEdit(txtLocal)).toBe(true)
      expect(canTabSwitchToEdit(pngLocal)).toBe(false)
      expect(canTabSwitchToEdit(pdfLocal)).toBe(false)
      expect(canTabSwitchToEdit(wsCode)).toBe(true)
      expect(canTabSwitchToEdit(wsPdf)).toBe(false)
    })

    it('系统级页签（设置、用户中心、用量、日程、导读、思维导图、网页、视频等）绝不允许编辑', () => {
      const settingsTab = makeTab({ kind: 'settings' }, 0)
      const userTab = makeTab({ kind: 'user' }, 0)
      const usageTab = makeTab({ kind: 'usage' }, 0)
      const scheduleTab = makeTab({ kind: 'schedule' }, 0)
      const outlineTab = makeTab({ kind: 'outline', nodeId: 'node-1' }, 0)
      const webTab = makeTab({ kind: 'web', url: 'https://example.com', key: 'w1' }, 0)
      const videoTab = makeTab({ kind: 'video' }, 0)

      expect(canTabSwitchToEdit(settingsTab)).toBe(false)
      expect(canTabSwitchToEdit(userTab)).toBe(false)
      expect(canTabSwitchToEdit(usageTab)).toBe(false)
      expect(canTabSwitchToEdit(scheduleTab)).toBe(false)
      expect(canTabSwitchToEdit(outlineTab)).toBe(false)
      expect(canTabSwitchToEdit(webTab)).toBe(false)
      expect(canTabSwitchToEdit(videoTab)).toBe(false)
      expect(canTabSwitchToEdit(null)).toBe(false)
    })
  })

  describe('2. matchVimCommands: 命令补全修复（支持带冒号、空输入与拼音匹配）', () => {
    it('输入空字符串或单冒号 ":" 时能够返回所有可用命令候选', () => {
      const emptyMatches = matchVimCommands('')
      const colonMatches = matchVimCommands(':')

      expect(emptyMatches.length).toBeGreaterThan(0)
      expect(colonMatches.length).toBeGreaterThan(0)
      expect(emptyMatches.some((c) => c.cmd === 'w')).toBe(true)
      expect(colonMatches.some((c) => c.cmd === 'edit')).toBe(true)
    })

    it('无论是否携带前导冒号 ":" 均能精准前缀补全命令', () => {
      const withoutColon = matchVimCommands('tabo')
      const withColon = matchVimCommands(':tabo')

      expect(withoutColon.some((c) => c.cmd === 'tabonly')).toBe(true)
      expect(withColon.some((c) => c.cmd === 'tabonly')).toBe(true)

      const editMatch = matchVimCommands(':e')
      expect(editMatch.some((c) => c.cmd === 'edit')).toBe(true)
    })

    it('支持通过拼音首字母或全拼匹配中文功能命令', () => {
      // "baocun" 匹配 "保存文档" (:w)
      const pinyinHits = matchVimCommands(':baocun')
      expect(pinyinHits.some((c) => c.cmd === 'w')).toBe(true)

      // "bianji" 匹配 "编辑文档" (:edit)
      const editHits = matchVimCommands(':bianji')
      expect(editHits.some((c) => c.cmd === 'edit')).toBe(true)
    })
  })

  describe('3. findSearchMatches: 拼音与正则双模搜索', () => {
    const sampleText = '欢迎使用墨记笔记系统，版本发布于2026年，这是一款高效学习与知识沉淀的生产力工具。'

    it('支持正则表达式精确搜索', () => {
      // 匹配连续数字
      const numMatches = findSearchMatches(sampleText, '\\d+')
      expect(numMatches.length).toBe(1)
      const matchedStr = sampleText.slice(numMatches[0].start, numMatches[0].end)
      expect(matchedStr).toBe('2026')
    })

    it('支持通过拼音全拼匹配汉字内容', () => {
      // "moji" 匹配 "墨记"
      const mojiMatches = findSearchMatches(sampleText, 'moji')
      expect(mojiMatches.length).toBeGreaterThan(0)
      const matched = sampleText.slice(mojiMatches[0].start, mojiMatches[0].end)
      expect(matched).toBe('墨记')

      // "gongju" 匹配 "工具"
      const gjMatches = findSearchMatches(sampleText, 'gongju')
      expect(gjMatches.length).toBeGreaterThan(0)
      const gjText = sampleText.slice(gjMatches[0].start, gjMatches[0].end)
      expect(gjText).toBe('工具')
    })

    it('支持通过拼音首字母简拼匹配汉字内容', () => {
      // "mj" 匹配 "墨记"
      const mjMatches = findSearchMatches(sampleText, 'mj')
      expect(mjMatches.length).toBeGreaterThan(0)
      const matched = sampleText.slice(mjMatches[0].start, mjMatches[0].end)
      expect(matched).toBe('墨记')

      // "scl" 匹配 "生产力"
      const sclMatches = findSearchMatches(sampleText, 'scl')
      expect(sclMatches.length).toBeGreaterThan(0)
      const matchedScl = sampleText.slice(sclMatches[0].start, sclMatches[0].end)
      expect(matchedScl).toBe('生产力')
    })

    it('非法正则表达式自动降级，绝不崩溃并继续命中匹配', () => {
      const textWithSpecial = '版本信息 [v0.8.0]，欢迎使用墨记！'
      // 包含未闭合方括号的非法正则
      const brokenMatches = findSearchMatches(textWithSpecial, '[v0.')
      // 降级为字面量子串匹配
      expect(brokenMatches.length).toBe(1)
      expect(textWithSpecial.slice(brokenMatches[0].start, brokenMatches[0].end)).toBe('[v0.')
    })
  })
})
