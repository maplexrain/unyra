/**
 * 挂贴文字层的字号自适应（pdfTextLayer 的 fitFontSize）：
 * 透明 span 按「行盒高」算字号时，大字标题的渲染宽度会超过盒子——溢出页面容器的
 * 部分被 overflow-hidden 裁掉，看不见也选不中，复制就缺字（真案：标题只出前半句）。
 * 字号按「盒高 ÷ 宽度约束字号（ratio）」分两支：
 * - ratio ≤ 2.6（单行 det 盒的常态）：min(盒宽÷权重, 盒高)；
 * - ratio > 2.6（服务端把画布多行合成一行长句，det 盒覆盖 k 行）：面积法
 *   sqrt(盒宽×盒高÷1.9÷权重)——宽高取小会把这种块的字号压到画布一半（真案）。
 */

import { describe, expect, it } from 'vitest'
import { fitFontSize } from '../src/lib/ocr/pdfTextLayer'

describe('挂贴字号自适应 (fitFontSize)', () => {
  const TITLE = '2024年下半年信息安全工程师考试上午真题' // 21 字符：17 全角 + 4 个 ASCII 数字 → 权重 19.2

  it('大字标题：宽度约束生效，透明文本不再溢出盒子', () => {
    // 盒宽 665px、盒高 60px：ratio = 60/34.6 ≈ 1.73 ≤ 2.6 → 单行分支
    const size = fitFontSize(TITLE, 665, 60)
    expect(size).toBeCloseTo(665 / 19.2, 1)
    // 按权重渲染的总宽不超过盒宽（容忍浮点）
    expect(TITLE.split('').reduce((w, c) => w + (/[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFF60\u2010-\u2027]/.test(c) ? 1 : 0.55), 0) * size).toBeLessThanOrEqual(665 + 0.5)
  })

  it('短行：高度约束生效（宽度约束不会把短行字号撑大）', () => {
    // 段落最后一行只有 2 个字，按块宽算字号会巨大——被行高钳住
    expect(fitFontSize('完。', 800, 30)).toBe(30)
  })

  it('英文按 0.55 权重近似：约两字符抵一个全角', () => {
    // 'hello world' 11 个 ASCII 字符 → 权重 6.05；盒宽 300 → byWidth ≈ 49.6，被行高 30 钳住
    expect(fitFontSize('hello world', 300, 30)).toBe(30)
    // 行高很大时宽度约束生效
    expect(fitFontSize('hello world', 300, 80)).toBeCloseTo(300 / (11 * 0.55), 1)
  })

  it('多行合并：正文一行但盒高远超单行行盒——按面积+行距反推，不再被宽度约束压半', () => {
    // 真案：题干 det 盒 572×55 覆盖画布两行（真实字号 ~14），服务端正文一行 ~70 全角字符
    // 旧逻辑 min(572/70, 55) ≈ 8.2（只有画布一半大）；ratio = 55/8.2 = 6.7 > 2.6
    // → 面积法 sqrt(572×55/(1.9×weight)) ≈ 15
    const size = fitFontSize('我国的国家标准《计算机信息系统安全保护等级划分准则》将信息系统安全保护等级分为五级，规定从（）开始要求提供审计功能。', 572, 55)
    expect(size).toBeGreaterThan(13)
    expect(size).toBeLessThan(18)
  })

  it('短行不被面积法误伤（ratio 正常走单行分支）', () => {
    // 「1、」块：盒 15.6×12.9、权重 1.55 → byWidth ≈ 10.1，ratio ≈ 1.28 ≤ 2.6 → 单行分支
    expect(fitFontSize('1、', 15.6, 12.9)).toBeCloseTo(10.1, 0)
  })

  it('极端窄盒走多行分支也不炸：下限 8px', () => {
    // ratio = 100/1.43 = 70 → 面积法 sqrt(10×100/1.9/7) ≈ 8.67（仍 ≥ 下限 8）
    expect(fitFontSize('十个字的这一行', 10, 100)).toBeCloseTo(8.67, 1)
  })
})
