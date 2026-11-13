import { useState, useCallback, useRef } from 'react'
import { VIM_TUTOR_LEVELS, type TutorLevel } from './vimTutorLevels'

export interface KeyStrokeRecord {
  id: number
  key: string
  time: number
}

export function useVimGameEngine() {
  const [levelIndex, setLevelIndex] = useState(0)
  const currentLevel: TutorLevel = VIM_TUTOR_LEVELS[levelIndex] ?? VIM_TUTOR_LEVELS[0]

  const [collectedDiamonds, setCollectedDiamonds] = useState<string[]>([])
  const [isLevelCleared, setIsLevelCleared] = useState(false)
  const [stepCount, setStepCount] = useState(0)
  const [keyHistory, setKeyHistory] = useState<KeyStrokeRecord[]>([])
  const [vimMode, setVimMode] = useState<'NORMAL' | 'INSERT' | 'VISUAL'>('NORMAL')
  const keyCounter = useRef(0)

  // 记录按键并呈现在按键显示条
  const recordKeyStroke = useCallback((key: string) => {
    keyCounter.current += 1
    const record: KeyStrokeRecord = {
      id: keyCounter.current,
      key,
      time: Date.now(),
    }
    setKeyHistory((prev) => [...prev.slice(-7), record])
  }, [])

  // 重置当前关卡状态
  const restartLevel = useCallback(() => {
    setCollectedDiamonds([])
    setIsLevelCleared(false)
    setStepCount(0)
    setVimMode('NORMAL')
  }, [])

  // 切换关卡
  const selectLevel = useCallback((index: number) => {
    if (index >= 0 && index < VIM_TUTOR_LEVELS.length) {
      setLevelIndex(index)
      setCollectedDiamonds([])
      setIsLevelCleared(false)
      setStepCount(0)
      setVimMode('NORMAL')
    }
  }, [])

  const nextLevel = useCallback(() => {
    if (levelIndex < VIM_TUTOR_LEVELS.length - 1) {
      selectLevel(levelIndex + 1)
    }
  }, [levelIndex, selectLevel])

  const prevLevel = useCallback(() => {
    if (levelIndex > 0) {
      selectLevel(levelIndex - 1)
    }
  }, [levelIndex, selectLevel])

  // 处理光标移动（在迷宫关或踩点关判定收集与抵达终点）
  const handleCursorMove = useCallback(
    (row: number, col: number) => {
      setStepCount((c) => c + 1)
      if (isLevelCleared) return

      const meta = currentLevel.meta

      // 1. 灵石 / 星标收集判定
      if (meta.diamonds && meta.diamonds.length > 0) {
        for (const dia of meta.diamonds) {
          // 在目标周围 ±1 列容差范围内判定为踩中
          if (dia.row === row && Math.abs(dia.col - col) <= 1) {
            setCollectedDiamonds((prev) => {
              if (prev.includes(dia.id)) return prev
              const next = [...prev, dia.id]
              return next
            })
          }
        }
      }

      // 2. 传送门 / 终点判定
      if (meta.goalPortal) {
        const portal = meta.goalPortal
        const reached = portal.row === row && Math.abs(portal.col - col) <= 2
        const allDiamondsGot =
          !meta.diamonds || collectedDiamonds.length >= meta.diamonds.length
        if (reached && allDiamondsGot) {
          setIsLevelCleared(true)
        }
      }
    },
    [currentLevel, isLevelCleared, collectedDiamonds],
  )

  // 处理文本改动判定（修改代码、斩除错字符、复制粘贴）
  const handleDocChange = useCallback(
    (docText: string) => {
      if (isLevelCleared) return
      const meta = currentLevel.meta

      // 期望包含文本
      if (meta.expectedText && docText.includes(meta.expectedText)) {
        setIsLevelCleared(true)
        return
      }

      // 禁止包含违禁字符（如错字 🐛 已全部消灭）
      if (meta.forbiddenChars && meta.forbiddenChars.length > 0) {
        const hasForbidden = meta.forbiddenChars.some((char) => docText.includes(char))
        if (!hasForbidden) {
          setIsLevelCleared(true)
          return
        }
      }

      // 目标词组复印（如祭坛处多出了一份金币行）
      if (meta.targetWords && meta.targetWords.length > 0) {
        const matchesAll = meta.targetWords.every((word) => {
          const count = (docText.match(new RegExp(word, 'g')) || []).length
          return count >= 2
        })
        if (matchesAll) {
          setIsLevelCleared(true)
          return
        }
      }
    },
    [currentLevel, isLevelCleared],
  )

  // 处理命令达成（如折叠或 :w）
  const handleVimCommand = useCallback(
    (commandName: string) => {
      if (isLevelCleared) return
      if (currentLevel.meta.commandMatch) {
        if (
          commandName === currentLevel.meta.commandMatch ||
          commandName === currentLevel.meta.commandMatch.replace(':', '')
        ) {
          setIsLevelCleared(true)
        }
      }
    },
    [currentLevel, isLevelCleared],
  )

  return {
    levelIndex,
    currentLevel,
    totalLevels: VIM_TUTOR_LEVELS.length,
    collectedDiamonds,
    isLevelCleared,
    stepCount,
    keyHistory,
    vimMode,
    setVimMode,
    recordKeyStroke,
    restartLevel,
    selectLevel,
    nextLevel,
    prevLevel,
    handleCursorMove,
    handleDocChange,
    handleVimCommand,
  }
}
