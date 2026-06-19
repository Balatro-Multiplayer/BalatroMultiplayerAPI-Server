## 1. Bot API — Moderation Router

- [x] 1.1 Create `src/api/routers/commands/moderation.router.ts` with OpenAPIHono router
- [x] 1.2 Add `GET /api/moderation/strikes` endpoint — list players with strikes (paginated, searchable), resolve Discord user info via `client.users.fetch()`
- [x] 1.3 Add `GET /api/moderation/strikes/:user_id` endpoint — get strikes for a specific user
- [x] 1.4 Add `POST /api/moderation/strikes` endpoint — give strike (insert, calculate expiry, log to Discord)
- [x] 1.5 Add `DELETE /api/moderation/strikes/:id` endpoint — remove strike (delete, log to Discord with optional reason)
- [x] 1.6 Add `GET /api/moderation/bans` endpoint — list active bans (paginated, searchable), resolve Discord user info
- [x] 1.7 Add `POST /api/moderation/bans` endpoint — ban user (insert with expiry, log to Discord)
- [x] 1.8 Add `DELETE /api/moderation/bans/:user_id` endpoint — unban user (delete, log to Discord with optional reason)
- [x] 1.9 Add `GET /api/moderation/users/search?q=...` endpoint — guild member search via `guild.members.fetch({ query, limit: 10 })`
- [x] 1.10 Register moderation router in `app.ts` with bearer auth on `/api/moderation/*`

## 2. Website — Service Layer

- [x] 2.1 Add moderation methods to `botlatro.service.ts`: `listPlayersWithStrikes`, `getUserStrikes`, `giveStrike`, `removeStrike`, `listActiveBans`, `banUser`, `unbanUser`, `searchGuildMembers`
- [x] 2.2 Define TypeScript types for moderation API responses

## 3. Website — tRPC Router

- [x] 3.1 Create `src/server/api/routers/moderation.ts` tRPC router
- [x] 3.2 Add strike procedures (list, get, give, remove) with helper+ role check
- [x] 3.3 Add ban procedures (list, add, remove) with admin+ role check
- [x] 3.4 Add guild member search procedure with helper+ role check
- [x] 3.5 Register moderation router in `src/server/api/root.ts`

## 4. Website — Admin UI

- [x] 4.1 Create `/admin/moderation` page and layout
- [x] 4.2 Build moderation client component with tabs (Active Bans, Recent Strikes, All), search bar, and pagination
- [x] 4.3 Build player card component — collapsible card showing avatar, username, strike summary, ban badge
- [x] 4.4 Build expanded card content — individual strike entries with remove button, ban details with lift ban button
- [x] 4.5 Build "Give Strike" dialog — player typeahead, amount select with tier labels, reason, reference fields
- [x] 4.6 Build "Ban User" dialog — player typeahead, length in days, reason field
- [x] 4.7 Build "Remove Strike" confirmation — optional reason field
- [x] 4.8 Build "Lift Ban" confirmation — optional reason field
- [x] 4.9 Add mobile layout — full-width cards, sticky FAB for actions, bottom sheet dialogs
- [x] 4.10 Add optimistic updates and toast feedback for all mutations
- [x] 4.11 Add `/admin/moderation` link to admin nav in header

## 5. Website — Caching

- [x] 5.1 Cache guild member search results in Redis (reuse existing `discord.service.ts` pattern, 24h TTL)
