// oxlint-disable react/only-export-components -- 开发用夹具：它只在探针里被 esbuild 打一次，没有热更新
/**
 * 顶栏对齐探针的**夹具入口**（开发用，不进任何构建产物）。
 *
 * 它把三颗顶栏入口用**真实组件**渲染出来，交给 scripts/topbar-align.mjs 在 Electron 里
 * 量每段文字的位置。为什么不手抄标记：手抄的副本会与组件漂移，而这里渲染的就是
 * components/learn/*Button.tsx 本人——量到的差异一定是真的。
 */
import { createRoot } from 'react-dom/client'

import CheckinButton, { type CheckinCalendarDay } from '../src/components/learn/CheckinButton'
import PomodoroButton from '../src/components/learn/PomodoroButton'
import ReadingButton from '../src/components/learn/ReadingButton'

const days: CheckinCalendarDay[] = Array.from({ length: 28 }, (_, i) => ({
  day: '2026-09-' + String(i + 1).padStart(2, '0'),
  label: i + 1,
  state: i % 7 === 3 ? 'passed' : i % 5 === 2 ? 'failed' : 'none',
  ...(i === 27 ? { today: true } : {}),
}))

function Fixture() {
  return (
    <div className="flex min-h-screen flex-col gap-6 bg-paper p-4">
      <div className="flex items-center gap-1.5" data-row="运行中">
        <PomodoroButton
          running={{ phase: 'focus', index: 1, groups: 3, focusMinutes: 25 }}
          remainingMs={988_000}
          phaseMs={1_500_000}
          focusMinutes={25}
          groups={3}
          onFocusMinutes={() => {}}
          onGroups={() => {}}
          onStart={() => {}}
          onStop={() => {}}
        />
        <ReadingButton todayMs={1_895_000} nodes={[]} week={[]} weekMinutes={0} onOpenNode={() => {}} />
        <CheckinButton
          done
          chancesLeft={2}
          blocked={null}
          calendar={days}
          monthLabel="2026 年 9 月"
          todayWeekday={6}
          onCheckin={() => {}}
        />
      </div>
      <div className="flex items-center gap-1.5" data-row="休息中">
        <PomodoroButton
          running={{ phase: 'rest', index: 1, groups: 3, focusMinutes: 25 }}
          remainingMs={62_000}
          phaseMs={300_000}
          focusMinutes={25}
          groups={3}
          onFocusMinutes={() => {}}
          onGroups={() => {}}
          onStart={() => {}}
          onStop={() => {}}
        />
        <ReadingButton todayMs={0} nodes={[]} week={[]} weekMinutes={0} onOpenNode={() => {}} />
        <CheckinButton
          done={false}
          chancesLeft={3}
          blocked={null}
          calendar={days}
          monthLabel="2026 年 9 月"
          todayWeekday={6}
          onCheckin={() => {}}
        />
      </div>
    </div>
  )
}

const el = document.getElementById('root')
if (el) createRoot(el).render(<Fixture />)
