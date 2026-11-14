/**
 * 提供商配置页的两组能力开关（见 ai/providers 的 ProviderPreset.serverTools / files）：
 *
 * - **服务端工具**（ServerToolsFields，基础配置）：联网搜索 deepseek_web_search 与
 *   阅读链接 deepseek_read_url——都在 DeepSeek 服务端执行，请求体的 tools 数组里
 *   声明即可（见 ai/client 的 serverToolDecls）。只有**预设声明了 serverTools** 的
 *   提供商（当前仅 DeepSeek）才渲染这个组件：别的提供商不支持，开关组件不展示。
 * - **Files API**（FilesApiFields，高级配置）：云端文件上传/引用的可选能力——
 *   不是每家都提供，所以对**所有**提供商都渲染开关（默认关），由用户自己判断；
 *   DeepSeek 预设兜底为开（开箱即用），用户显式关闭后以用户为准。
 */

import { t } from '../../i18n'
import type { ProviderConfig } from '../../ai/settings'
import type { ProviderPreset } from '../../ai/providers'

function SwitchRow({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  title: string
  hint?: string
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-seal"
      />
      <span className="min-w-0">
        <span className="block text-[12px] text-ink-strong">{title}</span>
        {hint && <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink-faint">{hint}</span>}
      </span>
    </label>
  )
}

/** 基础配置：服务端工具的两个开关（preset.serverTools 存在才挂载） */
export function ServerToolsFields({
  cfg,
  preset,
  patchProvider,
}: {
  cfg: ProviderConfig
  preset: ProviderPreset | undefined
  patchProvider: (id: string, patch: Partial<ProviderConfig>) => void
}) {
  if (!preset?.serverTools) return null
  // 默认值与 resolveProvider 的合成同源：用户没显式设置时回落预设（DeepSeek 全开）
  const current = cfg.serverTools ?? preset.serverTools
  const patch = (p: Partial<typeof current>) => patchProvider(cfg.id, { serverTools: { ...current, ...p } })
  return (
    <div className="rounded-xl border border-line bg-card/50 p-4">
      <h4 className="mb-1 text-[12px] font-medium text-ink-strong">{t('服务端工具')}</h4>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
        {t('由 DeepSeek 服务端执行的联网能力：搜索与抓取按次另计费，结果自动附带引用。仅 deepseek-flash 模型支持。')}
      </p>
      <div className="flex flex-col gap-2.5">
        <SwitchRow
          checked={current.webSearch}
          onChange={(v) => patch({ webSearch: v })}
          title={t('联网搜索')}
          hint={t('模型需要最新信息时自动搜索；与智能导师的工具循环互斥（工具轮不注入），纯聊天可用')}
        />
        <SwitchRow
          checked={current.readUrl}
          onChange={(v) => patch({ readUrl: v })}
          title={t('阅读链接')}
          hint={t('消息里的 URL 由服务端抓取正文后再作答（deepseek_read_url）')}
        />
      </div>
    </div>
  )
}

/** 高级配置：Files API 开关（所有提供商都渲染；DeepSeek 预设默认开） */
export function FilesApiFields({
  cfg,
  preset,
  patchProvider,
}: {
  cfg: ProviderConfig
  preset: ProviderPreset | undefined
  patchProvider: (id: string, patch: Partial<ProviderConfig>) => void
}) {
  const current = cfg.files ?? preset?.files ?? { enabled: false }
  return (
    <div className="rounded-xl border border-line bg-card/50 p-4">
      <h4 className="mb-1 text-[12px] font-medium text-ink-strong">{t('Files API（云端文件）')}</h4>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
        {t('并非所有提供商都提供云端文件能力。开启后可在「设置 → 模型 → 能力接入」里管理云端文件；不需要时保持关闭。')}
      </p>
      <SwitchRow
        checked={current.enabled}
        onChange={(v) => patchProvider(cfg.id, { files: { enabled: v } })}
        title={t('启用 Files API')}
        hint={t('上传 / 列出 / 删除提供商侧的文件（DeepSeek：/files 端点，默认开箱即用）')}
      />
    </div>
  )
}
