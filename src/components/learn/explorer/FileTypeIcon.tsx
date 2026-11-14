/**
 * 资源管理器里**真实文件**的类型图标：按文件名（扩展名）渲染与页签栏同一套的
 * 文件类型图标（tabbar/TabIcons 的 FileIcon 同款用法，autoAssign 按扩展名认）。
 * 同一个东西在两处长得一样，用户才不用重新认一遍——工作区 / 项目的文件行与
 * 本地文件行都用它，不再一律画一枚中性灰的纸页。
 */
import { FileIcon } from '@react-symbols/icons/utils'

export function FileTypeIcon({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center">
      <FileIcon fileName={name} autoAssign={true} width={16} height={16} className="shrink-0" />
    </span>
  )
}
