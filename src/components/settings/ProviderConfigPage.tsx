/**
 * 这个文件负责：模型设置的二级页面：按 id 找到草稿里的那条配置，交给 ConfigBody 渲染。
 */

import { type AiSettings, type ProviderConfig } from '../../ai/settings'
import { t } from '../../i18n'
import { ConfigBody } from './ConfigBody'
import type { StatusState } from './providerDraft'

/* ---------- 二级：提供商配置页 ---------- */

export function ProviderConfigPage({
  draft,
  providerId,
  status,
  setStatus,
  patchProvider,
  replaceConfig,
  onDelete,
}: {
  draft: AiSettings
  providerId: string
  status: StatusState
  setStatus: (s: StatusState) => void
  patchProvider: (id: string, patch: Partial<ProviderConfig>) => void
  replaceConfig: (fromId: string, next: ProviderConfig) => void
  onDelete: (id: string, opts?: { silent?: boolean }) => void
}) {
  const cfg = draft.providers.find((p) => p.id === providerId)

  if (!cfg) {
    return (
      <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] text-ink-faint">
        {t('这条提供商配置已不存在。')}
      </p>
    )
  }
  return (
    <ConfigBody
      // key 绑定配置 id：换预设时组件重建，本地 state（请求头文本等）跟着重置
      key={cfg.id}
      cfg={cfg}
      takenIds={draft.providers.filter((p) => p.id !== cfg.id).map((p) => p.id)}
      status={status}
      setStatus={setStatus}
      patchProvider={patchProvider}
      replaceConfig={replaceConfig}
      onDelete={onDelete}
    />
  )
}
