/**
 * 聊天正文的「简短 / 详细」双层语法。
 *
 * 约定：单独一行 `---` 作为分隔线；前面是给用户默认看到的口语化短句，后面是
 * 依据、索引名、标识符、专业词汇等详细内容。渲染层默认只显示短句，用户可切换展开。
 * 分隔线在代码围栏（``` / ~~~）里时不算分隔线，避免把代码里的水平线拆开。
 */
export interface ChatTextParts {
  brief: string
  detail: string
}

function fenceMarkOf(line: string): '```' | '~~~' | null {
  const trimmed = line.trim()
  if (trimmed.startsWith('```')) return '```'
  if (trimmed.startsWith('~~~')) return '~~~'
  return null
}

export function splitChatText(text: string): ChatTextParts {
  const normalized = text.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  let fence: '```' | '~~~' | null = null

  for (let i = 0; i < lines.length; i++) {
    const mark = fenceMarkOf(lines[i]!)
    if (mark) {
      if (!fence) fence = mark
      else if (fence === mark) fence = null
      continue
    }
    if (fence) continue
    if (lines[i]!.trim() !== '---') continue

    const brief = lines.slice(0, i).join('\n').trim()
    const detail = lines.slice(i + 1).join('\n').trim()
    if (brief && detail) return { brief, detail }
  }

  return { brief: normalized.trim(), detail: '' }
}
