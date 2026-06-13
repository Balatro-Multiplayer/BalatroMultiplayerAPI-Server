
import type { DefineComponent, SlotsType } from 'vue'
type IslandComponent<T> = DefineComponent<{}, {refresh: () => Promise<void>}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, SlotsType<{ fallback: { error: unknown } }>> & T

type HydrationStrategies = {
  hydrateOnVisible?: IntersectionObserverInit | true
  hydrateOnIdle?: number | true
  hydrateOnInteraction?: keyof HTMLElementEventMap | Array<keyof HTMLElementEventMap> | true
  hydrateOnMediaQuery?: string
  hydrateAfter?: number
  hydrateWhen?: boolean
  hydrateNever?: true
}
type LazyComponent<T> = DefineComponent<HydrationStrategies, {}, {}, {}, {}, {}, {}, { hydrated: () => void }> & T

interface _GlobalComponents {
  AppNav: typeof import("../../components/AppNav.vue")['default']
  BBtn: typeof import("../../components/BBtn.vue")['default']
  BPanel: typeof import("../../components/BPanel.vue")['default']
  BalatroSwirl: typeof import("../../components/BalatroSwirl.vue")['default']
  DocsNav: typeof import("../../components/DocsNav.vue")['default']
  LeaderboardTable: typeof import("../../components/LeaderboardTable.vue")['default']
  RankBadge: typeof import("../../components/RankBadge.vue")['default']
  StreakDisplay: typeof import("../../components/StreakDisplay.vue")['default']
  WinRateBadge: typeof import("../../components/WinRateBadge.vue")['default']
  NuxtWelcome: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/welcome.vue")['default']
  NuxtLayout: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-layout")['default']
  NuxtErrorBoundary: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-error-boundary.vue")['default']
  ClientOnly: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/client-only")['default']
  DevOnly: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/dev-only")['default']
  ServerPlaceholder: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/server-placeholder")['default']
  NuxtLink: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-link")['default']
  NuxtLoadingIndicator: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-loading-indicator")['default']
  NuxtTime: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-time.vue")['default']
  NuxtRouteAnnouncer: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-route-announcer")['default']
  NuxtImg: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-stubs")['NuxtImg']
  NuxtPicture: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-stubs")['NuxtPicture']
  NuxtPage: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/pages/runtime/page")['default']
  NoScript: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['NoScript']
  Link: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Link']
  Base: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Base']
  Title: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Title']
  Meta: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Meta']
  Style: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Style']
  Head: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Head']
  Html: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Html']
  Body: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Body']
  NuxtIsland: typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-island")['default']
  LazyAppNav: LazyComponent<typeof import("../../components/AppNav.vue")['default']>
  LazyBBtn: LazyComponent<typeof import("../../components/BBtn.vue")['default']>
  LazyBPanel: LazyComponent<typeof import("../../components/BPanel.vue")['default']>
  LazyBalatroSwirl: LazyComponent<typeof import("../../components/BalatroSwirl.vue")['default']>
  LazyDocsNav: LazyComponent<typeof import("../../components/DocsNav.vue")['default']>
  LazyLeaderboardTable: LazyComponent<typeof import("../../components/LeaderboardTable.vue")['default']>
  LazyRankBadge: LazyComponent<typeof import("../../components/RankBadge.vue")['default']>
  LazyStreakDisplay: LazyComponent<typeof import("../../components/StreakDisplay.vue")['default']>
  LazyWinRateBadge: LazyComponent<typeof import("../../components/WinRateBadge.vue")['default']>
  LazyNuxtWelcome: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/welcome.vue")['default']>
  LazyNuxtLayout: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-layout")['default']>
  LazyNuxtErrorBoundary: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-error-boundary.vue")['default']>
  LazyClientOnly: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/client-only")['default']>
  LazyDevOnly: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/dev-only")['default']>
  LazyServerPlaceholder: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/server-placeholder")['default']>
  LazyNuxtLink: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-link")['default']>
  LazyNuxtLoadingIndicator: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-loading-indicator")['default']>
  LazyNuxtTime: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-time.vue")['default']>
  LazyNuxtRouteAnnouncer: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-route-announcer")['default']>
  LazyNuxtImg: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-stubs")['NuxtImg']>
  LazyNuxtPicture: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-stubs")['NuxtPicture']>
  LazyNuxtPage: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/pages/runtime/page")['default']>
  LazyNoScript: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['NoScript']>
  LazyLink: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Link']>
  LazyBase: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Base']>
  LazyTitle: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Title']>
  LazyMeta: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Meta']>
  LazyStyle: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Style']>
  LazyHead: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Head']>
  LazyHtml: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Html']>
  LazyBody: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/head/runtime/components")['Body']>
  LazyNuxtIsland: LazyComponent<typeof import("../../../../node_modules/.pnpm/nuxt@3.21.8_@biomejs+biome@1.9.4_@parcel+watcher@2.5.6_@types+node@22.19.19_@vue+compil_66c48233a37a64a7c38464eedb43ba49/node_modules/nuxt/dist/app/components/nuxt-island")['default']>
}

declare module 'vue' {
  export interface GlobalComponents extends _GlobalComponents { }
}

export {}
