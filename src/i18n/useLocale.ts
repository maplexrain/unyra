/**
 * 组件里读界面语言：语言切换时组件跟着重渲染。
 *
 * 只有 App 根部与两个 memo 组件（MessageRow / DocPane）需要显式订阅——
 * 其余组件在语言切换时由父级重渲染带着走。memo 挡住了 props 浅比较相等的那一支，
 * 所以 memo 组件必须自己订阅。
 */
import { useSyncExternalStore } from 'react'
import { getLocale, subscribeLocale, type Locale } from './index'

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale)
}
