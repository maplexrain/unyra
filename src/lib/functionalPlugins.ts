/**
 * 「功能性插件」这一类：给**应用**加一项能力，而不是给文档加一种语法。
 *
 * 与 Markdown 文档插件（lib/renderPlugins）的分工：那边接的是渲染管线上的钩子，
 * 登记完当场就能用；这边登记的是「这个功能存在、开关在哪、有没有自己的配置页」，
 * 真正的行为由各自的功能模块负责（目前只有语音输入，见 lib/voice/plugin）。
 *
 * 这一类**默认关**：它们大多要先下载模型、要占资源，没准备好就打开只会让人撞见
 * 一堆「还不能用」。开关能不能拨由插件登记的守卫说了算（见 plugins 的
 * setPluginEnableGuard）——语音输入的守卫就是「模型下了没有」。
 */
import { t } from '../i18n'
import { definePluginCategory, type PluginBase } from './plugins'

export const FUNCTIONAL_CATEGORY = 'functional' as const

/** 功能性插件在通用字段之外多这一样：有没有二级配置页 */
export interface FunctionalPlugin extends PluginBase {
  category: 'functional'
  /** true：设置页里点这一行进得去（模型、语言、GPU 这些都在那儿配） */
  configurable: boolean
}

definePluginCategory({
  id: FUNCTIONAL_CATEGORY,
  label: '功能性插件',
  hint: '给应用加一项能力。默认关着：点名字进去把它需要的东西准备好，再打开。',
  normalize(raw, id): FunctionalPlugin {
    return {
      id,
      category: FUNCTIONAL_CATEGORY,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
      builtin: raw.builtin === true,
      defaultEnabled: raw.defaultEnabled === true,
      configurable: raw.configurable === true,
      ...(typeof raw.origin === 'string' ? { origin: raw.origin } : {}),
    }
  },
  describe(plugin): string[] {
    return [(plugin as FunctionalPlugin).configurable ? t('可配置') : t('开箱即用')]
  },
})
