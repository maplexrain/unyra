/**
 * 响应式文件实体 React Hook (useFileEntity)。
 *
 * 业务组件无需了解底层的 IPC 或文件 IO 逻辑，直接像操作普通 React State 一样
 * 声明式读取和更新文件实体。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { vfsBus } from './bus'
import { FILE_ENTITIES, resolveEntityPath } from './registry'
import type { FileEntityDef } from './types'

export function useFileEntity<T = unknown, S = T>(
  entityId: string,
  params: Record<string, string>,
  selector?: (data: T) => S,
): [S, (updater: T | ((prev: T) => T)) => Promise<void>] {
  const entityDef = useMemo(() => {
    return FILE_ENTITIES.find((e) => e.id === entityId) as FileEntityDef<T> | undefined
  }, [entityId])

  const resolvedPath = useMemo(() => {
    try {
      return resolveEntityPath(entityId, params)
    } catch {
      return ''
    }
  }, [entityId, params])

  const selectorRef = useRef(selector)
  selectorRef.current = selector

  // 读取初始值（优先读内存缓存，无缓存使用实体默认值）
  const getInitialValue = (): T => {
    if (!resolvedPath) return entityDef ? entityDef.defaultValue() : (null as unknown as T)
    const cached = vfsBus.getCached<T>(resolvedPath)
    if (cached !== undefined) return cached
    return entityDef ? entityDef.defaultValue() : (null as unknown as T)
  }

  const [rawState, setRawState] = useState<T>(getInitialValue)

  // 监听 VFS 变动
  useEffect(() => {
    if (!resolvedPath) return

    // 重新挂载或切换路径时，先同步一次最新缓存
    const current = vfsBus.getCached<T>(resolvedPath)
    if (current !== undefined) {
      setRawState(current)
    }

    const unsubscribe = vfsBus.subscribePath<T>(resolvedPath, (event) => {
      if (event.action === 'delete') {
        setRawState(entityDef ? entityDef.defaultValue() : (null as unknown as T))
      } else if (event.data !== undefined) {
        setRawState(event.data)
      }
    })

    return unsubscribe
  }, [resolvedPath, entityDef])

  // 计算 Selector 导出值
  const selectedValue = useMemo(() => {
    if (typeof selectorRef.current === 'function') {
      try {
        return selectorRef.current(rawState)
      } catch {
        return rawState as unknown as S
      }
    }
    return rawState as unknown as S
  }, [rawState])

  // 更新函数
  const updateEntity = async (updater: T | ((prev: T) => T)) => {
    if (!resolvedPath) return
    const nextVal = typeof updater === 'function' ? (updater as (prev: T) => T)(rawState) : updater
    await vfsBus.write<T>(resolvedPath, nextVal, { source: 'ui' })
  }

  return [selectedValue, updateEntity]
}
