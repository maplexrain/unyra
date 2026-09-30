/**
 * 文档区截图（api.ui.screenshot）的落盘：把主进程截回来的一张 PNG 存进目标资源库。
 *
 * 截图走的是**资源库**而不是 images/：它和「用户贴进来的图」是同一类东西——
 * 进了上下文、可能被文档引用（`![说明](moji:static/uuid)`），就该有 uuid、
 * 能被 res.list 看见。区别只在来源：这张的字节来自 capturePage 而不是 File。
 */
import { writeUserBinary } from '../lib/storage'
import type { MessageImage } from '../agent/types'
import type { LearnStore } from './types'
import { addResource, goalStaticDir, hashBytes, makeResource } from './static'

export type SaveScreenshotResult =
  | { ok: true; image: MessageImage }
  | { ok: false; error: string }

/** data URL → 字节；截图只会是 image/png（capturePage 的输出） */
function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:image/') || comma < 0) return null
  try {
    const raw = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** 空白文档截出来只有几 KB：少于这个数八成是白图，提醒比存图有用 */
const MIN_PNG_BYTES = 1200

export async function saveScreenshot(
  getLatest: () => LearnStore,
  set: (store: LearnStore) => void,
  goalId: string,
  dataUrl: string,
  name = '文档区截图',
): Promise<SaveScreenshotResult> {
  const bytes = dataUrlBytes(dataUrl)
  if (!bytes) return { ok: false, error: '截图数据不是一张图片（PNG）' }
  if (bytes.length < MIN_PNG_BYTES) {
    return { ok: false, error: '截出来是空白（文档区可能没有可见内容）' }
  }
  const rel0 = goalStaticDir(getLatest(), goalId)
  if (!rel0) return { ok: false, error: '找不到这个目标的目录，截图存不了' }
  const hash = await hashBytes(bytes)
  const resource = makeResource({ name, ext: 'png', bytes: bytes.length, hash })
  const rel = rel0 + '/' + resource.uuid + '.png'
  /**
   * 必须走 *User* 那一组：rel 是「相对当前用户」的路径（docs/{目标}/static/…），
   * 直接调 native().storage.* 会把它当「相对数据根」解析，文件落进 {root}/docs/…
   * 而清单（走 buildDocs 的 userRel）在 users/{uid}/docs/… 下——清单有、文件没有，
   * res.read 就会报「图片读不到」。这正是资源与清单分家那桩旧案的同款坑。
   */
  if (!(await writeUserBinary(rel, dataUrl))) {
    return { ok: false, error: '截图写入失败：磁盘写入未成功（清单没有改动）' }
  }
  set(addResource(getLatest(), goalId, resource))
  return {
    ok: true,
    image: {
      id: resource.uuid,
      rel,
      name,
      mime: 'image/png',
      bytes: bytes.length,
    },
  }
}
