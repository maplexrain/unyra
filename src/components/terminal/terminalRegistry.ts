/**
 * terminalRegistry: 全局终端会话状态与生命周期登记表。
 * 追踪终端实例的实时状态（运行 PID、当前执行的命令、Shell 类型、序列号），
 * 支持 TabBar 页签标题动态展示正在运行的命令或序号，并驱动运行状态加载指示。
 */

import type { LearnTab, ShellKind } from '../../learn/types/tabs'

export interface TerminalTabMeta {
  termId: string
  shell: ShellKind
  title: string
  runningPid: string | null
  currentCommand: string | null
}

const terminalStates = new Map<string, TerminalTabMeta>()
const listeners = new Set<(termId: string) => void>()

export function getTerminalMeta(termId: string): TerminalTabMeta | undefined {
  return terminalStates.get(termId)
}

export function setTerminalMeta(termId: string, meta: Partial<TerminalTabMeta>): void {
  const existing = terminalStates.get(termId) || {
    termId,
    shell: 'powershell',
    title: `${termId}: pwsh`,
    runningPid: null,
    currentCommand: null,
  }
  terminalStates.set(termId, { ...existing, ...meta })
  listeners.forEach((fn) => fn(termId))
}

export function unregisterTerminalMeta(termId: string): void {
  terminalStates.delete(termId)
  listeners.forEach((fn) => fn(termId))
}

export function subscribeTerminalMeta(fn: (termId: string) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 计算下一个未被占用的终端序号（1, 2, 3...） */
export function getNextTerminalSeq(tabs: LearnTab[] = []): string {
  const used = new Set<number>()
  for (const t of tabs) {
    if (t.ref.kind === 'terminal') {
      const tid = (t.ref as any).termId
      const num = parseInt(tid, 10)
      if (!Number.isNaN(num)) {
        used.add(num)
      }
    }
  }
  for (const id of terminalStates.keys()) {
    const num = parseInt(id, 10)
    if (!Number.isNaN(num)) {
      used.add(num)
    }
  }
  let seq = 1
  while (used.has(seq)) {
    seq++
  }
  return String(seq)
}
