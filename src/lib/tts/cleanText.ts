/**
 * 用于 TTS 朗读的文本预清洗工具：
 * 将 Markdown 标记、代码块、LaTeX 公式包裹符、URL 外链等机械噪音剥离，
 * 转换成适合人类耳朵收听的自然流畅口语文本。
 */

export function cleanTextForSpeech(raw: string): string {
  if (!raw) return ''

  let text = raw

  // 1. 移除多行代码块与思维链标签
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  text = text.replace(/```[\s\S]*?```/g, ' [代码块已略过] ')

  // 2. 移除行内代码 `code`
  text = text.replace(/`([^`]+)`/g, '$1')

  // 3. 移除 Markdown 图片 ![alt](url) 与 链接 [text](url)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // 4. 清理 LaTeX 公式符号：$$公式$$ 或 $公式$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, ' 公式：$1 ')
  text = text.replace(/\$([^$]+)\$/g, '$1')
  text = text.replace(/\\\(|\\\)/g, '')
  text = text.replace(/\\\[|\\\]/g, '')

  // 5. 移除 Markdown 标题标记（#）、引用标记（>）、无序列表符号（- * +）与水平分割线
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^>\s+/gm, '')
  text = text.replace(/^[-*+]\s+/gm, '')
  text = text.replace(/^---+$|^\*\*\*+$/gm, '')

  // 6. 移除加粗与斜体标记 **bold** *italic*
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
  text = text.replace(/(\*|_)(.*?)\1/g, '$2')

  // 7. 移除 HTML 标签与连续多余空白
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/\s+/g, ' ').trim()

  return text
}
