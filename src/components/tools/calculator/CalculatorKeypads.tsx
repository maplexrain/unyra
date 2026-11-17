import { type ProgrammerBase } from './calculatorEngine'

export interface KeypadProps {
  onInput: (char: string) => void
  onClear: () => void
  onClearEntry: () => void
  onBackspace: () => void
  onCalculate: () => void
  onInvertSign: () => void
  onFunction: (fn: string) => void
}

const BTN_BASE =
  'flex items-center justify-center rounded-lg text-[13px] font-medium transition select-none active:scale-95 cursor-pointer h-9'
const BTN_NUM = `${BTN_BASE} bg-card text-ink hover:bg-line/60 border border-line/40 shadow-2xs`
const BTN_OP = `${BTN_BASE} bg-seal/10 text-seal-deep dark:text-seal-light hover:bg-seal/20 font-semibold border border-seal/20`
const BTN_FN = `${BTN_BASE} bg-paper-deep/60 text-ink-soft hover:bg-line/60 hover:text-ink text-[12px] border border-line/30`
const BTN_EQ = `${BTN_BASE} bg-seal text-white hover:bg-seal-deep font-bold shadow-xs`

export function StandardKeypad({
  onInput,
  onClear,
  onClearEntry,
  onBackspace,
  onCalculate,
  onInvertSign,
  onFunction,
}: KeypadProps) {
  return (
    <div className="grid grid-cols-4 gap-1.5 p-3">
      <button type="button" onClick={() => onFunction('%')} className={BTN_FN}>%</button>
      <button type="button" onClick={onClearEntry} className={BTN_FN}>CE</button>
      <button type="button" onClick={onClear} className={BTN_FN}>C</button>
      <button type="button" onClick={onBackspace} className={BTN_FN}>⌫</button>

      <button type="button" onClick={() => onFunction('1/x')} className={BTN_FN}>1/x</button>
      <button type="button" onClick={() => onFunction('sqr')} className={BTN_FN}>x²</button>
      <button type="button" onClick={() => onFunction('sqrt')} className={BTN_FN}>√x</button>
      <button type="button" onClick={() => onInput('÷')} className={BTN_OP}>÷</button>

      <button type="button" onClick={() => onInput('7')} className={BTN_NUM}>7</button>
      <button type="button" onClick={() => onInput('8')} className={BTN_NUM}>8</button>
      <button type="button" onClick={() => onInput('9')} className={BTN_NUM}>9</button>
      <button type="button" onClick={() => onInput('×')} className={BTN_OP}>×</button>

      <button type="button" onClick={() => onInput('4')} className={BTN_NUM}>4</button>
      <button type="button" onClick={() => onInput('5')} className={BTN_NUM}>5</button>
      <button type="button" onClick={() => onInput('6')} className={BTN_NUM}>6</button>
      <button type="button" onClick={() => onInput('-')} className={BTN_OP}>−</button>

      <button type="button" onClick={() => onInput('1')} className={BTN_NUM}>1</button>
      <button type="button" onClick={() => onInput('2')} className={BTN_NUM}>2</button>
      <button type="button" onClick={() => onInput('3')} className={BTN_NUM}>3</button>
      <button type="button" onClick={() => onInput('+')} className={BTN_OP}>+</button>

      <button type="button" onClick={onInvertSign} className={BTN_NUM}>±</button>
      <button type="button" onClick={() => onInput('0')} className={BTN_NUM}>0</button>
      <button type="button" onClick={() => onInput('.')} className={BTN_NUM}>.</button>
      <button type="button" onClick={onCalculate} className={BTN_EQ}>=</button>
    </div>
  )
}

export function ScientificKeypad({
  onInput,
  onClear,
  onClearEntry: _ce,
  onBackspace,
  onCalculate,
  onInvertSign,
  onFunction,
  isRad,
  onToggleRad,
}: KeypadProps & { isRad: boolean; onToggleRad: () => void }) {
  return (
    <div className="grid grid-cols-5 gap-1 p-2.5 text-[11.5px]">
      <button type="button" onClick={onToggleRad} className={`${BTN_FN} text-[10.5px] font-bold text-seal`}>
        {isRad ? 'RAD' : 'DEG'}
      </button>
      <button type="button" onClick={() => onFunction('sin')} className={BTN_FN}>sin</button>
      <button type="button" onClick={() => onFunction('cos')} className={BTN_FN}>cos</button>
      <button type="button" onClick={() => onFunction('tan')} className={BTN_FN}>tan</button>
      <button type="button" onClick={() => onFunction('pi')} className={BTN_FN}>π</button>

      <button type="button" onClick={() => onInput('(')} className={BTN_FN}>(</button>
      <button type="button" onClick={() => onInput(')')} className={BTN_FN}>)</button>
      <button type="button" onClick={() => onFunction('ln')} className={BTN_FN}>ln</button>
      <button type="button" onClick={() => onFunction('log')} className={BTN_FN}>log</button>
      <button type="button" onClick={() => onFunction('e')} className={BTN_FN}>e</button>

      <button type="button" onClick={() => onFunction('pow')} className={BTN_FN}>x^y</button>
      <button type="button" onClick={() => onFunction('fact')} className={BTN_FN}>n!</button>
      <button type="button" onClick={() => onFunction('sqrt')} className={BTN_FN}>√</button>
      <button type="button" onClick={onClear} className={BTN_FN}>C</button>
      <button type="button" onClick={onBackspace} className={BTN_FN}>⌫</button>

      <button type="button" onClick={() => onFunction('1/x')} className={BTN_FN}>1/x</button>
      <button type="button" onClick={() => onInput('7')} className={BTN_NUM}>7</button>
      <button type="button" onClick={() => onInput('8')} className={BTN_NUM}>8</button>
      <button type="button" onClick={() => onInput('9')} className={BTN_NUM}>9</button>
      <button type="button" onClick={() => onInput('÷')} className={BTN_OP}>÷</button>

      <button type="button" onClick={() => onFunction('sqr')} className={BTN_FN}>x²</button>
      <button type="button" onClick={() => onInput('4')} className={BTN_NUM}>4</button>
      <button type="button" onClick={() => onInput('5')} className={BTN_NUM}>5</button>
      <button type="button" onClick={() => onInput('6')} className={BTN_NUM}>6</button>
      <button type="button" onClick={() => onInput('×')} className={BTN_OP}>×</button>

      <button type="button" onClick={() => onFunction('abs')} className={BTN_FN}>|x|</button>
      <button type="button" onClick={() => onInput('1')} className={BTN_NUM}>1</button>
      <button type="button" onClick={() => onInput('2')} className={BTN_NUM}>2</button>
      <button type="button" onClick={() => onInput('3')} className={BTN_NUM}>3</button>
      <button type="button" onClick={() => onInput('-')} className={BTN_OP}>−</button>

      <button type="button" onClick={onInvertSign} className={BTN_FN}>±</button>
      <button type="button" onClick={() => onInput('0')} className={BTN_NUM}>0</button>
      <button type="button" onClick={() => onInput('.')} className={BTN_NUM}>.</button>
      <button type="button" onClick={() => onInput('+')} className={BTN_OP}>+</button>
      <button type="button" onClick={onCalculate} className={BTN_EQ}>=</button>
    </div>
  )
}

export function ProgrammerKeypad({
  base,
  onInput,
  onClear,
  onBackspace,
  onCalculate,
  onBitOp,
}: {
  base: ProgrammerBase
  onInput: (char: string) => void
  onClear: () => void
  onBackspace: () => void
  onCalculate: () => void
  onBitOp: (op: string) => void
}) {
  const isHexActive = base === 'HEX'
  const isDecActive = base === 'HEX' || base === 'DEC'
  const isOctActive = base === 'HEX' || base === 'DEC' || base === 'OCT'

  return (
    <div className="grid grid-cols-5 gap-1 p-2.5 text-[12px]">
      {/* 行 1: 位运算与清屏 */}
      <button type="button" onClick={() => onBitOp('AND')} className={BTN_FN}>AND</button>
      <button type="button" onClick={() => onBitOp('OR')} className={BTN_FN}>OR</button>
      <button type="button" onClick={() => onBitOp('NOT')} className={BTN_FN}>NOT</button>
      <button type="button" onClick={onClear} className={BTN_FN}>C</button>
      <button type="button" onClick={onBackspace} className={BTN_FN}>⌫</button>

      {/* 行 2: 移位与十六进制 A, B */}
      <button type="button" onClick={() => onBitOp('XOR')} className={BTN_FN}>XOR</button>
      <button type="button" onClick={() => onBitOp('LSH')} className={BTN_FN}>Lsh</button>
      <button type="button" onClick={() => onBitOp('RSH')} className={BTN_FN}>Rsh</button>
      <button
        type="button"
        disabled={!isHexActive}
        onClick={() => onInput('A')}
        className={`${BTN_NUM} ${!isHexActive ? 'opacity-30 cursor-not-allowed' : 'font-bold'}`}
      >
        A
      </button>
      <button
        type="button"
        disabled={!isHexActive}
        onClick={() => onInput('B')}
        className={`${BTN_NUM} ${!isHexActive ? 'opacity-30 cursor-not-allowed' : 'font-bold'}`}
      >
        B
      </button>

      {/* 行 3: 十六进制 C, D 与 7, 8, 9 */}
      <button
        type="button"
        disabled={!isHexActive}
        onClick={() => onInput('C')}
        className={`${BTN_NUM} ${!isHexActive ? 'opacity-30 cursor-not-allowed' : 'font-bold'}`}
      >
        C
      </button>
      <button
        type="button"
        disabled={!isHexActive}
        onClick={() => onInput('D')}
        className={`${BTN_NUM} ${!isHexActive ? 'opacity-30 cursor-not-allowed' : 'font-bold'}`}
      >
        D
      </button>
      <button
        type="button"
        disabled={!isOctActive}
        onClick={() => onInput('7')}
        className={`${BTN_NUM} ${!isOctActive ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        7
      </button>
      <button
        type="button"
        disabled={!isDecActive}
        onClick={() => onInput('8')}
        className={`${BTN_NUM} ${!isDecActive ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        8
      </button>
      <button
        type="button"
        disabled={!isDecActive}
        onClick={() => onInput('9')}
        className={`${BTN_NUM} ${!isDecActive ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        9
      </button>

      {/* 行 4: 十六进制 E, F 与 4, 5, 6 */}
      <button
        type="button"
        disabled={!isHexActive}
        onClick={() => onInput('E')}
        className={`${BTN_NUM} ${!isHexActive ? 'opacity-30 cursor-not-allowed' : 'font-bold'}`}
      >
        E
      </button>
      <button
        type="button"
        disabled={!isHexActive}
        onClick={() => onInput('F')}
        className={`${BTN_NUM} ${!isHexActive ? 'opacity-30 cursor-not-allowed' : 'font-bold'}`}
      >
        F
      </button>
      <button
        type="button"
        disabled={!isOctActive}
        onClick={() => onInput('4')}
        className={`${BTN_NUM} ${!isOctActive ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        4
      </button>
      <button
        type="button"
        disabled={!isOctActive}
        onClick={() => onInput('5')}
        className={`${BTN_NUM} ${!isOctActive ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        5
      </button>
      <button
        type="button"
        disabled={!isOctActive}
        onClick={() => onInput('6')}
        className={`${BTN_NUM} ${!isOctActive ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        6
      </button>

      {/* 行 5: 运算符与 1, 2, 3 */}
      <button type="button" onClick={() => onInput('÷')} className={BTN_OP}>÷</button>
      <button type="button" onClick={() => onInput('×')} className={BTN_OP}>×</button>
      <button type="button" onClick={() => onInput('1')} className={BTN_NUM}>1</button>
      <button
        type="button"
        disabled={!isOctActive}
        onClick={() => onInput('2')}
        className={`${BTN_NUM} ${!isOctActive ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        2
      </button>
      <button
        type="button"
        disabled={!isOctActive}
        onClick={() => onInput('3')}
        className={`${BTN_NUM} ${!isOctActive ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        3
      </button>

      {/* 行 6: 减加与 0, =, MOD */}
      <button type="button" onClick={() => onInput('-')} className={BTN_OP}>−</button>
      <button type="button" onClick={() => onInput('+')} className={BTN_OP}>+</button>
      <button type="button" onClick={() => onBitOp('MOD')} className={BTN_FN}>%</button>
      <button type="button" onClick={() => onInput('0')} className={BTN_NUM}>0</button>
      <button type="button" onClick={onCalculate} className={BTN_EQ}>=</button>
    </div>
  )
}
