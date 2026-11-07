import {
  clearWorkMemories,
  createMemory,
  deleteMemory,
  updateMemory,
  type MemoryInput,
  type MemoryPatch,
} from '../../../learn/memory'
import type { LearnStore } from '../../../learn/types'

/** 记忆写入口需要的宿主能力 */
export interface MemoryActionsDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
}

/*
 * 记忆的写入口（见 learn/memory）：**目标由调用方给**——工作记忆落进哪个目标，
 * 由页签携带的 goalId 或设置页里的选择决定，不随活动目标漂移；长期记忆跨目标，
 * 根本没有归属这回事。
 *
 * 四个回调都是「纯函数 + set」：校验、上限、作用域搬家全在 learn/memory 里，
 * 界面只管把用户填的东西交下去（与 workflows / essays 同一套做法）。
 */
export function useMemoryActions({ getLatest, set }: MemoryActionsDeps) {
  const memoryCreate = (input: MemoryInput) => {
    set(createMemory(getLatest(), input))
  }
  const memoryUpdate = (uuid: string, patch: MemoryPatch) => {
    set(updateMemory(getLatest(), uuid, patch))
  }
  const memoryDelete = (uuid: string) => {
    set(deleteMemory(getLatest(), uuid))
  }
  const memoryClearWork = (goalId: string) => {
    set(clearWorkMemories(getLatest(), goalId))
  }

  return { memoryCreate, memoryUpdate, memoryDelete, memoryClearWork }
}
