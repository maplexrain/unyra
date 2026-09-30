import { describe, expect, it } from 'vitest'
import { defaultLocale, getLocale, setLocale, t } from '../src/i18n'

describe('i18n：中文原文即键的 t()', () => {
  it('zh 档原样返回：字典只服务英文档', () => {
    setLocale('zh')
    expect(t('保存')).toBe('保存')
  })

  it('en 档查字典；查不到的键原样透传（用户数据经 t() 不被改写）', () => {
    setLocale('en')
    expect(t('保存')).toBe('Save')
    expect(t('某个用户自己起的名字')).toBe('某个用户自己起的名字')
  })

  it('插值按 {0} {1} 数字下标替换；缺参保留占位符而不是吐 undefined', () => {
    setLocale('en')
    expect(t('{0} 已经创建过了，已打开它的配置', 'DeepSeek 官方')).toBe(
      'DeepSeek 官方 already exists; opened its settings instead.',
    )
    expect(t('{0}/{1}', 'a')).toBe('a/{1}')
  })

  it('语言状态可往返', () => {
    setLocale('en')
    expect(getLocale()).toBe('en')
    setLocale('zh')
    expect(getLocale()).toBe('zh')
  })

  it('defaultLocale 只会给出两档之一', () => {
    expect(['zh', 'en']).toContain(defaultLocale())
  })
})
