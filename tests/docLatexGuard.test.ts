import { describe, expect, it } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { DocGNode, type NodeCtx } from '../src/learn/nodeKinds'
import { findLatexDamage, latexDamageError } from '../src/learn/nodeKinds/latexGuard'

/* ---------- 夹具：一个目标 + 一份文档 ---------- */

function fixture() {
  const node: KnowledgeNode = {
    id: 'n1',
    title: '扇出比',
    key: '扇出比',
    description: '',
    docs: { teaching: '# 旧正文' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'ai',
    goalId: 'g1',
    createdAt: 1,
    updatedAt: 1,
  }
  let store: LearnStore = {
    ...emptyLearnStore(),
    goals: [{ id: 'g1', rootNodeId: 'n1', question: '学扇出比', createdAt: 1, updatedAt: 1 }],
    nodes: [node],
  }
  const ctx: NodeCtx = {
    store: () => store,
    commit: (next) => {
      store = next
    },
    goalId: () => 'g1',
    objectOf: () => undefined,
  }
  return {
    doc: new DocGNode(ctx, 'n1'),
    teaching: () => store.nodes[0].docs.teaching,
  }
}

/* ---------- 指纹识别 ---------- */

describe('findLatexDamage：认出 JS 转义吃反斜杠留下的指纹', () => {
  it('issue #198 的原样损坏：\\text/\\times 的 TAB、\\frac 的 FF、裸 approx', () => {
    const damaged = ['$$', '\u0009ext{扇出比 } F approx ', '\u000crac{数据页净可用空间}{主键长度 + 指针长度}', '$$'].join('')
    const findings = findLatexDamage(damaged)
    const reasons = findings.map((f) => f.reason).join('\n')
    expect(findings.length).toBeGreaterThanOrEqual(3)
    expect(reasons).toContain('[TAB]')
    expect(reasons).toContain('[FF]')
    expect(reasons).toContain('approx')
    // 错误信息里要把控制字符画出来，Agent 才定位得到
    expect(findings[0].snippet).toContain('[TAB]')
  })

  it('\\beta 的退格与 \\rho 的孤立回车也能认出来，行号按原文数', () => {
    const beta = findLatexDamage('# 标题\n\n公式 $\u0008eta$ 坏了')
    expect(beta).toHaveLength(1)
    expect(beta[0].line).toBe(3)
    expect(beta[0].reason).toContain('[BS]')

    const rho = findLatexDamage('第一行\n公式 ' + String.raw`$\rho$` + ' 正常，但 $\u000dho$ 坏了')
    expect(rho).toHaveLength(1)
    expect(rho[0].reason).toContain('[CR]')
  })

  it('公式内的制表符算损坏，代码块与行内代码里的不算', () => {
    expect(findLatexDamage('$a\u0009b$')).toHaveLength(1)
    expect(findLatexDamage(['```text', '$a\u0009b approx$', '```'].join('\n'))).toEqual([])
    expect(findLatexDamage('正文 `$a\u0009b approx$` 结束')).toEqual([])
  })

  it('正常公式不误伤：修好的扇出比、\\text 里的英文散文、\\alpha、货币 $', () => {
    const ok = [
      String.raw`$$\text{扇出比 } F \approx \frac{\text{数据页净可用空间}}{\text{主键长度} + \text{指针长度（约 6 字节）}}$$`,
      String.raw`$1170 \times 1170 \approx \mathbf{1{,}368{,}900}$`,
      String.raw`$\text{left and right, sum and int are English words}$`,
      String.raw`正文提到 $x \in A$ 与 $\alpha + \beta$。`,
      '价格 $5 到 $10。',
    ].join('\n')
    expect(findLatexDamage(ok)).toEqual([])
  })
})

/* ---------- 写入闸门 ---------- */

describe('DocGNode.editContent：公式损坏时整笔拒绝，正文保持原样', () => {
  it('坏公式不落盘；修好后正常写入', () => {
    const h = fixture()
    const damaged = '$$\u0009ext{扇出比 } F approx \u000crac{数据页}{主键}$$'
    const bad = h.doc.editContent({ title: '扇出比', description: '', teaching: damaged })
    expect(bad).toMatchObject({ error: expect.stringContaining('疑似公式损坏') })
    expect(h.teaching()).toBe('# 旧正文')

    const fixed = String.raw`$$\text{扇出比 } F \approx \frac{\text{数据页}}{\text{主键}}$$`
    expect(h.doc.editContent({ title: '扇出比', description: '', teaching: fixed })).toMatchObject({ ok: true })
    expect(h.teaching()).toBe(fixed)
  })

  it('latexDamageError 没问题时返回 null，免得给正常写入添噪音', () => {
    expect(latexDamageError('# 标题\n\n正文没有公式')).toBeNull()
  })
})
