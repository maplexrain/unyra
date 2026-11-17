import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Calculator, X, Move } from 'lucide-react'
import {
  type CalculatorMode,
  getCalculatorState,
  subscribeCalculator,
  closeCalculator,
  setCalculatorMode,
} from '../../../lib/calculatorState'
import {
  type ProgrammerBase,
  getBaseValues,
  factorial,
  formatNumberOutput,
} from './calculatorEngine'
import { StandardKeypad, ScientificKeypad, ProgrammerKeypad } from './CalculatorKeypads'
import { t } from '../../../i18n'

export default function CalculatorWindow() {
  const [isOpen, setIsOpen] = useState(() => getCalculatorState().isOpen)
  const [mode, setMode] = useState<CalculatorMode>(() => getCalculatorState().mode)

  // 视口浮窗拖拽位置
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const draggingRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null)
  const windowRef = useRef<HTMLDivElement | null>(null)

  // 计算器内部运算状态
  const [display, setDisplay] = useState('0')
  const [expression, setExpression] = useState('')
  const [isRad, setIsRad] = useState(true)
  const [progBase, setProgBase] = useState<ProgrammerBase>('DEC')
  const [progValue, setProgValue] = useState<bigint>(0n)
  const [progOp, setProgOp] = useState<string | null>(null)
  const [progPrevVal, setProgPrevVal] = useState<bigint | null>(null)
  const [shouldResetDisplay, setShouldResetDisplay] = useState(false)

  // 监听全局打开/关闭与模式切换广播
  useEffect(() => {
    const unsubscribe = subscribeCalculator(() => {
      const state = getCalculatorState()
      setIsOpen(state.isOpen)
      setMode(state.mode)
    })
    return unsubscribe
  }, [])

  // 初始居中定位（尺寸加大后按新宽度居中）
  useEffect(() => {
    if (isOpen && pos === null) {
      const w = mode === 'scientific' ? 500 : mode === 'programmer' ? 460 : 380
      const h = mode === 'scientific' ? 520 : 480
      const initX = Math.max(20, Math.floor((window.innerWidth - w) / 2))
      const initY = Math.max(50, Math.floor((window.innerHeight - h) / 3))
      setPos({ x: initX, y: initY })
    }
  }, [isOpen, mode, pos])

  // 窗口拖动事件监听（阻止默认应用原生标题栏拖拽）
  const handleMouseDownHeader = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    e.stopPropagation()
    const curX = pos?.x ?? 100
    const curY = pos?.y ?? 100
    draggingRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: curX,
      initY: curY,
    }

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      ev.preventDefault()
      ev.stopPropagation()
      const dx = ev.clientX - draggingRef.current.startX
      const dy = ev.clientY - draggingRef.current.startY
      const currentWidth = mode === 'scientific' ? 500 : mode === 'programmer' ? 460 : 380
      const newX = Math.max(10, Math.min(window.innerWidth - currentWidth - 10, draggingRef.current.initX + dx))
      const newY = Math.max(10, Math.min(window.innerHeight - 200, draggingRef.current.initY + dy))
      setPos({ x: newX, y: newY })
    }

    const onMouseUp = (ev: MouseEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      draggingRef.current = null
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }

    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
  }

  // 字符输入
  const handleInput = useCallback((char: string) => {
    if (mode === 'programmer') {
      const currentDigits = shouldResetDisplay ? '' : display
      const nextDigits = (currentDigits === '0' || shouldResetDisplay ? '' : currentDigits) + char
      const safeDigits = nextDigits || '0'
      try {
        const rad = progBase === 'HEX' ? 16 : progBase === 'DEC' ? 10 : progBase === 'OCT' ? 8 : 2
        const parsed = BigInt(
          rad === 16 ? `0x${safeDigits}` : rad === 8 ? `0o${safeDigits}` : rad === 2 ? `0b${safeDigits}` : safeDigits
        )
        setProgValue(parsed)
        setDisplay(safeDigits)
        setShouldResetDisplay(false)
      } catch {}
      return
    }

    // 标准与科学模式
    if (shouldResetDisplay) {
      if (['+', '-', '×', '÷'].includes(char)) {
        setExpression(display + ' ' + char + ' ')
        setDisplay(display)
        setShouldResetDisplay(false)
        return
      }
      setDisplay(char === '.' ? '0.' : char)
      setShouldResetDisplay(false)
      return
    }

    if (char === '.') {
      if (!display.includes('.')) {
        setDisplay(display + '.')
      }
      return
    }

    if (['+', '-', '×', '÷'].includes(char)) {
      setExpression((prev) => prev + display + ' ' + char + ' ')
      setShouldResetDisplay(true)
      return
    }

    if (display === '0') {
      setDisplay(char)
    } else {
      setDisplay(display + char)
    }
  }, [display, mode, progBase, shouldResetDisplay])

  // 退格
  const handleBackspace = useCallback(() => {
    if (mode === 'programmer') {
      if (display.length <= 1) {
        setDisplay('0')
        setProgValue(0n)
      } else {
        const next = display.slice(0, -1)
        setDisplay(next)
        const rad = progBase === 'HEX' ? 16 : progBase === 'DEC' ? 10 : progBase === 'OCT' ? 8 : 2
        try {
          const parsed = BigInt(
            rad === 16 ? `0x${next}` : rad === 8 ? `0o${next}` : rad === 2 ? `0b${next}` : next || '0'
          )
          setProgValue(parsed)
        } catch {
          setProgValue(0n)
        }
      }
      return
    }

    if (display.length <= 1) {
      setDisplay('0')
    } else {
      setDisplay(display.slice(0, -1))
    }
  }, [display, mode, progBase])

  // 全部清空 (C)
  const handleClear = useCallback(() => {
    setDisplay('0')
    setExpression('')
    setProgValue(0n)
    setProgPrevVal(null)
    setProgOp(null)
    setShouldResetDisplay(false)
  }, [])

  // 清除输入 (CE)
  const handleClearEntry = useCallback(() => {
    setDisplay('0')
    if (mode === 'programmer') setProgValue(0n)
  }, [mode])

  // 正负号切换 (±)
  const handleInvertSign = useCallback(() => {
    if (mode === 'programmer') {
      const next = -progValue
      setProgValue(next)
      setDisplay(next.toString(progBase === 'HEX' ? 16 : progBase === 'DEC' ? 10 : progBase === 'OCT' ? 8 : 2).toUpperCase())
      return
    }
    const val = parseFloat(display)
    if (!Number.isNaN(val)) {
      setDisplay(formatNumberOutput(-val))
    }
  }, [display, mode, progBase, progValue])

  // 执行求值 (=)
  const handleCalculate = useCallback(() => {
    if (mode === 'programmer') {
      if (progOp && progPrevVal !== null) {
        let res = 0n
        try {
          if (progOp === '+') res = progPrevVal + progValue
          else if (progOp === '-') res = progPrevVal - progValue
          else if (progOp === '×' || progOp === '*') res = progPrevVal * progValue
          else if (progOp === '÷' || progOp === '/') res = progValue !== 0n ? progPrevVal / progValue : 0n
          else if (progOp === 'AND') res = progPrevVal & progValue
          else if (progOp === 'OR') res = progPrevVal | progValue
          else if (progOp === 'XOR') res = progPrevVal ^ progValue
          else if (progOp === 'LSH') res = progPrevVal << BigInt(Number(progValue) % 64)
          else if (progOp === 'RSH') res = progPrevVal >> BigInt(Number(progValue) % 64)
          else if (progOp === 'MOD') res = progValue !== 0n ? progPrevVal % progValue : 0n
        } catch {
          res = 0n
        }
        setProgValue(res)
        setDisplay(res.toString(progBase === 'HEX' ? 16 : progBase === 'DEC' ? 10 : progBase === 'OCT' ? 8 : 2).toUpperCase())
        setExpression(`${progPrevVal} ${progOp} ${progValue} =`)
        setProgPrevVal(null)
        setProgOp(null)
        setShouldResetDisplay(true)
      }
      return
    }

    const fullExpr = expression + display
    try {
      const sanitized = fullExpr
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/\^/g, '**')
        .replace(/π/g, `${Math.PI}`)
        .replace(/\be\b/g, `${Math.E}`)

      // 仅允许基础算术字符防止注入
      if (/[^0-9+\-*/().\s*%eE]/.test(sanitized)) {
        setDisplay('Error')
        return
      }

      const fn = new Function(`return (${sanitized})`)
      const res = Number(fn())
      setExpression(fullExpr + ' = ')
      setDisplay(formatNumberOutput(res))
      setShouldResetDisplay(true)
    } catch {
      setDisplay('Error')
    }
  }, [display, expression, mode, progBase, progOp, progPrevVal, progValue])

  // 特殊函数与运算 (sqrt, 1/x, sin, cos 等)
  const handleFunction = useCallback((fn: string) => {
    const val = parseFloat(display)
    if (Number.isNaN(val)) return

    let res = val
    if (fn === 'sqrt') res = Math.sqrt(val)
    else if (fn === 'sqr') res = val * val
    else if (fn === '1/x') res = val !== 0 ? 1 / val : NaN
    else if (fn === '%') res = val / 100
    else if (fn === 'abs') res = Math.abs(val)
    else if (fn === 'ln') res = Math.log(val)
    else if (fn === 'log') res = Math.log10(val)
    else if (fn === 'fact') res = factorial(val)
    else if (fn === 'pi') {
      setDisplay(formatNumberOutput(Math.PI))
      setShouldResetDisplay(true)
      return
    } else if (fn === 'e') {
      setDisplay(formatNumberOutput(Math.E))
      setShouldResetDisplay(true)
      return
    } else if (fn === 'sin') {
      const rad = isRad ? val : (val * Math.PI) / 180
      res = Math.sin(rad)
    } else if (fn === 'cos') {
      const rad = isRad ? val : (val * Math.PI) / 180
      res = Math.cos(rad)
    } else if (fn === 'tan') {
      const rad = isRad ? val : (val * Math.PI) / 180
      res = Math.tan(rad)
    } else if (fn === 'pow') {
      setExpression(display + ' ^ ')
      setShouldResetDisplay(true)
      return
    }

    setDisplay(formatNumberOutput(res))
    setShouldResetDisplay(true)
  }, [display, isRad])

  // 程序员模式运算符
  const handleBitOp = useCallback((op: string) => {
    if (op === 'NOT') {
      const next = ~progValue
      setProgValue(next)
      setDisplay(next.toString(progBase === 'HEX' ? 16 : progBase === 'DEC' ? 10 : progBase === 'OCT' ? 8 : 2).toUpperCase())
      return
    }
    setProgPrevVal(progValue)
    setProgOp(op)
    setExpression(`${display} ${op}`)
    setShouldResetDisplay(true)
  }, [display, progBase, progValue])

  // 物理键盘支持（优先 capture 捕获，彻底杜绝 Vim 模式拦截 0 键）
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      // 忽略真实表单输入框打字（如设置页、登录页、命令框）
      const tag = (e.target as HTMLElement)?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      const inCalc = (e.target as HTMLElement)?.closest?.('[data-calculator-window="true"]')
      if (isInput && !inCalc) return

      const key = e.key
      const code = e.code || ''

      if (key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeCalculator()
        return
      }

      if (key === 'Enter' || key === '=' || code === 'NumpadEnter') {
        e.preventDefault()
        e.stopPropagation()
        handleCalculate()
        return
      }

      if (key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        handleBackspace()
        return
      }

      // 数字键 0-9 以及小键盘 Numpad0-Numpad9（精准放行 0，阻止 Vim 拦截）
      if (/^[0-9]$/.test(key) || /^Numpad[0-9]$/.test(code)) {
        e.preventDefault()
        e.stopPropagation()
        const digit = /^[0-9]$/.test(key) ? key : code.replace('Numpad', '')
        handleInput(digit)
        return
      }

      if (key === '.' || code === 'NumpadDecimal') {
        e.preventDefault()
        e.stopPropagation()
        handleInput('.')
        return
      }

      if (key === '+' || code === 'NumpadAdd') {
        e.preventDefault()
        e.stopPropagation()
        handleInput('+')
        return
      }

      if (key === '-' || code === 'NumpadSubtract') {
        e.preventDefault()
        e.stopPropagation()
        handleInput('-')
        return
      }

      if (key === '*' || key === 'x' || code === 'NumpadMultiply') {
        e.preventDefault()
        e.stopPropagation()
        handleInput('×')
        return
      }

      if (key === '/' || code === 'NumpadDivide') {
        e.preventDefault()
        e.stopPropagation()
        handleInput('÷')
        return
      }

      if (mode === 'programmer' && /^[a-fA-F]$/.test(key) && progBase === 'HEX') {
        e.preventDefault()
        e.stopPropagation()
        handleInput(key.toUpperCase())
      }
    }

    // 在 capture 捕获阶段优先截获，防止下层 Vim 冒号命令或浏览模式阻止传播
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isOpen, handleCalculate, handleBackspace, handleInput, mode, progBase])

  if (!isOpen) return null

  const progBases = getBaseValues(progValue)
  const windowWidthClass = mode === 'scientific' ? 'w-[500px]' : mode === 'programmer' ? 'w-[460px]' : 'w-[380px]'

  return (
    <div
      ref={windowRef}
      data-calculator-window="true"
      style={{
        left: pos?.x ?? 120,
        top: pos?.y ?? 80,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      className={`no-drag fixed z-[99999] flex flex-col rounded-xl border border-line-strong bg-card/98 shadow-[0_24px_64px_rgba(0,0,0,0.45)] backdrop-blur-md select-none text-ink animate-in fade-in zoom-in-95 duration-150 overflow-hidden ${windowWidthClass}`}
    >
      {/* 标题栏与拖拽把柄（标定 no-drag 彻底阻止拖拽整个系统窗口） */}
      <div
        onMouseDown={handleMouseDownHeader}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="no-drag flex items-center justify-between border-b border-line bg-paper/70 px-4 py-2.5 cursor-move"
      >
        <div className="flex items-center gap-2">
          <Calculator size={15} className="text-seal shrink-0" />
          <span className="text-[13px] font-semibold text-ink-strong">{t('计算器')}</span>
          <Move size={12} className="text-ink-faint opacity-50" />
        </div>

        {/* 模式选择 */}
        <div className="flex items-center gap-1 rounded-md bg-line/40 p-0.5 text-[11.5px]">
          <button
            type="button"
            onClick={() => setCalculatorMode('standard')}
            className={`rounded px-2 py-0.5 transition ${
              mode === 'standard' ? 'bg-card font-semibold text-seal shadow-2xs' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t('标准')}
          </button>
          <button
            type="button"
            onClick={() => setCalculatorMode('scientific')}
            className={`rounded px-2 py-0.5 transition ${
              mode === 'scientific' ? 'bg-card font-semibold text-seal shadow-2xs' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t('科学')}
          </button>
          <button
            type="button"
            onClick={() => setCalculatorMode('programmer')}
            className={`rounded px-2 py-0.5 transition ${
              mode === 'programmer' ? 'bg-card font-semibold text-seal shadow-2xs' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t('程序员')}
          </button>
        </div>

        {/* 关闭按钮 */}
        <button
          type="button"
          onClick={closeCalculator}
          title={t('关闭计算器 (:calc)')}
          className="rounded-md p-1 text-ink-soft transition hover:bg-line/60 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      {/* 运算显示屏（加大幅面与大号字体） */}
      <div className="flex flex-col items-end justify-end px-4.5 pt-4 pb-2 border-b border-line/40 bg-card/60 min-h-[96px]">
        <div className="text-[13px] font-mono text-ink-faint h-5 truncate max-w-full">
          {expression}
        </div>
        <div className="text-[36px] font-bold font-mono tracking-tight text-ink-strong truncate max-w-full leading-tight">
          {display}
        </div>
      </div>

      {/* 程序员模式：多进制面板 */}
      {mode === 'programmer' && (
        <div className="flex flex-col border-b border-line/40 bg-paper/30 px-4 py-2 text-[12px] font-mono space-y-1">
          {(['HEX', 'DEC', 'OCT', 'BIN'] as ProgrammerBase[]).map((b) => (
            <div
              key={b}
              onClick={() => {
                setProgBase(b)
                const rad = b === 'HEX' ? 16 : b === 'DEC' ? 10 : b === 'OCT' ? 8 : 2
                setDisplay(progValue.toString(rad).toUpperCase())
              }}
              className={`flex items-center gap-3 px-2 py-1 rounded transition cursor-pointer ${
                progBase === b ? 'bg-seal/15 text-seal font-bold' : 'text-ink-soft hover:bg-line/30'
              }`}
            >
              <span className="w-8 shrink-0 font-semibold">{b}</span>
              <span className="truncate flex-1">
                {b === 'HEX' ? progBases.hex : b === 'DEC' ? progBases.dec : b === 'OCT' ? progBases.oct : progBases.bin}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 键盘区域 */}
      {mode === 'standard' && (
        <StandardKeypad
          onInput={handleInput}
          onClear={handleClear}
          onClearEntry={handleClearEntry}
          onBackspace={handleBackspace}
          onCalculate={handleCalculate}
          onInvertSign={handleInvertSign}
          onFunction={handleFunction}
        />
      )}
      {mode === 'scientific' && (
        <ScientificKeypad
          onInput={handleInput}
          onClear={handleClear}
          onClearEntry={handleClearEntry}
          onBackspace={handleBackspace}
          onCalculate={handleCalculate}
          onInvertSign={handleInvertSign}
          onFunction={handleFunction}
          isRad={isRad}
          onToggleRad={() => setIsRad(!isRad)}
        />
      )}
      {mode === 'programmer' && (
        <ProgrammerKeypad
          base={progBase}
          onInput={handleInput}
          onClear={handleClear}
          onBackspace={handleBackspace}
          onCalculate={handleCalculate}
          onBitOp={handleBitOp}
        />
      )}
    </div>
  )
}
