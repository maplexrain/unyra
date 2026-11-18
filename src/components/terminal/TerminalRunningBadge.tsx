import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getTerminalMeta, subscribeTerminalMeta } from './terminalRegistry'
import { t } from '../../i18n'

export function TerminalRunningBadge({ termId }: { termId: string }) {
  const [, bump] = useState(0)

  useEffect(() => {
    return subscribeTerminalMeta((changedId) => {
      if (changedId === termId) {
        bump((n) => n + 1)
      }
    })
  }, [termId])

  const meta = getTerminalMeta(termId)
  if (!meta?.runningPid) return null

  return (
    <span
      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-amber-500 animate-spin"
      title={t('终端命令正在运行')}
    >
      <Loader2 size={11} />
    </span>
  )
}
