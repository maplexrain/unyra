/** 这个文件负责什么：资源在磁盘上的位置——目标目录、资源目录、清单与文件本体在数据根下的相对路径。 */

import type { LearnStore } from '../types'
import { DOCS_DIR, MANIFEST_FILE, STATIC_DIR, nodeLayout } from '../layout'
import type { StaticResource } from './types'

/* ---------- 位置 ---------- */

/** 目标的根目录（目标目录就是根节点的目录） */
export function goalDirOf(store: LearnStore, goalId: string): string | null {
  const rootId = store.goals.find((g) => g.id === goalId)?.rootNodeId
  if (!rootId) return null
  const layout = nodeLayout(store).get(rootId)
  if (!layout) return null
  return [DOCS_DIR, ...layout.dir].join('/')
}

/** 资源目录：\`docs/{目标}/static\`；目标不存在时 null */
export function goalStaticDir(store: LearnStore, goalId: string): string | null {
  const dir = goalDirOf(store, goalId)
  return dir ? dir + '/' + STATIC_DIR : null
}

export const manifestPathOf = (store: LearnStore, goalId: string): string | null => {
  const dir = goalStaticDir(store, goalId)
  return dir ? dir + '/' + MANIFEST_FILE : null
}

/** 一条资源在数据根下的相对路径 */
export function resourceRel(store: LearnStore, goalId: string, res: StaticResource): string | null {
  const dir = goalStaticDir(store, goalId)
  return dir ? dir + '/' + res.uuid + (res.ext ? '.' + res.ext : '') : null
}

/**
 * 目标目录重命名后（如根节点改名），自愈该目标对话中所有附件与图片的静态相对路径引用 (rel)。
 * 确保指向当前最新的 goalStaticDir / goalImagesDir。
 */
export function retargetStaticRefs(store: LearnStore, goalId?: string): LearnStore {
  const goalsToProcess = goalId ? store.goals.filter((g) => g.id === goalId) : store.goals
  if (!goalsToProcess.length) return store

  const goalDirs = new Map<string, string>()
  for (const g of goalsToProcess) {
    const dir = goalDirOf(store, g.id)
    if (dir) goalDirs.set(g.id, dir)
  }

  const retargetRel = (rel: string, goalDir: string): string => {
    if (!rel) return rel
    const staticMarker = '/static/'
    const sIdx = rel.lastIndexOf(staticMarker)
    if (sIdx !== -1) {
      const filePart = rel.slice(sIdx + staticMarker.length)
      return `${goalDir}/static/${filePart}`
    }
    const imagesMarker = '/images/'
    const iIdx = rel.lastIndexOf(imagesMarker)
    if (iIdx !== -1) {
      const filePart = rel.slice(iIdx + imagesMarker.length)
      return `${goalDir}/images/${filePart}`
    }
    return rel
  }

  let changed = false
  const nextConversations = store.conversations.map((conv) => {
    const goalDir = goalDirs.get(conv.goalId)
    if (!goalDir) return conv

    let convChanged = false
    const nextMessages = conv.messages.map((msg) => {
      let msgChanged = false
      let nextImages = msg.images
      if (nextImages && nextImages.length > 0) {
        nextImages = nextImages.map((img) => {
          const nextRel = retargetRel(img.rel, goalDir)
          if (nextRel !== img.rel) {
            msgChanged = true
            return { ...img, rel: nextRel }
          }
          return img
        })
      }

      let nextFiles = msg.files
      if (nextFiles && nextFiles.length > 0) {
        nextFiles = nextFiles.map((file) => {
          if (file.rel) {
            const nextRel = retargetRel(file.rel, goalDir)
            if (nextRel !== file.rel) {
              msgChanged = true
              return { ...file, rel: nextRel }
            }
          }
          return file
        })
      }

      let nextParts = msg.parts
      if (nextParts && nextParts.length > 0) {
        nextParts = nextParts.map((part) => {
          if (part.type === 'tool' && part.images && part.images.length > 0) {
            let partChanged = false
            const nextPartImages = part.images.map((img) => {
              const nextRel = retargetRel(img.rel, goalDir)
              if (nextRel !== img.rel) {
                partChanged = true
                return { ...img, rel: nextRel }
              }
              return img
            })
            if (partChanged) {
              msgChanged = true
              return { ...part, images: nextPartImages }
            }
          }
          return part
        })
      }

      if (msgChanged) {
        convChanged = true
        return {
          ...msg,
          ...(nextImages ? { images: nextImages } : {}),
          ...(nextFiles ? { files: nextFiles } : {}),
          parts: nextParts,
        }
      }
      return msg
    })

    if (convChanged) {
      changed = true
      return { ...conv, messages: nextMessages }
    }
    return conv
  })

  return changed ? { ...store, conversations: nextConversations } : store
}

