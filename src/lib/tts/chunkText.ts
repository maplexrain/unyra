/**
 * 用于 TTS 语音合成的长文本智能分句工具。
 *
 * 为什么需要分句：
 * 1. 端侧神经网络（如 VITS / MeloTTS / AISHELL-3）的设计舒适区间为 20~80 字符的自然单句；
 *    一次性塞入成百上千字会导致注意力矩阵过大、运算耗时呈非线性剧增，甚至超出底层 ONNX 上限崩溃卡死。
 * 2. 分句后支持边播边合成（Pipeline Streaming）：先合成第一句立刻开播，首字延迟从几十秒降至 300ms，
 *    在播放第一句时预合成后续句子，实现无缝衔接。
 */

const DEFAULT_MAX_CHARS = 80
const MIN_SPLIT_CHARS = 15

/** 优先在句末主标点处切断（标点保留在句末） */
const PRIMARY_PUNCTUATION = /([。！？；…\n]+|[.!?;\n]+)/g

/** 句子过长时在次级停顿标点处切断 */
const SECONDARY_PUNCTUATION = /([，,：:、—]+)/g

export function splitTextIntoSpeechChunks(text: string, maxChars = DEFAULT_MAX_CHARS): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  // 若文本本身较短，直接作为单句返回
  if (trimmed.length <= maxChars) {
    return [trimmed]
  }

  // 1. 先按主标点拆分
  const rawSegments: string[] = []
  let lastIndex = 0

  trimmed.replace(PRIMARY_PUNCTUATION, (match, _p, offset) => {
    const end = offset + match.length
    const part = trimmed.slice(lastIndex, end).trim()
    if (part) rawSegments.push(part)
    lastIndex = end
    return match
  })

  if (lastIndex < trimmed.length) {
    const tail = trimmed.slice(lastIndex).trim()
    if (tail) rawSegments.push(tail)
  }

  // 2. 针对过长的句子做次级拆分或按最大字符截断
  const result: string[] = []

  for (const seg of rawSegments) {
    if (seg.length <= maxChars) {
      // 合并过短的碎片（如只有一两个字的短语气词），避免发音过于破碎
      const prev = result[result.length - 1]
      if (prev && prev.length + seg.length <= maxChars && prev.length < MIN_SPLIT_CHARS) {
        result[result.length - 1] = prev + ' ' + seg
      } else {
        result.push(seg)
      }
      continue
    }

    // 次级标点拆分
    let subLast = 0
    let hasSub = false
    seg.replace(SECONDARY_PUNCTUATION, (m, _p, offset) => {
      hasSub = true
      const end = offset + m.length
      const sub = seg.slice(subLast, end).trim()
      if (sub) {
        if (sub.length <= maxChars) {
          result.push(sub)
        } else {
          // 极长无标点段：按 maxChars 强行平分
          sliceHard(sub, maxChars, result)
        }
      }
      subLast = end
      return m
    })

    if (subLast < seg.length) {
      const rest = seg.slice(subLast).trim()
      if (rest) {
        if (rest.length <= maxChars) {
          result.push(rest)
        } else {
          sliceHard(rest, maxChars, result)
        }
      }
    }

    if (!hasSub) {
      sliceHard(seg, maxChars, result)
    }
  }

  return result.filter(Boolean)
}

function sliceHard(str: string, max: number, out: string[]): void {
  let cur = str.trim()
  while (cur.length > max) {
    // 尽量在空格处切断
    const spaceIdx = cur.lastIndexOf(' ', max)
    const cutPos = spaceIdx > max / 2 ? spaceIdx + 1 : max
    const piece = cur.slice(0, cutPos).trim()
    if (piece) out.push(piece)
    cur = cur.slice(cutPos).trim()
  }
  if (cur) out.push(cur)
}
