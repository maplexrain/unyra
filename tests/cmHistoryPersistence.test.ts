import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import {
  saveEditorHistory,
  loadEditorHistory,
  debouncedSaveEditorHistory,
  flushEditorHistory,
  clearEditorHistory,
  createRestoredEditorState,
} from '../src/lib/cmHistoryPersistence'

describe('cmHistoryPersistence 撤销历史持久化与防抖测试', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      get length() {
        return store.size
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    }
    flushEditorHistory()
    vi.useRealTimers()
  })

  it('能正确持久化撤销历史并恢复到新 EditorState 中成功撤销', () => {
    const key = 'test-doc-1'
    let state = EditorState.create({
      doc: 'initial text',
      extensions: [history()],
    })

    // 进行两次修改
    state = state.update({ changes: { from: 12, insert: ' and more' } }).state
    state = state.update({ changes: { from: 21, insert: ' text' } }).state
    expect(state.doc.toString()).toBe('initial text and more text')

    // 保存历史记录
    saveEditorHistory(key, state)

    const savedHistory = loadEditorHistory(key)
    expect(savedHistory).toBeDefined()
    expect(savedHistory?.history.done.length).toBeGreaterThan(0)

    // 重建新状态并加载恢复该历史
    let state2 = createRestoredEditorState(state.doc.toString(), [history()], savedHistory)

    expect(state2.doc.toString()).toBe('initial text and more text')

    // 执行 undo 撤销
    const res1 = undo({
      state: state2,
      dispatch: (tr) => {
        state2 = tr.state
      },
    })
    expect(res1).toBe(true)
    expect(state2.doc.toString()).toBe('initial text')
  })

  it('防抖功能正常延后写入，且 flushEditorHistory 能立即同步落盘', () => {
    vi.useFakeTimers()
    const key = 'test-doc-debounced'
    let state = EditorState.create({
      doc: 'start',
      extensions: [history()],
    })
    state = state.update({ changes: { from: 5, insert: ' edit' } }).state

    debouncedSaveEditorHistory(key, state, 300)
    // 还没到 300ms，尚未落盘
    expect(loadEditorHistory(key)).toBeNull()

    // 推进 150ms 再次调用防抖保存
    vi.advanceTimersByTime(150)
    debouncedSaveEditorHistory(key, state, 300)
    expect(loadEditorHistory(key)).toBeNull()

    // 调用 flush 立即刷新落盘
    flushEditorHistory(key)
    expect(loadEditorHistory(key)).not.toBeNull()

    clearEditorHistory(key)
    expect(loadEditorHistory(key)).toBeNull()
  })
})
