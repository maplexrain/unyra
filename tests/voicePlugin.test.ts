/**
 * 语音输入的**插件身份**（见 lib/functionalPlugins 与 lib/voice/plugin）。
 *
 * 钉住的是三件「错了也不会当场报错、只是界面上少一块或点不动」的事：
 * 1. 它登记在**功能性插件**这一类里（不是文档插件那一类）；
 * 2. **默认关**：没下模型就打开只会撞见一句「还没下载模型」，所以默认值必须是 false；
 * 3. 开之前有守卫：没有模型（或没跑在 Electron 里）时**开不动**，
 *    而且给出的是一句能照着做的话。
 */
import { describe, expect, it } from 'vitest'

import { FUNCTIONAL_CATEGORY } from '../src/lib/functionalPlugins'
import { VOICE_PLUGIN_ID, voicePluginOn } from '../src/lib/voice/plugin'
import { builtinPluginOn, pluginById, pluginCategories, pluginEnableBlocker } from '../src/lib/plugins'

describe('语音输入的插件身份', () => {
  it('登记在「功能性插件」这一类，且默认关、带二级配置页', () => {
    const plugin = pluginById(VOICE_PLUGIN_ID)
    expect(plugin, '插件要在导入时就登记好').toBeTruthy()
    expect(plugin?.category).toBe(FUNCTIONAL_CATEGORY)
    expect(plugin?.builtin).toBe(true)
    expect(plugin?.defaultEnabled).toBe(false)
    expect(plugin?.configurable).toBe(true)
  })

  it('这一类在注册表里，标题就是设置页上那个分类名', () => {
    const spec = pluginCategories().find((c) => c.id === FUNCTIONAL_CATEGORY)
    expect(spec?.label).toBe('功能性插件')
    expect(spec?.hint).toContain('默认关')
  })

  it('没有开关记录时按默认（关）算：输入框上不该出现一颗按了没反应的麦克风', () => {
    expect(builtinPluginOn(VOICE_PLUGIN_ID)).toBe(false)
    expect(voicePluginOn()).toBe(false)
  })

  it('开之前有守卫：没模型时给的是「下一步做什么」，不是一句「不可用」', async () => {
    const why = await pluginEnableBlocker(VOICE_PLUGIN_ID)
    // 单测里没有 Electron，守卫问不到模型状态：它会走到 catch 那一支——**依然拦得住**
    expect(typeof why).toBe('string')
    expect((why ?? '').length).toBeGreaterThan(0)
  })

  it('没有守卫的插件不留疤：默认返回 null（能开）', async () => {
    expect(await pluginEnableBlocker('plot')).toBeNull()
  })
})
