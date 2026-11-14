/**
 * DeepSeek OCR 版面识别的 grounding 解析（pdfTextLayer 的 parseGroundingLines）。
 *
 * **真实输出格式**（2026-11-14 用户实测返回为准；官方文档示例里的 ref 内容有歧义）：
 *
 *   `<|ref|>类别<|/ref|><|box|>[[x1,y1,x2,y2]]<|/box|>＞ 该区域的文字`
 *
 * ref 对里是**类别名**（header/title/text/image/footer/page_number…），
 * **正文在 box 对之后**、每块以 ＞ 开头；坐标 0–1000 归一化、左上原点。
 * 第三版之前的两轮返工（det 格式 / ref-即-内容）都输在「拿记忆猜格式」上。
 */

import { describe, expect, it } from 'vitest'
import { parseGroundingLines } from '../src/lib/ocr/pdfTextLayer'

describe('DeepSeek OCR grounding 解析（实测 ref=类别 + box 后正文）', () => {
  const LINE =
    '<|ref|>header<|/ref|><|box|>[[115,52,240,81]]<|/box|>＞ 希赛'
    + '\n<|ref|>title<|/ref|><|box|>[[131,101,897,133]]<|/box|>＞ 2024年下半年信息安全工程师考试上午真题'
    + '\n<|ref|>image<|/ref|><|box|>[[444,199,548,270]]<|/box|>＞ '
    + '\n<|ref|>text<|/ref|><|box|>[[444,257,548,275]]<|/box|>＞ 免费在线估分'

  it('实测样例：类别进不了文字、正文从 box 之后取、image 跳过', () => {
    const lines = parseGroundingLines(LINE)
    expect(lines).not.toBeNull()
    // header + title + text = 3 行；image（纯图形）不挂
    expect(lines!.length).toBe(3)
    expect(lines![0].text).toBe('希赛')
    expect(lines![0].bbox.x).toBeCloseTo(0.115)
    expect(lines![0].bbox.y).toBeCloseTo(0.052)
    expect(lines![0].bbox.width).toBeCloseTo(0.125)
    expect(lines![0].bbox.height).toBeCloseTo(0.029)
    expect(lines![1].text).toBe('2024年下半年信息安全工程师考试上午真题')
    expect(lines![1].bbox.y).toBeCloseTo(0.101)
    expect(lines![2].text).toBe('免费在线估分')
  })

  it('复制出来不再是类别名：挂贴文字 = 正文，不是 header/title/text', () => {
    const lines = parseGroundingLines(LINE)
    const joined = lines!.map((l) => l.text).join('')
    expect(joined).not.toContain('header')
    expect(joined).not.toContain('title')
    expect(joined).not.toContain('text')
  })

  it('长题干块：正文单行长句按盒宽约束缩字号（挂贴不溢出）', () => {
    const lines = parseGroundingLines(
      '<|ref|>text<|/ref|><|box|>[[115,385,995,445]]<|/box|>＞ 我国的国家标准《计算机信息系统安全保护等级划分准则（GB 17859）》将计算机信息系统安全保护等级分为五级。',
    )
    expect(lines).not.toBeNull()
    expect(lines!.length).toBe(1)
    expect(lines![0].bbox.width).toBeCloseTo(0.88)
  })

  it('选项块逐条一行（实测的 A/B/C/D）', () => {
    const lines = parseGroundingLines(
      '<|ref|>text<|/ref|><|box|>[[115,479,190,491]]<|/box|>＞ A、第一级'
        + '\n<|ref|>text<|/ref|><|box|>[[115,506,190,517]]<|/box|>＞ B、第二级',
    )
    expect(lines).not.toBeNull()
    expect(lines!.length).toBe(2)
    expect(lines![0].text).toBe('A、第一级')
    expect(lines![1].text).toBe('B、第二级')
    expect(lines![1].bbox.y).toBeCloseTo(0.506)
  })

  it('全角竖线原样（服务端实际发出的形态）', () => {
    const lines = parseGroundingLines(
      '<｜ref｜>footer<｜/ref｜><｜box｜>[[115,925,355,942]]<｜/box｜>＞ 希赛网—专业的在线职业教育平台',
    )
    expect(lines).not.toBeNull()
    expect(lines![0].text).toBe('希赛网—专业的在线职业教育平台')
  })

  it('正文行内的半角 > 不误伤（只剥行首前缀）', () => {
    const lines = parseGroundingLines('<|ref|>text<|/ref|><|box|>[[10,10,900,60]]<|/box|>＞ 比较 a > b 的大小')
    expect(lines).not.toBeNull()
    // cleanOcrText 会剥 CJK 与字母间的假空格（既定规则），但行中间的 > 原样保留
    expect(lines![0].text).toBe('比较a > b的大小')
  })

  it('无标记（快速识别档）返回 null——不挂贴，原始返回由调用方带给诊断层', () => {
    expect(parseGroundingLines('纯文本第一行\n纯文本第二行')).toBeNull()
  })
})
