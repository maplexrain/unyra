/**
 * 全量工作流提示词与任务规程（WORKFLOWS_GUIDE）。
 *
 * 规范：在首轮注入全量提示词，让 Agent 预先掌握所有内置工作流的目标、流程与验收标准。
 */
import { PROMPT_MODULES } from './promptModules'

function moduleTextOf(key: string): string {
  const m = PROMPT_MODULES.find((item) => item.key === key)
  return m ? m.text.trim() : ''
}

export const WORKFLOWS_GUIDE = `## 工作流提示词与任务规程（全量内置工作流）

工作流是围绕特定教学与任务场景（开讲、生成大纲、出卷、阅卷、实验、项目解读等）构建的专用任务模板。

### 工作流清单总览
- **开讲 (\`teach-node\`)**：摸底前置知识盲点后，生成针对性的教学讲义文档（参数: \`target\`）。
- **生成大纲 (\`outline\`)**：为当前知识点规划或重写大纲（只列直接子层级一层，参数: \`target\`）。
- **前置知识大纲**：给尚未展开的文档规划「学它之前要先会什么」。
- **项目与文章解读 (\`project-interpret\`)**：将文章或小型项目下载/保存至本地创建项目节点，并在生成的教学文档中用 quote 块精准引用原文进行逐段精读（参数: \`target\`）。
- **出卷 (\`exam\`)**：问清类型与难度，出一份带时限的试卷（参数: \`target\`）。
- **阅卷 (\`exam-grade\`)**：判分并针对错题编写针对性讲解（参数: \`target\`, \`attemptId\`）。
- **超级实验室 (\`superlab\`)**：问清想做什么实验，生成一份可交互的超级文档（参数: \`target\`, \`shell\`）。
- **视频总览 (\`video-overview\`)**：分析视频选集结构并规划语义分类总览文档（参数: \`target\`, \`videoId\`）。
- **了解 (\`explain\`)**：就选中的文字写一条两三句的注解，划在正文上（参数: \`target\`, \`term\`, \`occurrence\`, \`snippet\`）。
- **伪编译 (\`code-compile\`)**：把文档里这段代码转译成可运行的 JS，交付运行（参数: \`target\`, \`language\`, \`key\`, \`code\`）。
- **修复函数图像 (\`plot-fix\`)**：文档里函数图像渲染失败时，按报错与区间一次改完（参数: \`target\`, \`nodeTitle\`, \`reason\`, \`range\`, \`start\`, \`end\`, \`source\`）。
- **随笔整理 (\`essay-commit\`)**：带上全部随笔按与上次的差异统一整理进笔记（参数: \`target\`, \`message\`, \`feed\`）。
- **浏览器操作 (\`browser-use\`)**：替用户操作内置浏览器（参数: \`target\`）。
- **压缩上下文 (\`compact\`)**：把前面的对话折成一份高保真交接摘要。

---

### 1. 【开讲】教学文档生成规程
${moduleTextOf('teach-method')}

---

### 2. 【生成大纲与前置大纲】大纲编写与规划规程
${moduleTextOf('outline-method')}

---

### 3. 【项目与文章解读】源码与文章逐段精读规程
${moduleTextOf('project-interpret')}

---

### 4. 【出卷与阅卷】试卷命题与判分讲解规程
${moduleTextOf('exam')}

---

### 5. 【超级实验室】可交互超级文档设计规程
${moduleTextOf('superlab')}

---

### 6. 【视频总览】选集结构与分类总览规程
${moduleTextOf('video-overview')}

---

### 7. 【划词了解】选段注解规程
${moduleTextOf('explain')}

---

### 8. 【伪编译】文档代码转译执行规程
${moduleTextOf('code')}

---

### 9. 【修复函数图像】文档 Plot 错误快速纠偏规程
${moduleTextOf('plot-fix')}

---

### 10. 【随笔整理】增量知识归并笔记规程
${moduleTextOf('essay-commit')}

---

### 11. 【浏览器操作】驱动内置浏览器执行任务规程
${moduleTextOf('browser')}

---

### 12. 【压缩上下文】长会话交接摘要编写规程
${moduleTextOf('compact')}
`
