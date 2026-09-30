/**
 * 这个文件负责页面卸载前的同步落盘：一批「写 / 删 / 移动」在渲染进程关掉之前同步做完，
 * 顺序与「为什么必须同步、移动项为什么必须排在删除项之前」见下面 flushSync 的说明。
 */
import fs from 'node:fs'
import path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { moveTargets, resolveInside } from './files'
import { currentRoot } from './settings'

import type { FlushItem } from '../../shared/ipc'

// FlushItem 原先在这里也写了一份（与 electron/preload.ts、src/lib/native.ts 逐字重复）：
// 现在统一用 shared/ipc.ts，并按原样转出去（electron/storage.ts 仍在转它）。
export type { FlushItem }

/**
 * 同步写一批。渲染进程在页面卸载前用 sendSync 调用。
 *
 * 平时的写是异步 + 防抖的，页面一关，队列里还没轮到的那次就没了；
 * 所以最后一批必须同步完成——阻塞渲染进程几毫秒，换「关窗前最后一次编辑不丢」。
 */
export function flushSync(items: unknown): { ok: boolean; failed: string[] } {
  const failed: string[] = []
  if (!Array.isArray(items)) return { ok: false, failed }
  for (const raw of items as FlushItem[]) {
    /**
     * 移动项排在最前：一次改名会同时产生「移动旧目录」与「删除旧路径」两种条目，
     * 顺序一旦反了，资源库里的二进制就随着旧目录一起没了（见 movePath 的说明）。
     * 这里只按数组顺序执行，不替调用方排序——排序需要有全局视野，而这一层没有。
     */
    if (raw.move) {
      const m = moveTargets(raw.rel, raw.to)
      if ('error' in m) {
        failed.push(String(raw?.rel))
        continue
      }
      // 两端相同：无事发生，不算失败
      if (m.noop) continue
      /*
       * 源不存在就跳过，且**不算失败**：这是关窗前的最后一批写，调用方无条件
       * 提交 move 项（此刻它已经没法先查一遍磁盘），源目录不存在是正常情况——
       * 这一次改名本来就没有旧目录要搬。
       */
      if (!fs.existsSync(m.from)) continue
      /*
       * 目标已存在同样**不删**：与 movePath 一条规则，宁可这次没搬成。
       * 不问这一下的话，POSIX 上的 rename 会把同名文件静默覆盖掉。
       */
      if (fs.existsSync(m.to)) {
        failed.push(String(raw?.rel))
        continue
      }
      try {
        fs.mkdirSync(path.dirname(m.to), { recursive: true })
        fs.renameSync(m.from, m.to)
      } catch {
        // 同卷 rename 失败在这里不是小事：接着的删除会把没挪走的资源删掉，
        // 因此必须记进 failed 让调用方知道，而不是静默跳过
        failed.push(String(raw?.rel))
      }
      continue
    }
    const full = resolveInside(currentRoot(), raw?.rel)
    if (!full) {
      failed.push(String(raw?.rel))
      continue
    }
    try {
      if (raw.remove) {
        if (full !== path.resolve(currentRoot())) fs.rmSync(full, { recursive: true, force: true })
        continue
      }
      fs.mkdirSync(path.dirname(full), { recursive: true })
      const text =
        raw.kind === 'yaml'
          ? stringifyYaml(raw.data ?? null, { lineWidth: 0 })
          : raw.kind === 'json'
            ? JSON.stringify(raw.data ?? null, null, 2)
            : typeof raw.data === 'string'
              ? raw.data
              : ''
      fs.writeFileSync(full, text, 'utf-8')
    } catch {
      failed.push(String(raw?.rel))
    }
  }
  return { ok: failed.length === 0, failed }
}
