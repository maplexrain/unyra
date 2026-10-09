# 文档目录

README 只负责介绍项目（它是什么、能做什么、怎么装）。**实现细节、设计取舍与踩过的坑都在这里。**

按你想知道的东西挑一份读：

## 先读这几份

| 文档 | 讲什么 |
| --- | --- |
| [learning.md](learning.md) | 学习是怎么组织的：目标 / 节点 / 大纲、选词菜单、注解、目标级对话 |
| [agent.md](agent.md) | 超级导师：人格、上下文压缩、工具气泡、Agent 设置、用户画像 |
| [subagent-architecture.md](subagent-architecture.md) | 子代理：内置与导师自定义、独立的上下文、只交付最终消息、内置的网络检索 |
| [sandbox-api.md](sandbox-api.md) | 导师唯一那只手：`execute` 工具、path 寻址、全部 api 一览 |
| [data-and-privacy.md](data-and-privacy.md) | 数据存在哪、长什么样、哪些请求会离开这台机器 |

## 界面与文档能力

| 文档 | 讲什么 |
| --- | --- |
| [workspace.md](workspace.md) | 文档区：自由页签、分割、源码 / 预览、暂存区、查找替换、导出、大纲 |
| [rendering.md](rendering.md) | 文档渲染插件：接口与边界、正文文字规则、代码块高亮 |
| [code-run.md](code-run.md) | 代码块的伪编译与运行：工作流、运行沙箱、产物寻址 |
| [shortcuts-and-voice.md](shortcuts-and-voice.md) | 快捷键改键与语音输入（SenseVoiceSmall，功能性插件） |

## 学习闭环

| 文档 | 讲什么 |
| --- | --- |
| [exam.md](exam.md) | 试卷与考试窗口、作答记录、判分与错题讲解 |
| [learning-state.md](learning-state.md) | 掌握度、自评、错误记忆、探针与主动回忆 |
| [reading-and-checkin.md](reading-and-checkin.md) | 有效阅读口径、注意力评级、打卡、番茄钟、读网页 |
| [reading-mechanism.md](reading-mechanism.md) | 阅读采集的数据形状、四层节奏与落盘细节 |

## 工程

| 文档 | 讲什么 |
| --- | --- |
| [architecture.md](architecture.md) | 主进程与渲染层、窗口与原生能力、模块地图、扩展方式 |
| [ai-providers.md](ai-providers.md) | 预设与兼容格式、配置结构、思考程度、Command Code Go 套餐 |
| [development.md](development.md) | 开发环境、脚本、测试的分工与约定 |
| [packaging-and-release.md](packaging-and-release.md) | 构建产物、反篡改开关、自动更新与发布流程 |

## 其他

| 位置 | 是什么 |
| --- | --- |
| [`plugin-examples/`](plugin-examples/) | 可以直接复制到 `{root}/plugins/` 的示例插件 |
| [`assets/`](assets/) | 上面那些图片素材的存放位置 |

> 这些文档里的行号、文件名与代码片段都对应仓库当前状态。改了行为**请顺手改文档**——
> 一份说不准的文档比没有文档更坏。
