/**
 * 待发送图片的两个小工具：建一个（贴进来时）与放掉一个（移除 / 清空 / 发送 / 卸载时）。
 *
 * 单独一份是因为它们既不属于「画图」，也不属于「读图」——只是一对配套的生命周期动作；
 * Images.tsx 会原样再导出它们，所以调用方 import 的路径不变。
 */

import type { PendingImage } from '../../../agent/types'
import { t } from '../../../i18n'

/** 贴进来的一张图：只占内存，发送时才转存（见 agent/types 的 PendingImage） */
export function makePendingImage(file: File, index: number): PendingImage {
  return {
    id: crypto.randomUUID(),
    name: file.name?.trim() || t('粘贴的图片 {0}', index + 1),
    bytes: file.size,
    file,
    previewUrl: URL.createObjectURL(file),
  }
}

/** 放掉待发送图片的预览地址：移除、清空、发送、卸载都要走它，否则 object URL 会一直攒着 */
export function releasePending(list: PendingImage[]): void {
  for (const p of list) URL.revokeObjectURL(p.previewUrl)
}
