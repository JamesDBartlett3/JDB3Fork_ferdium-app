# Handoff: Ferdium App — Offline-Resilience Feature

## Project

Ferdium Electron app fork. Repo: `C:\Users\James\GitHub\JDB3Fork_ferdium-app`. Branch: `copilot/refactor-api-connection-logic` (target PR: `develop`). Run with `pnpm dev` (or `test-clients.sh` for two-instance testing against a local ferdium-server on port 3333). Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## What's been done

A three-state server connection enum was added to `src/stores/RequestStore.ts`:

```ts
export type ServerConnectionState = 'connected' | 'connecting' | 'disconnected';
@observable serverConnection: ServerConnectionState = 'connecting';
```

- `_checkServerConnection()` sets `'connecting'`, calls `this.stores.services._syncFromServer()`, resolves to `'connected'` or `'disconnected'`.
- `connectionDisplayState` computed: shows `'connecting'` (purple banner) through the entire backoff schedule, `'disconnected'` (red banner) only after retries exhausted (`RETRY_INTERVALS_MS = [30s, 1m, 5m, 15m, 1h]`).
- `isWriteLocked` computed: `serverConnection !== 'connected' || hasPendingSyncConflict`.
- `_autoRetry` reaction schedules exponential backoff while disconnected (no polling while connected).
- App always starts `'connecting'`.
- Race condition fixed: `ServicesStore.setup()` uses MobX `when(() => settings.loaded && user.isLoggedIn)` to defer first check until persisted server URL arrives via IPC.
- `AppStore` 60-min poll routes through `_triggerServerSync()` / `_checkServerConnection()`.
- UI banners (`AppLayout.tsx`) use `connectionDisplayState` from `AppLayoutContainer.tsx`.

## What's NOT done — the core problem to solve

**The app does not verify server writability before EACH write, and the UI doesn't block sync-dependent operations during server checks.** The user's requirements (verbatim):

> "The app must check that the server is live and ready to accept writes EVERY SINGLE TIME the user attempts to start a write operation. Only after the server has responded should the operation be allowed to continue. If the server connection fails, the write action should fail locally too, so there's no chance of the server and client becoming out-of-sync."

> "The entire available services tab in the settings modal should be disabled with a 'Connecting to server' spinner, and it should not even start loading until after the live health check passes."

> "All of the connection checks and syncing code should only be active when the user is logged into an account that syncs with a remote server."

### The design rule

**Store-level verification:**
Every store write handler that syncs to the server must:

1. Do a **live `healthCheck()` HTTP request** to the server (NOT a cached boolean).
2. If it fails → **return immediately, apply NO local mutation** (no optimistic patches, no queue).
3. If it succeeds → perform the server write, and **only patch local state on success**.
4. This means **removing the write-queue mechanism** (`src/stores/utils/services-write-queue.ts`) — it contradicts the no-divergence rule.

**UI-level gating (health check spinner):**
Only certain settings sections sync to the server. Those sections must be gated with a health check spinner:

- **Server-synced sections** (need spinner + health check): Available Services/Recipes, Account profile, Workspaces
- **Local-only sections** (always enabled, no spinner): Settings (all global prefs), UI state

The health check spinner should:

1. Display while `serverConnection === 'connecting'` AND `settings.all.app.server !== LOCAL_SERVER`
2. Disable recipe loading, workspace editing, and account editing until check completes
3. Show error banner if check fails
4. Disappear and allow normal loading if check succeeds

**Conditional activation (remote-synced accounts only):**
All health checks and server verification must only run when:

- `settings.all.app.server !== LOCAL_SERVER` (user has configured a remote server)
- User is logged in to an account that syncs to that server

Apps using LOCAL_SERVER mode bypass all server checks entirely.

### Server-synced vs Local-Only Settings Reference

**Settings that SYNC to server** (need health check gate):
| Component | Server Endpoint | Gate Type |
|-----------|-----------------|-----------|
| Available Services/Recipes tab | `POST/PUT/DELETE /service`, `PUT /service/reorder` | Health check spinner |
| Workspaces modal | `POST/PUT/DELETE /workspace/:id` | Health check spinner |
| Account settings (password/email) | `PUT /me` | Health check spinner |

**Settings that are LOCAL-ONLY** (always enabled, no gate):
| Component | Storage | Status |
|-----------|---------|--------|
| General settings (auto-launch, tray, notifications) | File system | Always available |
| Display settings (dark mode, accent color, sidebar) | File system | Always available |
| Privacy settings (Sentry, WebRTC, search engine) | File system | Always available |
| Language settings (locale, spellcheck) | File system | Always available |
| Advanced settings (dev options, shortcuts) | File system | Always available |
| UI state (sidebar collapsed, drawer open) | Memory | Always available |

### Implementation roadmap

**Phase 1: Add verification method to RequestStore**

- Add `_verifyServerWritable(): Promise<boolean>` method
- This method performs a live health check (don't use cached `serverConnection`)
- Returns `true` if server responds; `false` if fails
- Sets `serverConnection = 'disconnected'` on failure

**Phase 2: Guard all server-synced writes in stores**

- `ServicesStore`: Prepend health check to `_createService`, `_updateService`, `_deleteService`, `_reorderService`
- `WorkspacesStore`: Prepend health check to `_create`, `_update`, `_delete`, `reorderServicesOfActiveWorkspace`
- `UserStore`: Prepend health check to `_update`, `_delete`
- Remove optimistic mutations (move to after-success)
- Delete `services-write-queue.ts` and all its imports

**Phase 3: Add UI spinner gating**

- Modify `RecipesScreen.tsx` to show spinner while `serverConnection === 'connecting'` (for remote accounts)
- Modify workspace/account sections similarly
- Settings section always remains enabled (no spinner needed)

**Phase 4: Verify conditional activation**

- Ensure all health checks only run when `settings.all.app.server !== LOCAL_SERVER`
- Ensure LOCAL_SERVER mode users bypass all server logic
- Verify `UserStore` login flow properly sets server URL before first sync check

### Where to add the live check

Add to `RequestStore`:

```ts
async _verifyServerWritable(): Promise<boolean> {
  // Live healthCheck via this.api.app (AppApi wraps ServerApi.healthCheck).
  // On success return true; on failure set serverConnection='disconnected', return false.
}
```

### Every write handler that needs this guard

**`src/stores/ServicesStore.ts`** (current guards are just `if (this.stores.requests.isWriteLocked) return;` — replace with `await _verifyServerWritable()`):

| Handler                                                   | Server write                                                                        | Current issue                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `_createService`                                          | POST `/service`                                                                     | Guards with cached boolean, not live check                  |
| `_updateService`                                          | PUT `/service/:id`                                                                  | Optimistic patch BEFORE server write; enqueues on failure   |
| `_deleteService`                                          | DELETE `/service/:id`                                                               | Optimistic removal BEFORE server write; enqueues on failure |
| `_reorderService`                                         | PUT `/service/reorder`                                                              | Enqueues on failure                                         |
| `_toggleService`                                          | local `isEnabled` flip → later synced                                               | Local mutation with no server write                         |
| `_toggleNotifications`, `_toggleAudio`, `_toggleDarkMode` | call `_updateService`                                                               | Indirect — guarded if `_updateService` is                   |
| `_reorder`                                                | routes to either `workspaces.reorderServicesOfActiveWorkspace` OR `_reorderService` | Workspace path has NO guard at all                          |

**`src/features/workspaces/store.ts`** (NO guards at all currently):

| Handler                            | Server write                                                              | Issue                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `_create`                          | POST `/workspace`                                                         | No guard; local push AFTER await (ok if guard added first)                             |
| `_delete`                          | DELETE `/workspace/:id`                                                   | No guard; local removal AFTER await (ok)                                               |
| `_update`                          | PUT `/workspace/:id` (also does grouping/ungrouping via `services` array) | No guard; optimistic `Object.assign` AFTER await (ok)                                  |
| `reorderServicesOfActiveWorkspace` | PUT `/workspace/:id`                                                      | No guard; splices `workspace.services` array BEFORE await (violates rule — move after) |

**`src/stores/UserStore.ts`** (NO guards):

| Handler                 | Server write                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `_update`               | PUT `/me`                                                    |
| `_delete`               | DELETE `/me`                                                 |
| `_importLegacyServices` | creates services via `_createService` (guarded transitively) |

### Key files

**Store layer (write verification):**

- `src/stores/RequestStore.ts` — add `_verifyServerWritable()` method
- `src/stores/ServicesStore.ts` — prepend health check to all write handlers
- `src/features/workspaces/store.ts` — prepend health check to all write handlers
- `src/stores/UserStore.ts` — prepend health check to `_update`, `_delete`
- `src/stores/utils/services-write-queue.ts` — DELETE this file
- `src/@types/stores.types.ts` — add `_verifyServerWritable` to `RequestsStore` interface
- `src/api/AppApi.ts` — ensure `healthCheck()` method exists
- `src/api/server/ServerApi.ts` — ensure `healthCheck()` endpoint exists

**UI layer (spinner gating):**

- `src/containers/settings/RecipesScreen.tsx` — gate with health check spinner
- `src/components/settings/recipes/RecipesDashboard.tsx` — conditionally disable while checking
- `src/features/workspaces/components/*` — add health check gating
- `src/components/settings/account/AccountDashboard.tsx` — add health check gating

### UI elements that trigger writes (for reference — store-level guards cover all of these)

| UI element                         | File                                                   | Handler it reaches                                   |
| ---------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Sidebar "+" button                 | `src/components/layout/Sidebar.tsx`                    | → recipes → `_createService`                         |
| RecipeItem click                   | `src/components/settings/recipes/RecipeItem.tsx`       | → `_createService`                                   |
| EditServiceForm Save/Delete        | `src/components/settings/services/EditServiceForm.tsx` | → `_updateService`/`_deleteService`/`_createService` |
| Tab drag-and-drop reorder          | `src/components/services/tabs/Tabbar.tsx`              | → `_reorder`                                         |
| Service right-click context menu   | `src/components/services/tabs/TabItem.tsx`             | → delete/toggle/update                               |
| Workspace create/delete/save forms | `src/features/workspaces/components/*`                 | → `_create`/`_delete`/`_update`                      |
| Account delete / edit user         | `src/components/settings/account/*`                    | → `_delete`/`_update`                                |

## What "done" looks like

1. **Store-level verification**: Every write handler across ServicesStore, WorkspacesStore, and UserStore starts with:

   ```ts
   if (!(await this.stores.requests._verifyServerWritable())) return;
   ```

   AND this check only runs for remote-synced accounts (`settings.all.app.server !== LOCAL_SERVER`)

2. **No optimistic mutations**: All local state mutations happen AFTER server write succeeds. Remove optimistic patches from `_updateService`, `_deleteService`, `_reorderService`, and fix `reorderServicesOfActiveWorkspace` to splice after success.

3. **Write queue removed**: `services-write-queue.ts` is deleted; all `enqueueWriteOp`/`dequeueAll`/`hasPendingWrites`/`clearAllWriteQueues` imports removed.

4. **UI spinner gating**:

   - RecipesScreen shows "Connecting to server" spinner while `serverConnection === 'connecting'` (for remote accounts)
   - Recipe loading/interaction disabled until health check passes
   - Same gating applied to Workspaces and Account sections
   - Settings section remains always enabled

5. **Conditional activation**: All server logic (checks, syncing, health checks) skipped for LOCAL_SERVER accounts.

6. **Tests pass**: `pnpm lint && pnpm typecheck && pnpm test` all pass. Existing tests in `test/stores/utils/services-write-queue.test.ts` deleted (file no longer exists).

## Additional context

- MobX strict mode is enabled — mutations in async functions need `runInAction()` or `@action`.
- `CachedRequest.patch()` is itself a thenable — use `.then()` not `await` (TS1320).
- `_applyServerServices()` merges server services into local state preserving webview runtime state (`isFirstLoad`, `isLoading`, `webview`, `isAttached`, etc.) — don't lose this logic.
- The `connectionDisplayState` / banner system is working; don't break it.
- `test-clients.sh` launches two isolated client instances with `FERDIUM_APPDATA_DIR` for testing divergence/sync.
