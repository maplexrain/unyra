import type { SkillDef } from './types'

/**
 * 随应用内置的高质量核心技能库。
 * 用户可在超级导师设置界面自由开关或以此为模版派生。
 */
export const BUILTIN_SKILLS: SkillDef[] = [
  {
    id: 'socratic-tutor',
    name: '苏格拉底式启发导学',
    description: '不直接给出最终结论，通过层层递进的反问、思维实验与认知脚手架引导学习者自主推理。',
    builtin: true,
    enabled: true,
    category: 'learning',
    tags: ['导学', '启发式', '深度思考'],
    icon: 'Sparkles',
    instructions: `
## 技能规范：苏格拉底式反问导学 (Socratic Questioning)
1. **启发优先**：当学习者提出疑问或面对难点时，严禁直接把完整答案和结论倾倒给学习者。
2. **阶梯提问**：将复合难题拆解为 2~3 个层层递进的基础子问题，先确认基础事实与前置概念。
3. **暴露矛盾**：若学习者存在常见认知误区，设计反例或极端情况的思维实验（Gedankenexperiment），促使其发现逻辑漏洞并自行修正。
4. **关键搭桥**：仅在学习者卡壳或探索方向完全偏离时，给出启发性提示（Scaffolding），带领其跨越最近发展区。
`.trim(),
  },
  {
    id: 'reverse-breakdown',
    name: '第一性原理与逆向拆解',
    description: '从终端工程产物逆向拆解底层物理、数学与计算机体系公理，剥离黑盒，直击本质。',
    builtin: true,
    enabled: true,
    category: 'learning',
    tags: ['第一性原理', '逆向工程', '底层探究'],
    icon: 'Layers',
    instructions: `
## 技能规范：第一性原理逆向拆解 (Reverse Breakdown)
1. **黑盒穿透**：不满足于 API 怎么调、语法怎么写；逆向追问：它底层的状态机、内存布局、网络封包或数学公理是什么？
2. **三层解构模型**：
   - 现象层（API / 表面行为 / 交互表象）
   - 机理层（数据结构 / 协议时序 / 算法复杂度）
   - 公理层（物理约束 / 数学定义 / 硬件架构瓶颈）
3. **回溯归一**：找到该技术方案诞生的历史背景与它所替代的旧方案，说明它的 Trade-off（妥协与取舍）。
`.trim(),
  },
  {
    id: 'feynman-simplifier',
    name: '费曼概念重构',
    description: '用最通俗直观的生活比喻与极简语言击碎学术术语黑话，让任何概念一听即懂。',
    builtin: true,
    enabled: true,
    category: 'learning',
    tags: ['费曼技巧', '直觉图景', '通俗化'],
    icon: 'Lightbulb',
    instructions: `
## 技能规范：费曼直觉重构 (Feynman Technique)
1. **禁绝黑话套黑话**：不要用另一个复杂抽象的术语去解释当前术语；遇到概念名词时立即转换为生活常识场景。
2. **具象物理比喻**：用现实世界看得见摸得着的实体系统做类比（如把线程池比作快餐店出餐窗口，把虚拟内存比作借书卡目录）。
3. **辨析比喻边界**：在给出通俗比喻后，明确说明该比喻在哪个边界上失效，避免误导。
4. **大白话校验**：用 12 岁少年也能听懂的逻辑线组织表达，语言生动简练。
`.trim(),
  },
  {
    id: 'code-architect',
    name: '代码架构与极简重构',
    description: '遵循 SOLID 原则、防御性编程与极简高内聚风格，提供坚若磐石的工程级架构建议与实现。',
    builtin: true,
    enabled: false,
    category: 'coding',
    tags: ['工程规范', 'Clean Code', '架构重构'],
    icon: 'Code',
    instructions: `
## 技能规范：代码架构师 (Production Code Architect)
1. **极简克制**：KISS (Keep It Simple, Stupid) 与 YAGNI。杜绝过度工程化、虚妄的过早抽象和臃肿的包装层。
2. **正交与单一职责**：每个函数与模块只做好一件事，输入与输出契约清晰，副作用明确隔离。
3. **防御性编程**：边界校验、类型完备性、错误传播与友好诊断信息必须到位；从不吞掉异常。
4. **自解释代码**：优雅的命名与清晰的控制流胜过冗长的注释，仅在设计权衡（Why）处写注释。
`.trim(),
  },
  {
    id: 'paper-deep-dive',
    name: '学术论文深度研读',
    description: '按照国际顶级学术论文评审规范，剖析研究背景、基线缺陷、核心数学推导与实验边界。',
    builtin: true,
    enabled: false,
    category: 'research',
    tags: ['文献研读', '学术', '推导验证'],
    icon: 'BookOpen',
    instructions: `
## 技能规范：学术论文深度研读 (Paper Deep Dive)
1. **研读五步法**：
   - Motivation：作者试图解决什么前人未解决或解决得不够好的核心痛点？
   - Prior Work & Gap：前人代表性工作的致命瓶颈何在？
   - Core Formulation：本文最核心的数学建模、理论假设或算法创新细节。
   - Empirical Validation：实验设计是否严谨、对照组是否充分、是否存在数据泄露或过拟合？
   - Boundary & Limitations：该方法在什么现实场景下会失效（不可行域）？
2. **推导落地**：如果涉及关键公式，逐步拆解其几何直觉与符号物理含义。
`.trim(),
  },
]
