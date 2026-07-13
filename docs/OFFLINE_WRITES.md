# Offline-Aware Service Writes

This document describes the offline-resilience strategy for service write
operations (create, update, delete, reorder) and explains what is deliberately
**deferred** to a future version, so maintainers can evaluate the approach and
provide direction.

## Background

The client maintains a local cache of the user's services (in `localStorage`,
token-scoped). When the Ferdium server is unreachable, the client can still
*read* from this cache, so existing services remain usable. This PR extends
that resilience to *writes*, but with an important asymmetry between creation
and mutation.

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

### 2. Service mutations are queued for deferred sync

Update, delete, and reorder operate on **existing** IDs, so they don't have
the ID-mismatch problem. These are handled optimistically:

1. The local cache is patched immediately (the user sees their change).
2. The server write is attempted.
3. If the server is unreachable, the write is enqueued in a persistent queue
   (`services-write-queue.ts`, stored in `localStorage`, token-scoped).
4. When the server comes back, `RequestStore._flushPendingWritesThenSync()`
   replays the queue **before** the normal server sync runs. This ordering is
   critical: `_applyServerServices` does a wholesale replacement of local
   state, so pending writes must land on the server first or they'd be lost.

### 3. Exponential backoff for server-retry polling

The auto-retry loop (`RequestStore._autoRetry`) uses an explicit backoff
schedule to avoid hammering a struggling or recovering server:

| Attempt | Interval |
|---------|----------|
| 1       | 30s      |
| 2       | 1m       |
| 3       | 5m       |
| 4       | 15m      |
| 5+      | 1h (cap) |

The schedule resets to 30s when:
- The user manually clicks "Retry sync" (starts fresh), OR
- The server comes back online (automatic recovery).

## What is deferred (and why)

The following are deliberately **out of scope** for this PR. We'd welcome
maintainer feedback on whether and how to approach them.

### A. Offline service creation (placeholder ID + partition migration)

**The goal:** Let users create new services while the server is offline, with
a locally-generated placeholder ID, then swap it for the server-assigned ID
on reconnect.

**Why it's hard:** The Electron session partition for each service is
`persist:service-${id}` (`Service.ts:416`, `index.ts:693/717/737/804`). When
the placeholder ID is swapped for the real one, the partition name changes.
Any cookies, login state, or localStorage the user accumulated in the service
webview while offline would be orphaned. A proper fix requires migrating
Electron session data between partition names at swap time — a non-trivial
Electron-level operation.

**Alternative considered:** Block the webview from loading while the service
is in a pending-sync state. This avoids the partition problem but means the
service isn't actually usable while offline, which undermines the goal.

### B. UserStore writes (profile update, account deletion)

`UserStore._update` (`PUT /v1/me`) and `_delete` (`DELETE /v1/me`) are
infrequent operations that users rarely perform during a server outage. They
remain online-only. Low priority.

### C. Multi-client write conflict resolution for queued writes

If two clients edit the same service while both are offline, then both
reconnect, the writes replay in arrival order — last writer wins. The existing
read-side conflict UI (`hasPendingSyncConflict`, the "Use server version"
banner) handles the *read* path, but there's no equivalent prompt for
*write* conflicts. A more sophisticated approach (e.g., CRDTs, or a
server-side timestamp-based conflict detection) would be needed for true
multi-client offline collaboration.

## Key files

| File | Purpose |
|------|---------|
| `src/stores/utils/services-write-queue.ts` | Persistent write queue module |
| `src/stores/RequestStore.ts` | `isServerReachable`, exponential backoff, flush-on-recovery |
| `src/stores/ServicesStore.ts` | Optimistic write + enqueue, `_flushPendingWrites` |
| `src/components/settings/recipes/RecipeItem.tsx` | Disabled state + tooltip |
| `src/components/layout/Sidebar.tsx` | Disabled "+" button |
| `src/components/settings/services/EditServiceForm.tsx` | Disabled save button |
| `src/components/auth/SetupAssistant.tsx` | Disabled submit button |
| `src/styles/recipes.scss` | `.recipe-teaser--disabled` |
| `src/styles/layout.scss` | `.sidebar__button--disabled` |
| `test/stores/utils/services-write-queue.test.ts` | Queue unit tests |
