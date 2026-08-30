## Summary

This PR makes service loading cache-first and centralizes Ferdium's handling of
server connectivity, synchronization, conflicts, and offline writes.

Cached services remain available during an outage, while operations that must
be synchronized are disabled or rejected until the server is reachable. Local
accounts continue to work without depending on remote connection state.

**Release note:** Services now load instantly from the local cache and stay
usable when the Ferdium server is unreachable. If service settings differ
between this device and the server, Ferdium keeps showing the local copy and
pauses synchronized changes until the server version is accepted. Existing
service tabs are no longer reloaded or disconnected by background
synchronization.

## Service Cache

- Load services from local cache during startup instead of blocking on the API.
- Synchronize with the server after cached services are available.
- Persist successful create, update, delete, reorder, and sync results.
- Scope cached services to a SHA-256 hash of the authentication token.
- Migrate legacy cache keys that contained the raw token.
- Isolate cached data between accounts.
- Validate cached payloads and recover from malformed or invalid entries.
- Preserve `recipeId` and locally generated `updatedAt` metadata.

## Synchronization and Conflicts

- Add an explicit service sync request separate from initial cache loading.
- Apply accepted server settings to the existing in-memory service objects,
  preserving their identity.
- Preserve webview references, loading state, unread counts, crash state, and
  other client-only runtime data by keeping the original objects rather than
  copying fields onto replacements.
- Detect meaningful differences between cached and server service data.
- Ignore response-array order during conflict detection; each service's saved
  `order` value is still meaningful and a difference in it remains a conflict.
- Preserve locally generated `updatedAt` metadata, but do not treat it as
  proof of server freshness (the server returns no comparable timestamp).
- Display a warning when local and server services conflict.
- Allow users to explicitly apply the server version. Copies that differ still
  require user resolution; the client never assumes which copy is newer.
- Refresh services after login and when the authentication token changes.
- Refresh user and feature data during the relevant connection flows.
- Bind each sync to the account token and configured server that started it;
  responses arriving after a logout, login, or server change are discarded.
- Clear pending conflict data immediately on logout and account change.

## Connection Handling

- Make `RequestStore.serverConnection` the central connection state.
- Track `connected`, `connecting`, and `disconnected` states.
- Prevent stale asynchronous checks from overwriting newer results.
- Retry failed synchronization using this schedule:
  - 30 seconds
  - 1 minute
  - 5 minutes
  - 15 minutes
  - 1 hour thereafter
- Reset retry state after reconnection or a manual retry.
- Show connecting and synchronization failure banners without blocking access
  to cached services.
- Keep service icons usable while the remote server is unavailable.
- Report embedded local server startup failures through a distinct banner with
  a restart action instead of treating them as remote sync problems.

## Offline Write Behavior

Remote synchronized writes are intentionally server-first and are not queued:

1. Verify the server is reachable.
2. Perform the server mutation.
3. Update and persist local state only after success.
4. Leave local state unchanged when the request fails.

This applies to:

- Service creation, updates, deletion, and reordering
- Workspace creation, updates, and deletion
- User profile updates and account deletion
- Password recovery
- User invitations

Service creation entry points, forms, settings, and reorder controls are
disabled while remote writes are unavailable. Tooltips and warning messages
explain why actions cannot be performed.

Local-account workspace operations remain available regardless of remote
connection state.

## Upstream compatibility

This change is compatible with upstream's webpage lifecycle and storage
cleanup fixes: accepted synchronization reuses existing `Service` objects, so
upstream's webpage event handlers remain connected, and service removal
continues to use upstream's storage clearing and deferred partition cleanup.

## Settings and UX

- Gate all synchronized mutation controls on the single shared
  `RequestStore.isWriteLocked` rule (account-aware: local-only accounts are
  never locked by remote state).
- Disable affected settings fields and submit actions while disconnected or
  while a conflict is pending.
- Disable service context-menu mutations (enable/disable, notifications,
  audio, dark mode, delete) while write-locked; device-only actions (reload,
  clear cache) and local runtime actions (hibernate) remain available.
- Keep non-mutating actions, such as opening services and skipping setup,
  available.
- Show pending synchronization conflicts in settings, with copy that explains
  the local copy stays visible and changes resume after accepting the server
  version.
- Prevent repeated "Use server version" clicks while application is running.
- Perform one remote service sync when settings opens.
- Avoid repeated sync and recipe-loading work when changing settings routes.
- Remove the unused settings health-check overlay and temporary diagnostics.
- Add translated English messages and styles for connection, conflict, local
  server failure, and disabled states.
- Fix related modal layout and spacing issues.

## Documentation

- Add `docs/OFFLINE_WRITES.md` describing cache-backed reads, server-required
  writes, retry behavior, and why deferred write queues and offline service
  creation remain out of scope.

## Testing

Added regression coverage for:

- Cache-first service loading
- Explicit server synchronization
- Cache persistence and failure propagation
- Token-scoped cache isolation
- Legacy cache-key migration
- Authentication-token hash memoization
- Real server payload conversion
- Raw/model pairing, missing-vs-null property handling, and rejection of
  unpreparable synchronization results
- In-place service object reuse, client-only state preservation, and the
  exceptional recipe-change replacement path
- Conflict detection, pending-conflict cache isolation, stale-response
  discard on account/server change, and double-apply prevention
- The account-aware write-lock matrix and embedded local server error handling
- Service synchronization conflict detection

Validation completed:

- `pnpm typecheck`
- `pnpm lint` (zero warnings on touched files)
- 19 Jest suites passed
- 177 tests passed
- 2 tests skipped

## Reviewer guide (file by file)

- `src/api/server/service-sync.ts` (new): raw-response types, the explicit
  server-owned field list, and the in-place field-application policy.
- `src/api/server/ServerApi.ts`: `getServices()` returns paired raw/model
  results and no longer caches before acceptance; cache writes are isolated
  from connection state.
- `src/stores/ServicesStore.ts`: in-place `_applyServerServices`,
  account-context binding in `_syncFromServer`, pending-conflict lifecycle,
  double-apply guard.
- `src/stores/RequestStore.ts`: account-aware `isWriteLocked`,
  conflict-aware `_verifyServerWritable`, embedded local server error state.
- `src/electron/ipc-api/localServer.ts`: reports startup failures to the
  renderer.
- UI (`Sidebar`, `Tabbar`, `TabItem`, settings/auth/workspace screens and
  forms): all mutating controls consume the shared write-lock.
- Tests: `test/api/ServerApi.test.ts`, `test/api/service-sync.test.ts`,
  `test/stores/ServicesStore.test.ts`, `test/stores/RequestStore.test.ts`,
  `test/stores/utils/services-sync-conflict.test.ts`.
- Docs: `docs/OFFLINE_WRITES.md`.

## Out of Scope

This PR does not add an offline mutation queue. Safely replaying deferred
writes requires server support for idempotency, authoritative conflict
metadata, or a structured batch synchronization endpoint.

Offline service creation is also excluded because replacing a temporary
client-generated service ID could orphan Electron session partitions and
stored login state.
