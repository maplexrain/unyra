/**
 * 通道徽标：把这个版本属于哪一档标出来（正式版 / 尝鲜版）。
 *
 * 判据只有一条：版本号里有没有预发布后缀（vX.Y.Z-beta.N 算尝鲜版）——
 * 与发布侧、主进程的判定同源（见 electron/update-core.ts 的 channelOfVersion）。
 * 这里**只负责显示**：收哪一档版本、让不让下载，都由主进程说了算。
 *
 * 用在四处：设置 → 更新（当前版本与查到的新版本）、顶栏更新入口的面板、更新确认弹窗。
 */

import { t } from '../../i18n'
import { isPrereleaseVersion } from '../../lib/update'

interface Props {
  version?: string
  /** sm 给顶栏 / 状态行这类小尺寸处用，md 给设置页头部用 */
  size?: 'sm' | 'md'
}

export default function ChannelBadge({ version, size = 'md' }: Props) {
  const beta = isPrereleaseVersion(version)
  const tone = beta
    ? 'border-warn/40 bg-warn/10 text-warn-deep'
    : 'border-ok/30 bg-ok/10 text-ok-deep'
  const dims = size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[10.5px]'
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border font-medium ${dims} ${tone}`}
    >
      {beta ? t('尝鲜版') : t('正式版')}
    </span>
  )
}
