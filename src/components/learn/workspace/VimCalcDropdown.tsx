/**
 * VimCalcDropdown: :calc / :calculator 命令参数下拉候选组件。
 *
 * 当用户在命令行输入 `:calc ` 时弹出，展示可选的计算器类型列表（标准、科学、程序员），
 * 支持上下键聚焦轮转与 Enter 键确认打开。
 */

import { Calculator, Binary, Atom } from 'lucide-react'
import type { CalculatorMode } from '../../../lib/calculatorState'
import { t } from '../../../i18n'

export interface CalcOption {
  kind: CalculatorMode
  label: string
  desc: string
  aliases: string[]
  icon: typeof Calculator
}

export const CALC_OPTIONS: CalcOption[] = [
  {
    kind: 'standard',
    label: t('标准模式 (Standard)'),
    desc: t('四则运算、百分比、倒数与开方计算'),
    aliases: ['standard', 'std', 'normal', '标准'],
    icon: Calculator,
  },
  {
    kind: 'scientific',
    label: t('科学模式 (Scientific)'),
    desc: t('三角函数、对数、指数、幂次、阶乘与角度/弧度'),
    aliases: ['scientific', 'sci', '科学'],
    icon: Atom,
  },
  {
    kind: 'programmer',
    label: t('程序员模式 (Programmer)'),
    desc: t('HEX / DEC / OCT / BIN 进制互转与位逻辑运算 (AND/OR/XOR/Lsh/Rsh)'),
    aliases: ['programmer', 'prog', 'bin', 'hex', '程序员'],
    icon: Binary,
  },
]

export function filterCalcOptions(filter: string): CalcOption[] {
  const q = filter.trim().toLowerCase()
  if (!q) return CALC_OPTIONS
  return CALC_OPTIONS.filter(
    (opt) =>
      opt.kind.includes(q) ||
      opt.label.toLowerCase().includes(q) ||
      opt.desc.toLowerCase().includes(q) ||
      opt.aliases.some((a) => a.toLowerCase().includes(q))
  )
}

interface Props {
  filter: string
  selectedIndex: number
  onSelect: (opt: CalcOption) => void
}

export default function VimCalcDropdown({ filter, selectedIndex, onSelect }: Props) {
  const options = filterCalcOptions(filter)

  if (options.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">
        {t('未找到匹配的计算器类型（可选 standard, scientific, programmer）')}
      </div>
    )
  }

  return (
    <div className="max-h-[300px] overflow-y-auto p-1.5 flex flex-col gap-0.5">
      {options.map((opt, idx) => {
        const active = idx === selectedIndex
        const IconComponent = opt.icon
        return (
          <button
            key={opt.kind}
            type="button"
            className={
              'flex w-full items-center justify-between px-3.5 py-2.5 text-left rounded-lg text-[13px] transition cursor-pointer select-none ' +
              (active ? 'bg-seal/15 text-seal-light' : 'hover:bg-line/40 text-ink')
            }
            onClick={() => onSelect(opt)}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border shadow-2xs ' +
                  (active ? 'bg-seal text-white border-seal' : 'bg-card border-line/60 text-ink-soft')
                }
              >
                <IconComponent size={14} />
              </span>
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate text-[13px]">{opt.label}</span>
                <span className="text-[11px] text-ink-faint truncate">{opt.desc}</span>
              </div>
            </div>
            <span className="font-mono text-[11px] text-ink-faint shrink-0 ml-2">
              :calc {opt.kind}
            </span>
          </button>
        )
      })}
    </div>
  )
}
