// @vitest-environment happy-dom
/**
 * 结构化教学组件围栏 (```component) 解析与渲染单元测试
 */

import { describe, expect, it } from 'vitest'
import { renderNote } from '../src/lib/markdown'
import { parseAttributes, parseComponentBlock } from '../src/lib/componentBlock/parser'
import { componentBlock } from '../src/lib/componentBlock'

describe('1. DSL 属性与插槽指令词法解析', () => {
  it('解析 #slot 语法与常规属性', () => {
    const res1 = parseAttributes('type="warn" #title')
    expect(res1.slotName).toBe('title')
    expect(res1.attrs.type).toBe('warn')
    expect(res1.attrs['#title']).toBe('true')

    const res2 = parseAttributes('#describe')
    expect(res2.slotName).toBe('describe')

    const res3 = parseAttributes('#step title="定位边界" num="1"')
    expect(res3.slotName).toBe('step')
    expect(res3.attrs.title).toBe('定位边界')
    expect(res3.attrs.num).toBe('1')

    const res4 = parseAttributes('ratio=\'3:2\' tone=ok')
    expect(res4.attrs.ratio).toBe('3:2')
    expect(res4.attrs.tone).toBe('ok')
  })
})

describe('2. Component 节点树解析 (parseComponentBlock)', () => {
  it('正确解析用户要求的示例语法 (<Notice><div #title>xxx</div><div #describe></div></Notice>)', () => {
    const source = `
<Notice>
  <div #title>xxx</div>
  <div #describe></div>
</Notice>
`
    const nodes = parseComponentBlock(source)
    expect(nodes.length).toBe(1)
    const notice = nodes[0]!
    expect(notice.tag).toBe('Notice')
    expect(notice.slots.title?.[0]?.content).toBe('xxx')
    expect(notice.slots.describe?.[0]?.content).toBe('')
  })

  it('支持带有属性与 Markdown 格式的插槽解析', () => {
    const source = `
<Notice type="warn">
  <div #title>易错陷阱 · 边界条件</div>
  <div #describe>当分母趋近于 0 时，**不能直接代入求值**</div>
</Notice>
`
    const nodes = parseComponentBlock(source)
    expect(nodes.length).toBe(1)
    const notice = nodes[0]!
    expect(notice.attrs.type).toBe('warn')
    expect(notice.slots.title?.[0]?.content).toBe('易错陷阱 · 边界条件')
    expect(notice.slots.describe?.[0]?.content).toContain('**不能直接代入求值**')
  })

  it('支持单围栏内多个同级组件解析', () => {
    const source = `
<Notice type="ok"><div #title>成功</div></Notice>
<Notice type="warn"><div #title>警示</div></Notice>
`
    const nodes = parseComponentBlock(source)
    expect(nodes.length).toBe(2)
    expect(nodes[0]!.attrs.type).toBe('ok')
    expect(nodes[1]!.attrs.type).toBe('warn')
  })

  it('分组插槽兼容 AI 常用写法：嵌套 #title / #content 折叠成属性与正文', () => {
    const source = `
<Compare>
  <div #left>
    <div #title>传统软件工程（规则驱动）</div>
    <div #content><ul><li><strong>输入</strong>：明确的业务规则</li></ul></div>
  </div>
  <div #right>
    <div #title>机器学习（数据驱动）</div>
    <div #content><ul><li><strong>输入</strong>：历史数据样本</li></ul></div>
  </div>
</Compare>
`
    const nodes = parseComponentBlock(source)
    const compare = nodes[0]!
    expect(compare.slots.left?.[0]?.attrs.title).toBe('传统软件工程（规则驱动）')
    expect(compare.slots.left?.[0]?.content).toContain('<ul>')
    expect(compare.slots.right?.[0]?.attrs.title).toBe('机器学习（数据驱动）')
  })

  it('插槽正文保留嵌套 HTML，不再只留标签外的空白', () => {
    const source = `
<Notice type="warn">
  <div #describe>当分母趋近 0 时，<strong>不能直接代入求值</strong>。</div>
</Notice>
`
    const nodes = parseComponentBlock(source)
    expect(nodes[0]!.slots.describe?.[0]?.content).toContain('<strong>不能直接代入求值</strong>')
  })

  it('嵌套 #title 之后直接跟 ul 时，ul 也归入正文', () => {
    const source = `
<Compare>
  <div #left>
    <div #title>传统软件工程</div>
    <ul><li>输入：明确规则</li></ul>
  </div>
</Compare>
`
    const nodes = parseComponentBlock(source)
    const left = nodes[0]!.slots.left?.[0]
    expect(left?.attrs.title).toBe('传统软件工程')
    expect(left?.content).toContain('<ul>')
    expect(left?.content).not.toContain('<div #title>')
  })
})

describe('3. 各类精装排版配方渲染验证', () => {
  it('配方一：Notice (带眉标提示框)', () => {
    const source = `
<Notice type="warn">
  <div #title>易错陷阱 · 边界条件</div>
  <div #describe>必须先消去零因子</div>
</Notice>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-notice')
    expect(html).toContain('border-l-warn')
    expect(html).toContain('text-warn')
    expect(html).toContain('易错陷阱 · 边界条件')
    expect(html).toContain('必须先消去零因子')
  })

  it('配方二：Compare (双栏正误辨析与交锋)', () => {
    const source = `
<Compare>
  <div #left title="直觉误区" badge="常见错误" type="warn">导数为 0 一定是极值点</div>
  <div #right title="严格定义" badge="正确认知" type="ok">驻点只是极值点的候选人</div>
</Compare>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-compare')
    expect(html).toContain('直觉误区')
    expect(html).toContain('严格定义')
    expect(html).toContain('导数为 0 一定是极值点')
    expect(html).toContain('驻点只是极值点的候选人')
  })

  it('配方三：Formula (定理公式解剖卡)', () => {
    const source = `
<Formula title="贝叶斯定理" expr="P(A|B) = [P(B|A) · P(A)] / P(B)">
  <div #item name="P(A|B) 后验概率" tone="seal">新证据下的修正概率</div>
  <div #item name="P(B|A) 似然度">前提下的观察可能性</div>
</Formula>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-formula')
    expect(html).toContain('贝叶斯定理')
    expect(html).toContain('P(A|B) = [P(B|A) · P(A)] / P(B)')
    expect(html).toContain('后验概率')
    expect(html).toContain('似然度')
  })

  it('配方四：Steps (带贯穿引导线的步骤轴)', () => {
    const source = `
<Steps>
  <div #step title="第一步 隔离研究对象">圈出所有接触面与场力来源</div>
  <div #step title="第二步 建立正交坐标系">沿加速度方向建立坐标轴</div>
</Steps>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-steps')
    expect(html).toContain('隔离研究对象')
    expect(html).toContain('建立正交坐标系')
  })

  it('配方五：Pipeline (横向机制推导链)', () => {
    const source = `
<Pipeline>
  <div #stage label="STAGE 01" title="源码输入">字符流读入内存</div>
  <div #stage label="STAGE 02" title="语法分析" tone="seal">生成抽象语法树 AST</div>
</Pipeline>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-pipeline')
    expect(html).toContain('STAGE 01')
    expect(html).toContain('源码输入')
    expect(html).toContain('STAGE 02')
    expect(html).toContain('→')
  })

  it('配方六：Stat (关键指标参数看板)', () => {
    const source = `
<Stat>
  <div #item label="时间复杂度" value="O(n log n)" tone="seal">分治最优平衡点</div>
  <div #item label="空间复杂度" value="O(1)" tone="ok">原地常数空间</div>
</Stat>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-stat')
    expect(html).toContain('O(n log n)')
    expect(html).toContain('时间复杂度')
    expect(html).toContain('O(1)')
  })

  it('配方七：Concept (词典式术语名片)', () => {
    const source = `
<Concept>
  <div #term>熵增定律</div>
  <div #en>Law of Increasing Entropy</div>
  <div #tag>热力学第二定律</div>
  <div #describe>在孤立系统中，微观无序度永远不会自发减少。</div>
</Concept>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-concept')
    expect(html).toContain('熵增定律')
    expect(html).toContain('Law of Increasing Entropy')
    expect(html).toContain('热力学第二定律')
    expect(html).toContain('孤立系统')
  })

  it('配方八：Breakdown (分段式构成条)', () => {
    const source = `
<Breakdown title="显存占用分布" total="总计 100%">
  <div #item label="优化器" value="55%" tone="seal"></div>
  <div #item label="权重参数" value="45%" tone="ok"></div>
</Breakdown>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-breakdown')
    expect(html).toContain('显存占用分布')
    expect(html).toContain('style="width:55%"')
    expect(html).toContain('style="width:45%"')
  })

  it('配方九：Quiz (随堂微测自检折叠卡)', () => {
    const source = `
<Quiz>
  <div #title>自检测评</div>
  <div #question>单摆固有周期与摆球质量有关吗？</div>
  <div #answer>无关，仅由摆长与重力加速度决定。</div>
</Quiz>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-quiz')
    expect(html).toContain('单摆固有周期与摆球质量有关吗？')
    expect(html).toContain('<details')
    expect(html).toContain('无关，仅由摆长与重力加速度决定。')
  })

  it('AI 常用嵌套写法：Compare 的左/右标题与富正文都能渲染', () => {
    const source = `
<Compare>
  <div #left>
    <div #title>传统软件工程（规则驱动）</div>
    <div #content>
      <ul>
        <li><strong>输入</strong>：明确的业务规则</li>
        <li><strong>输出</strong>：确定的执行结果</li>
      </ul>
    </div>
  </div>
  <div #right>
    <div #title>机器学习（数据驱动）</div>
    <div #content>
      <ul>
        <li><strong>输入</strong>：历史数据样本</li>
      </ul>
    </div>
  </div>
</Compare>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-compare')
    expect(html).toContain('传统软件工程（规则驱动）')
    expect(html).toContain('机器学习（数据驱动）')
    expect(html).toContain('明确的业务规则')
    expect(html).toContain('确定的执行结果')
    expect(html).toContain('历史数据样本')
    expect(html).not.toContain('直觉误区')
    expect(html).not.toContain('严格定义')
  })

  it('标准签名下正文里的 ul/li 也不再被吞成空白', () => {
    const source = `
<Compare>
  <div #left title="传统软件工程" badge="常见错误" type="warn">
    <ul><li><strong>输入</strong>：明确规则</li></ul>
  </div>
  <div #right title="机器学习" badge="正确认知" type="ok">
    <ul><li><strong>输入</strong>：历史样本</li></ul>
  </div>
</Compare>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('传统软件工程')
    expect(html).toContain('明确规则')
    expect(html).toContain('历史样本')
  })

  it('Notice 正文中的内联 <strong> 保持原样', () => {
    const source = `
<Notice type="warn">
  <div #title>边界条件</div>
  <div #describe>当分母趋近 0 时，<strong>不能直接代入求值</strong>。</div>
</Notice>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('<strong>不能直接代入求值</strong>')
  })

  it('AI 常用嵌套写法在 Steps 等分组插槽同样生效', () => {
    const source = `
<Steps>
  <div #step>
    <div #title>第一步 隔离研究对象</div>
    <div #content>圈出所有接触面与场力来源，<strong>不要漏掉摩擦力</strong>。</div>
  </div>
  <div #step>
    <div #title>第二步 建立坐标系</div>
    <div #content>沿加速度方向建立坐标轴。</div>
  </div>
</Steps>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('第一步 隔离研究对象')
    expect(html).toContain('圈出所有接触面与场力来源')
    expect(html).toContain('<strong>不要漏掉摩擦力</strong>')
    expect(html).toContain('第二步 建立坐标系')
  })

  it('通用兜底卡片 (Card / 未知组件)', () => {
    const source = `
<CustomBox title="自定义说明">
  <div #describe>内容主体</div>
</CustomBox>
`
    const html = componentBlock(source, { escape: (s) => s, attr: (s) => s })
    expect(html).toContain('moji-component-card')
    expect(html).toContain('自定义说明')
    expect(html).toContain('内容主体')
  })
})

describe('4. 与文档主渲染管线 renderNote 集成', () => {
  it('在 Markdown 文档中作为 ```component 围栏生效并解析', () => {
    const markdown = [
      '# 讲义正文',
      '',
      '这里是一段 Markdown 文字。',
      '',
      '```component',
      '<Notice>',
      '  <div #title>xxx</div>',
      '  <div #describe></div>',
      '</Notice>',
      '```',
      '',
      '文末总结段落。',
    ].join('\n')

    const html = renderNote(markdown)
    expect(html).toContain('讲义正文')
    expect(html).toContain('moji-component-notice')
    expect(html).toContain('xxx')
    expect(html).toContain('文末总结段落')
  })

  it('插槽内容支持内联 Markdown 加粗与数学公式渲染', () => {
    const markdown = [
      '```component',
      '<Notice type="ok">',
      '  <div #title>核心结论</div>',
      '  <div #describe>由质能方程 $E=mc^2$ 与 **动量守恒** 可知</div>',
      '</Notice>',
      '```',
    ].join('\n')

    const html = renderNote(markdown)
    expect(html).toContain('核心结论')
    expect(html).toContain('<strong>动量守恒</strong>')
    expect(html).toContain('katex')
  })
})
