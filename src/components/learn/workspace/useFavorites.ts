import { useCallback, useMemo } from 'react'
import type { DocView, FavoriteRef, LearnStore, LearnTab, TabRef, WebTabMeta } from '../../../learn/types'
import {
  favoriteKey,
  favoriteKeyOfTab,
  favoriteRefOfTab,
  favoriteTitle,
  removeFavorite as removeFromFavorites,
  removeFavoriteGroup,
  renameFavoriteGroup,
  renameWebFavorite,
  setFavoriteGroup,
  createFavoriteGroup,
  tabRefOfFavorite,
  toggleFavorite as toggleInFavorites,
} from '../../../learn/favorites'
import { nodeById } from '../../../learn/graph'

/** 收藏域需要的宿主能力与数据 */
export interface FavoritesDeps {
  store: LearnStore
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  /** 网页页签的活标题与站点图标（toggleTabFavorite 收藏那一刻取用） */
  webMeta: Record<string, WebTabMeta>
  examTabTitle: (examId: string, attemptId: string) => string | undefined
  openTab: (ref: TabRef, preferredView?: DocView) => void
}

/* ---------- 收藏（页签右键菜单 / 地址栏星标 / 侧栏收藏区，见 learn/favorites） ---------- */
export function useFavorites({ store, getLatest, set, webMeta, examTabTitle, openTab }: FavoritesDeps) {
  /** 已收藏的身份集合：三个入口的「收藏了没有」都查它 */
  const favoriteKeys = useMemo(
    () => new Set((store.favorites ?? []).map((f) => favoriteKey(f))),
    [store.favorites],
  )

  const isTabFavorite = useCallback(
    (ref: TabRef) => {
      const key = favoriteKeyOfTab(ref)
      return !!key && favoriteKeys.has(key)
    },
    [favoriteKeys],
  )

  /** 地址栏星标的那一问：这一页（网址）收藏了没有 */
  const isUrlFavorite = useCallback(
    (url: string) => !!url && favoriteKeys.has(favoriteKey({ kind: 'web', url })),
    [favoriteKeys],
  )

  /** 收藏 / 取消收藏（页签右键菜单）：起始页没有网址，无从收藏，不动。
   *  网页要顺手把「这一页」的活标题与站点图标记进收藏——收藏夹里显示的是它们，
   *  不是裸网址（标题没有活数据源可查，只能收藏那一刻存下来，见 learn/favorites）；
   *  extra 由地址栏星标直接给，页签右键则从 webMeta 里现查。 */
  const toggleTabFavorite = useCallback(
    (tab: Pick<LearnTab, 'id' | 'ref'>, extra?: { title?: string; icon?: string }) => {
      const fav = favoriteRefOfTab(tab.ref)
      if (!fav) return
      const m = tab.ref.kind === 'web' ? webMeta[tab.id] : undefined
      const title = extra?.title ?? m?.title
      const icon = extra?.icon ?? m?.favicon
      const full: FavoriteRef =
        fav.kind === 'web'
          ? { ...fav, ...(title ? { title: title.slice(0, 200) } : {}), ...(icon ? { icon } : {}) }
          : fav
      const s = getLatest()
      set({ ...s, favorites: toggleInFavorites(s.favorites ?? [], full, Date.now()) })
    },
    [getLatest, set, webMeta],
  )

  /** 地址栏星标：收藏的是当前网址（与页签右键同一条路），这一页的标题与图标一并记下 */
  const toggleUrlFavorite = useCallback(
    (url: string, extra?: { title?: string; icon?: string }) =>
      toggleTabFavorite({ id: '', ref: { kind: 'web', url, key: '' } }, extra),
    [toggleTabFavorite],
  )

  /** 点收藏区的一行：现场换算成页签（网页开新签）走与别处**同一个** openTab */
  const openFavorite = useCallback((ref: FavoriteRef) => openTab(tabRefOfFavorite(ref)), [openTab])

  /** 把一行摘出收藏夹（侧栏收藏区的移除键；收藏的 × 不动文档本身） */
  const dropFavorite = useCallback(
    (ref: FavoriteRef) => {
      const s = getLatest()
      set({ ...s, favorites: removeFromFavorites(s.favorites ?? [], favoriteKey(ref)) })
    },
    [getLatest, set],
  )

  /*
   * 收藏的分组与改名（见 learn/favorites 的分组段）。组名登记在 favGroups、同时长在
   * 成员身上：移入一个没登记过的组名时顺手登记（拖进来的「新建分组」也走这条路），
   * 删组 = 登记表摘掉 + 成员的 group 摘掉（收藏一条不丢）。
   */
  const setFavGroup = useCallback(
    (ref: FavoriteRef, group: string | null) => {
      const s = getLatest()
      const next = setFavoriteGroup(s.favorites ?? [], favoriteKey(ref), group)
      const groups =
        group && !(s.favGroups ?? []).includes(group.trim())
          ? createFavoriteGroup(s.favGroups ?? [], group)
          : s.favGroups ?? []
      set({ ...s, favorites: next, favGroups: groups })
    },
    [getLatest, set],
  )
  const createFavGroup = useCallback(
    (name: string) => {
      const s = getLatest()
      set({ ...s, favGroups: createFavoriteGroup(s.favGroups ?? [], name) })
    },
    [getLatest, set],
  )
  const renameFavGroup = useCallback(
    (from: string, to: string) => {
      const next = to.trim().slice(0, 64)
      if (!next || next === from) return
      const s = getLatest()
      set({
        ...s,
        favGroups: (s.favGroups ?? []).map((g) => (g === from ? next : g)),
        // 组名同时也是成员身上的标记：成员一起换
        favorites: renameFavoriteGroup(s.favorites ?? [], from, next),
      })
    },
    [getLatest, set],
  )
  const removeFavGroup = useCallback(
    (group: string) => {
      const s = getLatest()
      set({
        ...s,
        favGroups: (s.favGroups ?? []).filter((g) => g !== group),
        favorites: removeFavoriteGroup(s.favorites ?? [], group),
      })
    },
    [getLatest, set],
  )
  const renameFavTitle = useCallback(
    (ref: FavoriteRef, title: string) => {
      const s = getLatest()
      set({ ...s, favorites: renameWebFavorite(s.favorites ?? [], favoriteKey(ref), title) })
    },
    [getLatest, set],
  )

  /** 收藏行的标题：节点名与考试名都是活查的（改名之后收藏跟着新名字走） */
  const favoriteTitleOf = useCallback(
    (ref: FavoriteRef) => favoriteTitle(ref, (id) => nodeById(store, id)?.title, examTabTitle),
    [store, examTabTitle],
  )

  return {
    isTabFavorite,
    isUrlFavorite,
    toggleTabFavorite,
    toggleUrlFavorite,
    openFavorite,
    dropFavorite,
    setFavGroup,
    createFavGroup,
    renameFavGroup,
    removeFavGroup,
    renameFavTitle,
    favoriteTitleOf,
  }
}
