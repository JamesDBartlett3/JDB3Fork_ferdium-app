# Offline Behavior for Service Writes

This document describes how service write operations (create, update, delete,
reorder) behave when the Ferdium server is unreachable. The current approach
is intentionally conservative: writes are server-required rather than queued
or applied optimistically.

## Background

The client maintains a local cache of the user's services (in `localStorage`,
token-scoped). When the Ferdium server is unreachable, the client can still
_read_ from this cache, so existing services remain usable. This PR keeps
_writes_ server-dependent: if the server cannot be reached, the write is not
performed and the local cache is left unchanged.

## What this PR implements

### 1. Service creation is disabled while the server is offline

When the server is unreachable, the UI elements that lead to creating a new
service are rendered in a **visible-but-disabled** state — greyed out,
non-clickable, with a hover tooltip explaining why.

**Why disabled rather than queued?** The server assigns the service ID
(`ServiceController.create` generates a UUID v4; see
`ferdium-server/app/Controllers/Http/ServiceController.ts`). The client cannot
produce a server-valid ID locally. A placeholder UUID would work for the local
cache, but every Electron session partition, proxy setting, and IPC channel
keys off the service ID. Swapping a placeholder ID for a real one after sync
would orphan the webview's session data (cookies, localStorage, login state).

**UI surfaces gated:**

- Recipe picker items (`RecipeItem.tsx`) — greyed out + tooltip
- Sidebar "+" button (`Sidebar.tsx`) — greyed out + tooltip
- EditServiceScreen save button (`EditServiceForm.tsx`) — disabled + tooltip
  (edge case: user had the create form open when the outage began)
- SetupAssistant submit button (`SetupAssistant.tsx`) — disabled + tooltip
  (the "Skip" button remains enabled since it creates nothing)

### 2. Service mutations are blocked when the server is offline

Update, delete, and reorder operate on **existing** IDs, so they don't have
the ID-mismatch problem. Rather than applying changes optimistically and
queueing them for retry, the current implementation requires the server write
to succeed before local state is updated:

1. The write is attempted on the server first.
2. Only if the server write succeeds is the local cache patched.
3. If the server is unreachable, the write fails immediately and the local
   cache remains unchanged.

There is no persistent write queue in this iteration. `ServicesStore.hasPendingWrites`
always returns `false`, and `ServicesStore._flushPendingWrites()` is currently
a no-op. These hooks are intentionally left in place as scaffolding for the
next iteration, when optimistic local updates plus queued deferred sync will
be implemented. The `_queuePersistServicesCache` helper is unrelated to write
queueing; it just persists the current service list to `localStorage` after
successful changes.

Queuing and replaying service mutations for deferred server sync is being
deferred to the next iteration. Implementing it safely requires changes to
the way `ferdium-server` handles and responds to mutation requests (for
example: authoritative timestamps for conflict detection, idempotency keys,
or a structured batch-sync endpoint). Until those server-side API changes are
in place, the client keeps mutations server-required so it cannot introduce
conflicts or lost updates during an outage.

### 3. Exponential backoff for server-retry polling

The auto-retry loop (`RequestStore._autoRetry`) uses an explicit backoff
schedule to avoid hammering a struggling or recovering server:

| Attempt | Interval |
| ------- | -------- |
| 1       | 30s      |
| 2       | 1m       |
| 3       | 5m       |
| 4       | 15m      |
| 5+      | 1h (cap) |

This polling only checks whether the server is reachable again; it does not
flush any queued writes, because writes are not queued. The schedule resets
to 30s when:

- The user manually clicks "Retry sync" (starts fresh), OR
- The server comes back online (automatic recovery).

## What is out of scope (and why)

### A. Queued sync for service mutations

As described above, update / delete / reorder currently fail immediately when
the server is unreachable. A future iteration may apply those changes
optimistically to the local cache and enqueue them for deferred replay once
the server is reachable again. That work depends on `ferdium-server` API
changes: the server will need to handle out-of-order or duplicate mutations,
expose conflict-resolution metadata (e.g., server timestamps), and/or
provide a batch sync endpoint that the client can replay against safely.
Until those changes are designed and deployed, mutation queueing is out of
scope.

### B. Offline service creation

Service creation remains impossible while the server is offline. The
placeholder-ID approach described above could theoretically be built, but it
would require migrating Electron session data between partition names when
the placeholder ID is swapped for the server-assigned ID. That is a non-
trivial Electron-level operation, so creation stays blocked for now.

### C. UserStore writes (profile update, account deletion)

`UserStore._update` (`PUT /v1/me`) and `_delete` (`DELETE /v1/me`) are
infrequent operations that users rarely perform during a server outage. They
remain online-only. Low priority.

## Key files

| File                                                   | Purpose                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `src/stores/RequestStore.ts`                           | `serverConnection` state, `isWriteLocked`, exponential backoff                    |
| `src/stores/ServicesStore.ts`                          | Server-first writes for create/update/delete/reorder, scaffolding for queued sync |
| `src/components/settings/recipes/RecipeItem.tsx`       | Disabled state + tooltip                                                          |
| `src/components/layout/Sidebar.tsx`                    | Disabled "+" button                                                               |
| `src/components/settings/services/EditServiceForm.tsx` | Disabled save button                                                              |
| `src/components/auth/SetupAssistant.tsx`               | Disabled submit button                                                            |
| `src/styles/recipes.scss`                              | `.recipe-teaser--disabled`                                                        |
| `src/styles/layout.scss`                               | `.sidebar__button--disabled`                                                      |
