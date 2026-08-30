## Summary

This PR makes service loading cache-first and centralizes Ferdium's handling of
server connectivity, synchronization, conflicts, and offline writes.

Cached services remain available during an outage, while operations that must
be synchronized are disabled or rejected until the server is reachable. Local
accounts continue to work without depending on remote connection state.

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
- Preserve webview references, loading state, unread counts, crash state, and
  other client-only runtime data while applying server services.
- Detect meaningful differences between cached and server service data.
- Ignore ordering and `updatedAt`-only differences during conflict detection.
- Display a warning when local and server services conflict.
- Allow users to explicitly apply the server version.
- Refresh services after login and when the authentication token changes.
- Refresh user and feature data during the relevant connection flows.

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

## Settings and UX

- Disable affected settings fields and submit actions while disconnected.
- Keep non-mutating actions, such as opening services and skipping setup,
  available.
- Show pending synchronization conflicts in settings.
- Perform one remote service sync when settings opens.
- Avoid repeated sync and recipe-loading work when changing settings routes.
- Remove the unused settings health-check overlay and temporary diagnostics.
- Add translated English messages and styles for connection, conflict, and
  disabled states.
- Fix related modal layout and spacing issues.

## Project Configuration

- Move pnpm-specific settings from `package.json` to
  `pnpm-workspace.yaml`.
- Preserve dependency overrides, peer dependency allowances, deprecated
  package allowances, and native build dependency configuration.

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
- Service synchronization conflict detection

Validation completed:

- `pnpm typecheck`
- `pnpm lint`
- 9 Jest suites passed
- 97 tests passed
- 2 tests skipped

## Out of Scope

This PR does not add an offline mutation queue. Safely replaying deferred
writes requires server support for idempotency, authoritative conflict
metadata, or a structured batch synchronization endpoint.

Offline service creation is also excluded because replacing a temporary
client-generated service ID could orphan Electron session partitions and
stored login state.
