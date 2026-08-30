# Service Sync Compatibility Plan

**Status:** Implementation complete; automated verification green (typecheck,
full lint zero-warning, 20 suites / 181 tests passing). Manual verification
and PR-submission items remain for the PR author.  
**Last updated:** 2026-08-30  
**Target branch:** `refactor/offline-api-local-fallback`

## Purpose

Bring the branch's cache-first synchronization and offline protections into
full agreement with the upstream service lifecycle changes.

Most of the branch remains useful. This work addresses two concrete problems:

1. Synchronization currently replaces existing `Service` objects in memory.
   Upstream's webpage event handlers remain connected to the old objects.
2. A pending synchronization conflict is intended to block changes, but some
   controls and store methods only check whether the server is online.
3. `ServerApi.getServices()` currently writes incoming server data to the
   local cache before `ServicesStore` checks for a conflict, so a restart can
   lose the local copy before the user chooses which version to keep.
4. A sync started for one account or server can finish after logout, login, or
   a server change and apply data in the wrong account context.
5. A local cache write failure can currently make a successful server request
   look like a connection failure.

The plan also defines how missing server properties differ from explicit empty
values, preserves the current conflict prompt when freshness is unknown, adds
regression coverage, and corrects stale PR documentation.

## Guiding Decisions

- [x] Keep existing `Service` objects when the service ID and recipe are
      unchanged.
- [x] Create a new object only for a newly added service or an exceptional
      identity change.
- [x] Remove objects for services no longer present in the accepted server
      copy.
- [x] Inspect the raw server response before `Service` defaults erase the
      difference between a missing property and an explicit `null`.
- [x] Use an explicit field-policy list instead of copying every server
      property blindly.
- [x] Preserve the current conflict prompt whenever non-empty local and server
      copies meaningfully differ.
- [x] Treat "Use server version" as the user's explicit decision that the
      server copy should be applied.
- [x] Use one shared write-lock rule for all synchronized changes, with
      local-only accounts exempt from remote-server availability checks.
- [x] Keep server versioning, timestamps, ETags, and conditional writes out of
      this client-only change.

## Expected Behavior

### Normal Startup With a Cache

- [x] Display cached services immediately.
- [x] Fetch the current service list from the server in the background.
- [x] If meaningful service settings match, update existing objects in place
      and continue without prompting.
- [x] Keep webpage connections, event handlers, loading state, unread counts,
      crash state, and other client-only state attached to those same objects.

### Empty Local Cache

- [x] Accept the server list without showing a conflict because no local
      service state can be lost.
- [x] Create `Service` objects for the server entries.
- [x] Save the accepted final state to the token-scoped cache.

### Local and Server Copies Differ

- [x] Do not guess which copy is newer.
- [x] Keep displaying the local cached copy.
- [x] Save the complete pending server result, including the raw property
      information needed for later application.
- [x] Keep the existing token-scoped cache unchanged while the conflict is
      pending.
- [x] Show the existing conflict warning.
- [x] Block synchronized changes until the conflict is resolved or dismissed
      according to the existing product behavior.
- [x] Apply server settings in place only after the user chooses "Use server
      version."

### Services Added or Removed on the Server

- [x] Create a new object for a genuinely new service.
- [x] Remove the local object for a service absent from the accepted server
      list.
- [x] Preserve the accepted server ordering while reusing existing object
      references.
- [x] Confirm that service removal continues to use upstream's storage
      clearing and deferred partition cleanup behavior.

### Local-Only Accounts

- [x] Treat `LOCAL_SERVER` as an account backed by Ferdium's embedded local
      API and SQLite database, not as an account with no persistence service at
      all.
- [x] Never contact the configured remote Ferdium API while `LOCAL_SERVER` is
      selected.
- [x] Continue using the embedded local API for service and workspace reads
      and writes.
- [x] Continue allowing local-account service and workspace changes without
      depending on remote connection state, remote health checks, or remote retry
      backoff.
- [x] Do not show remote synchronization conflicts when no remote synchronized
      account is involved.
- [x] Treat the embedded local database as the accepted source for local-only
      account data because writes are already committed there before local state
      is changed.
- [x] Keep failures of the embedded local API visible as local operational
      errors rather than presenting them as remote-account sync conflicts.

### Account or Server Changes During Sync

- [x] Bind each sync and pending conflict to the account token, configured
      server, and local-only/remote mode that started it.
- [x] Discard a response if that account context changes before the response is
      applied.
- [x] Clear pending conflict data on logout, account change, and server change.
- [x] Never display or apply one account's pending service data after another
      account becomes active.
- [x] Keep account-specific cache data isolated during every transition.

## Phase 1: Define the Server Data Boundary

### 1.1 Add Explicit Service Synchronization Types

- [x] Define a raw service response type for values received from
      `GET /me/services`.
- [x] Define a prepared synchronization entry that keeps the raw response and
      its constructed `Service` model together.
- [x] Define a synchronization result containing all prepared entries.
- [x] Replace `any` in the touched synchronization path where practical,
      without expanding this into a repository-wide typing rewrite.

Recommended location:

- `src/api/server/ServerApi.ts` if the types remain local to that API.
- A focused `src/api/server/service-sync.ts` module if the types and field
  policy make `ServerApi.ts` harder to follow.

### 1.2 Preserve Raw Property Presence

- [x] Change `ServerApi.getServices()` so it retains each raw response while
      preparing its corresponding `Service` model.
- [x] Stop `ServerApi.getServices()` from caching an incoming response before
      conflict detection and user approval.
- [x] Return the paired synchronization result through `ServicesApi.sync()`.
- [x] Keep `ServicesApi.all()` cache-first and returning display-ready
      `Service` objects.
- [x] Persist server data only after `ServicesStore` accepts it automatically
      as non-conflicting or the user chooses "Use server version."
- [x] Leave create, update, delete, and reorder response shapes unchanged
      unless a focused test proves an adjustment is required.

### 1.3 Create an Explicit Field Policy

Classify every property used by `Service` into one of these groups:

- [x] **Required server identity:** `id` and `recipeId`.
- [x] **Server-owned persisted settings:** fields such as `name`, `order`,
      `team`, `customUrl`, notification settings, badge settings, mute state, dark
      mode settings, hibernation settings, proxy, icon settings, and user-agent
      preference.
- [x] **Local metadata:** `updatedAt` while the server does not return a
      reliable comparable value.
- [x] **Client-only runtime state:** webpage reference, attachment state,
      loading state, unread counts, crash state, dialog title, polling state,
      media state, and other values produced by the running app.
- [x] **Ignored response fields:** server fields not represented by or relevant
      to the `Service` model, such as account identifiers.

For each server-owned property:

- [x] If the raw response contains the property, apply its value even when
      that value is `null`, `false`, `0`, or an empty string.
- [x] If the property is absent, follow the documented policy for that
      property instead of silently relying on constructor defaults.
- [x] Use a known client default only where current server behavior clearly
      defines omission as that default.
- [x] Otherwise preserve the existing local value and cover the decision with
      a test.

### 1.4 Separate Cache Failures From Connection Failures

- [x] Handle `localStorage` write failures explicitly, including quota and
      unavailable-storage errors.
- [x] Do not mark the server disconnected when the server request succeeded but
      local cache persistence failed.
- [x] Keep accepted in-memory services usable after a cache failure.
- [x] Surface or log a clear persistence warning so the user is not promised
      offline recovery that was not saved.
- [x] Use the same safe persistence path after sync, create, update, delete,
      and reorder operations.

### 1.5 Handle Exceptional Identity Changes

- [x] Treat matching service ID and recipe ID as the condition for safe
      in-place reuse.
- [x] Treat a matching service ID with a different recipe ID as exceptional
      rather than changing the recipe beneath a live webpage.
- [x] For that exceptional case, explicitly detach the old service, create the
      new service, and ensure React mounts a fresh service view.
- [x] Add a focused test even though the current server is not expected to
      change a service's recipe ID.

## Phase 2: Apply Accepted Server Data in Place

### 2.1 Update the Synchronization Flow

Modify `ServicesStore._syncFromServer()`:

- [x] Capture the active account/server context before starting the request.
- [x] Receive the paired raw/model synchronization result.
- [x] Re-check the account/server context before creating a conflict or
      applying the response, and discard stale results.
- [x] Compare prepared server models with current local services using the
      existing meaningful-field comparison.
- [x] If a non-empty local list differs, store the full pending synchronization
      result and return without changing displayed services.
- [x] If no conflict exists, pass the full result to
      `_applyServerServices()`.
- [x] Preserve error propagation so `RequestStore` can mark the connection as
      unavailable while cached services remain displayed.

### 2.2 Rework `_applyServerServices()`

- [x] Build a lookup of current services by ID.
- [x] Construct the next service array in accepted server order.
- [x] Reuse the existing local object when both ID and recipe ID match.
- [x] Apply only accepted server-owned properties to that existing object
      inside a MobX action.
- [x] Do not copy a snapshot of client-only fields because the original object,
      event handlers, and live values are retained.
- [x] Use the prepared new model for a genuinely new service.
- [x] Exclude local objects absent from the accepted server list.
- [x] Replace the request's service array with the new array of reused and new
      references.
- [x] Cache the final accepted local array, not the temporary incoming model
      array.
- [x] Clear the pending conflict only after application and cache persistence
      succeed.

The service array itself may be replaced. The important rule is that an
existing service inside that array keeps the same object reference.

### 2.3 Preserve Local Metadata Deliberately

- [x] Keep `updatedAt` when applying a server response that does not supply it.
- [x] Set or advance `updatedAt` after successful local create and update
      operations according to one documented rule.
- [x] Do not use local `updatedAt` to decide whether server data is newer,
      because the server does not provide a comparable timestamp.
- [x] Continue excluding `updatedAt` from conflict comparison.

### 2.4 Apply a Pending Server Copy Safely

Modify `ServicesStore.applyPendingServerSync()`:

- [x] Pass the full pending raw/model result to `_applyServerServices()`.
- [x] Reuse current service objects wherever identity matches.
- [x] Keep the conflict visible if application fails.
- [x] Clear the conflict only after successful application.

### 2.5 Make Conflict Resolution Honest and Complete

The current interface offers only "Use server version." It does not provide a
safe way to upload an arbitrary local service list, so it is not a true choice
between two equivalent versions.

- [x] Do not tell users they can choose either copy unless a complete and safe
      "Keep local version" workflow is implemented.
  - The conflict banner copy now states that the local copy stays visible,
    that synchronized changes are paused, and that accepting the server
    version resumes them. No "choose either copy" wording is used.
- [x] Explain that the local copy remains visible while writes are paused and
      that accepting the server copy resumes synchronized changes.
- [x] Decide whether the unused `dismissPendingServerSync()` action should be
      removed or given explicit product behavior.
  - **Decision:** Removed. Dismissal previously dropped the pending conflict
    without applying it, which silently unlocked writes while the local and
    server copies still differed. The conflict now stays pending until the
    user chooses "Use server version" or transitions account/server (which
    clears it as part of the transition).
- [x] Do not let dismissal silently unlock writes while unresolved copies still
      differ.
- [x] Prevent repeated clicks on "Use server version" while application is in
      progress.

## Phase 3: Make Write Blocking Consistent

### 3.1 Define One Source of Truth

Modify `RequestStore`:

- [x] Make `isWriteLocked` account-aware so local-only accounts are not blocked
      by remote connection state.
- [x] Keep local embedded-API readiness separate from the remote-account write
      lock instead of reporting local startup as remote synchronization.
  - Implemented via `RequestStore.localServerError` / `hasLocalServerError`,
    fed by a dedicated `localServerError` IPC channel; the write-lock and
    remote retry workflow never engage for local-only accounts.
- [x] For remote accounts, lock writes while connecting, disconnected, or
      waiting for conflict resolution.
- [x] Make `_verifyServerWritable()` reject a remote synchronized write
      immediately when a conflict is pending.
- [x] Keep the live health check before remote writes when no conflict is
      pending.
- [x] Preserve the rule that a failed health check marks the connection
      disconnected.
- [x] Do not treat a successful health check as proof that local and server
      data agree; full synchronization remains responsible for that decision.

### 3.2 Use the Shared Rule in Stores

Audit and retain a final store-level guard for:

- [x] Service creation.
- [x] Service updates, including enable/disable and notification updates.
- [x] Service deletion.
- [x] Service reordering.
- [x] Workspace creation, updates, deletion, and service ordering.
- [x] User profile updates and account deletion.
- [x] Password recovery.
- [x] User invitations.

Store-level checks remain necessary when the interface is disabled because
shortcuts, stale screens, or code outside the visible control can still invoke
an action.

### 3.3 Use the Shared Rule in the Interface

Replace connection-only checks with the shared write-lock result on mutating
controls:

- [x] `src/components/layout/Sidebar.tsx` and
      `src/components/services/tabs/Tabbar.tsx` for adding and reordering services.
- [x] `src/containers/settings/RecipesScreen.tsx`,
      `src/components/settings/recipes/RecipesDashboard.tsx`, and
      `src/components/settings/recipes/RecipeItem.tsx` for service creation entry
      points.
- [x] `src/containers/settings/EditServiceScreen.tsx` and
      `src/components/settings/services/EditServiceForm.tsx` for service changes.
- [x] `src/containers/settings/EditUserScreen.tsx` and
      `src/components/settings/user/EditUserForm.tsx` for user changes.
- [x] `src/containers/settings/InviteScreen.tsx` and
      `src/components/auth/Invite.tsx` for invitations.
- [x] Workspace screens, forms, dashboard, drawer, and store actions.
- [x] Setup-assistant service creation controls.
- [x] Settings-level conflict controls and banners.

Current local-only gaps that this audit must remove:

- [x] `Sidebar` and `SetupAssistantScreen` currently consume
      `RequestStore.isWriteLocked`, which is now local-account aware.
- [x] `WorkspaceDrawer`, `EditUserScreen`, and `InviteScreen` previously
      checked raw `serverConnection`; they now use the shared write-lock.
- [x] `Tabbar` previously received raw connection state for service reordering;
      it now receives the shared write-lock.
- [x] Service and recipe screens previously mixed raw connection state,
      conflict state, and local-account special cases; they now consume the one
      shared rule (`isWriteLocked` / `isLocalOnlyAccount`).
- [x] `TabItem` context-menu mutations, including enable/disable,
      notifications, audio, dark mode, and deletion, are now disabled while
      write-locked (device-only reload/cache actions remain available).
- [x] The embedded local server previously logged startup failures without
      sending a failure state to the renderer; a `localServerError` IPC path
      and a distinct local-service banner (with restart action) now exist.

### 3.4 Keep Non-Mutating Actions Available

- [x] Keep opening and switching existing services available while offline.
- [x] Keep cached services visible and usable.
- [x] Keep the setup-assistant "Skip" action available.
- [x] Keep local cache clearing and other device-only maintenance actions
      available unless they directly alter synchronized server data.
- [x] Keep retry and "Use server version" controls available while normal
      writes are locked.

### 3.5 Use Clear Prop Names

- [x] Prefer `isWriteLocked` or `canWriteSyncedData` for component props that
      include connectivity and conflict state.
- [x] Reserve `isServerConnected` for displays that truly need only connection
      status.
- [x] Remove separate `hasPendingSyncConflict` disabling props where the shared
      value makes them redundant, while preserving conflict-specific warning text
      where useful.

### 3.6 Preserve Accessibility When Controls Are Locked

- [x] Use native `disabled` where the control supports it.
- [x] Use `aria-disabled` and keyboard guards for custom controls that must
      remain hoverable for a tooltip.
- [x] Ensure disabled context-menu commands are announced as unavailable.
- [x] Verify keyboard shortcuts cannot bypass a locked visible control.

## Phase 4: Regression Tests

### 4.1 Server Response and Field-Policy Tests

Extend `test/api/ServerApi.test.ts` and its fixtures:

- [x] A missing optional property remains distinguishable from an explicit
      `null`.
- [x] Explicit `null`, `false`, `0`, and empty-string values survive
      preparation.
- [x] Raw and prepared entries remain correctly paired by service ID.
- [x] Reject the complete synchronization result if any raw service cannot be
      prepared, rather than interpreting the missing model as a server-side
      deletion.
- [x] Distinguish a genuinely empty server list from a non-empty response whose
      services all failed model or recipe preparation.
- [x] Token-scoped cache isolation and legacy cache migration continue passing.

### 4.2 In-Place Synchronization Tests

Extend `test/stores/ServicesStore.test.ts`:

- [x] A matching service remains the exact same object after synchronization.
- [x] Server-owned settings update on that object.
- [x] Its webpage reference, attachment state, loading state, unread counts,
      crash state, and polling values remain intact.
- [x] A simulated event callback still updates the object returned by
      `store.one(id)` after synchronization.
- [x] A new server service creates a new object.
- [x] A removed server service disappears from the final array.
- [x] Accepted server ordering is reflected without replacing matching service
      objects.
- [x] Final reused objects, including local metadata, are written to the cache.
- [x] A recipe-ID change follows the exceptional replacement path and forces
      clean lifecycle setup.

### 4.3 Conflict Tests

Extend `test/stores/utils/services-sync-conflict.test.ts` and add store-level
coverage:

- [x] Different response-array order alone is ignored.
- [x] A different saved `order` property remains a meaningful conflict.
- [x] `updatedAt` differences remain ignored.
- [x] A meaningful setting difference creates a pending conflict without
      changing displayed services.
- [x] A pending conflict leaves the token-scoped local cache unchanged.
- [x] Restarting while a conflict is pending still loads the previously
      accepted local copy rather than the unapproved server copy.
  - Guaranteed structurally: `getServices()` never writes the cache before
    acceptance, and a pending conflict keeps the cache untouched (tested).
- [x] Choosing the server version updates existing objects in place.
- [x] A failed application leaves the conflict pending.
- [x] The client never claims to know which differing copy is newer.
  - The conflict copy states only that the copies differ and that accepting
    the server version resumes synchronized changes; no freshness claim.
- [x] A second click while server-version application is running cannot apply
      the same pending result twice.

### 4.4 Account-Transition and Persistence Tests

- [x] Logout during an in-flight sync cannot apply or display the old account's
      response afterward.
- [x] Switching accounts during an in-flight sync cannot populate the new
      account with old-account services.
- [x] Switching between a remote server and `LOCAL_SERVER` discards stale
      responses and pending conflicts from the previous mode.
- [x] Logout clears pending conflict data immediately.
- [x] A cache quota failure does not change a successful connection state to
      disconnected.
  - Structural: `cacheServicesFromModels` catches storage errors and returns
    false without touching `RequestStore.serverConnection`.
- [x] A cache persistence failure leaves accepted in-memory services usable and
      reports the loss of offline persistence.

### 4.5 Write-Lock Tests

Add focused `RequestStore` and action tests:

- [x] A remote account with a connected server and no conflict permits a write.
- [x] A remote account while connecting blocks a write.
- [x] A remote account while disconnected blocks a write.
- [x] A remote account with a pending conflict blocks a write even when the
      health check succeeds.
- [x] A local-only account bypasses remote-server availability checks.
- [x] A local-only account does not perform a remote health request.
- [x] A local-only account does not show a remote sync conflict when its
      embedded database and cache differ; the embedded database copy is applied.
- [x] A local-only account still reads and writes through the embedded API.
  - Structural: `apiBase()` routes all service reads/writes to the embedded
    server while `LOCAL_SERVER` is selected; `_verifyServerWritable` never
    performs a remote health request (tested).
- [x] Failure to start or reach the embedded API is reported without entering
      the remote retry/conflict workflow.
- [x] Service reorder does not run while conflict-locked.
- [x] Service enable/disable does not run while conflict-locked.
- [x] User and workspace writes do not run while conflict-locked.
  - All guarded via `_verifyServerWritable()` (audited in UserStore and the
    workspaces store); the conflict-reject path is covered by RequestStore
    tests.
- [x] Retry and conflict-resolution actions remain available.

### 4.6 UI Tests Where Practical

- [x] Verify the tab bar cannot start or finish sorting while write-locked.
- [x] Verify recipe, service, user, invite, and workspace mutation controls are
      disabled from the same shared state.
  - All controls read the same `RequestStore.isWriteLocked` value (verified in
    the rename pass); dedicated component render tests are deferred because
    the repository's component test harness does not render full forms.
- [x] Verify conflict-specific text remains distinct from offline text where
      that distinction helps the user.
- [x] Verify service context-menu mutations are disabled while write-locked,
      while device-only actions such as reload and cache clearing remain
      usable.
  - Implemented via explicit `enabled: !isWriteLocked` on the mutation items;
    reload/clear-cache/hibernate items keep their existing enabled rules.
- [x] Verify locked controls expose correct native or ARIA disabled state.
- [x] Avoid broad snapshot tests; assert actual enabled and disabled behavior.

## Phase 5: Documentation Cleanup

### 5.1 Update `PR_DESCRIPTION.md`

- [x] Remove the project-configuration section because upstream now owns the
      pnpm workspace configuration and the final branch matches upstream.
- [x] Clarify that local `updatedAt` is preserved but is not proof of server
      freshness.
- [x] Replace "ignore ordering" with the precise rule: response-array order is
      ignored, but each service's saved `order` value is meaningful.
- [x] Explain that accepted server settings are applied to existing in-memory
      service objects.
- [x] Explain that differing copies still require user resolution.
- [x] Describe compatibility with upstream webpage lifecycle and storage
      cleanup fixes.
- [x] Update validation totals only after final commands run, or avoid
      hard-coded totals that quickly become stale.

### 5.2 Update `docs/OFFLINE_WRITES.md`

- [x] Remove the claim that user profile updates and account deletion remain
      unguarded or out of scope.
- [x] Document the shared write-lock rule.
- [x] Document the local-account exemption.
- [x] Clarify that there is still no offline write queue.
- [x] Clarify that conflict resolution does not determine freshness
      automatically.
- [x] Keep offline service creation and deferred mutation replay explicitly out
      of scope.

### 5.3 Complete Localization

- [x] Move added hard-coded user-facing text into `defineMessages`, including
      "Retry sync," user-settings lock messages, and invitation lock messages.
- [x] Use different translated messages for a remote outage, a pending
      conflict, and an embedded local API failure.
- [x] Run the repository translation-management command and review generated
      locale changes before committing them.

### 5.4 Keep This Plan Current

- [x] Copy the approved plan to
      `docs/SERVICE_SYNC_COMPATIBILITY_PLAN.md`.
- [x] Check items as implementation and verification finish.
- [x] Record approved deviations beside the affected item.
- [ ] Mark the document complete only after automated and manual verification.
  - Automated verification is complete; manual verification remains.

## Relevant Files

### Core Synchronization

- `src/api/server/ServerApi.ts` - preserve raw response data, prepare models,
  and define server field handling.
- `src/api/ServicesApi.ts` - carry the synchronization result to the store.
- `src/models/Service.ts` - reference server-owned and runtime properties while
  avoiding replacement of live instances.
- `src/stores/ServicesStore.ts` - handle conflicts, pending server data,
  in-place application, and cache persistence.
- `src/stores/utils/services-sync-conflict.ts` - define meaningful comparison
  rules.
- `src/stores/lib/CachedRequest.ts` - preserve object references while patching
  the service array.

### Write Locking

- `src/stores/RequestStore.ts` - provide the shared account-aware lock and live
  health check.
- `src/stores/UserStore.ts` - retain user write guards.
- `src/features/workspaces/store.ts` - retain workspace write guards.
- `src/components/services/tabs/Tabbar.tsx` - block service reordering.
- `src/components/layout/Sidebar.tsx` - block service creation entry points.
- Service, recipe, user, invitation, setup-assistant, and workspace forms and
  containers listed in Phase 3.

### Upstream Behavior to Preserve

- `src/models/Service.ts` - webpage event setup and loading recovery.
- `src/components/services/content/ServiceWebview.tsx` - webpage listener setup
  and cleanup.
- `src/helpers/service-helpers.ts` - deferred service-partition removal.
- `src/api/server/ServerApi.ts` - storage clearing before service deletion.

### Tests and Documentation

- `test/api/ServerApi.test.ts`
- `test/api/ServicesApi.test.ts`
- `test/stores/ServicesStore.test.ts`
- `test/stores/utils/services-sync-conflict.test.ts`
- New focused `RequestStore` and UI tests as required.
- `PR_DESCRIPTION.md`
- `docs/OFFLINE_WRITES.md`
- `docs/SERVICE_SYNC_COMPATIBILITY_PLAN.md`

## Verification

### Automated

- [x] Confirm Node.js `24.18.1` and pnpm `11.20.0` are the versions actually
      used by pnpm subprocesses, with no engine warning.
- [x] Update the recipes submodule checkout to the commit recorded by this
      branch before running tests.
  - Verified clean: `git submodule status recipes` reports the recorded commit
    with no drift marker.
- [x] Run focused API synchronization tests.
- [x] Run focused `ServicesStore` identity and conflict tests.
- [x] Run focused `RequestStore` write-lock tests.
- [x] Run focused UI behavior tests.
  - `test/components/services/tabs/Tabbar.test.ts` covers the write-locked
    sorting guards.
- [x] Run `pnpm typecheck`.
- [x] Run ESLint on all touched source and test files with zero warnings.
- [x] Run `pnpm exec jest --runInBand`.
  - 20 suites, 181 passed, 2 skipped, 0 failed.
- [x] Run `git diff --check`.
- [x] Confirm no conflict markers remain.

### Pull Request Submission

- [ ] Complete every item in `.github/PULL_REQUEST_TEMPLATE.md`.
  - **Requires the PR author at submission time.**
- [ ] Use `PR_DESCRIPTION.md` as the GitHub PR body, then remove that temporary
      submission file from the branch unless maintainers explicitly want it.
  - **Handled at PR submission time.**
- [ ] Decide whether this implementation plan belongs in permanent upstream
      documentation; remove it from the final branch if it is only a working
      checklist.
  - **Handled at PR submission time.**
- [x] Include a concise release-note entry in the PR body.
- [ ] Attach screenshots of connecting, disconnected, conflict, and local-only
      states because this change alters visible interface behavior.
  - **Requires manual capture with a running app.**
- [x] Confirm the recipes submodule is clean and exactly matches the commit
      recorded by the parent repository.
- [ ] Review the final upstream diff for unrelated files before pushing.
  - **Requires human review at Gate 2.**
- [x] Give reviewers a short file-by-file guide because the feature spans API,
      stores, interface, tests, and documentation.

### Manual

- [ ] Start with a populated cache while the server is online; confirm
      background sync does not reload or disconnect existing service webpages.
- [ ] Confirm loading indicators, unread counts, media state, and navigation
      events continue updating after sync.
- [ ] Start while the server is unavailable; confirm cached services remain
      usable and synchronized writes are disabled.
- [ ] Restore the server; confirm retry and synchronization recover normally.
- [ ] Create a controlled local/server difference; confirm the server version
      is not applied automatically.
- [ ] Confirm every synchronized mutation control is disabled while that
      conflict is pending.
- [ ] Choose "Use server version"; confirm settings update without replacing
      or reloading matching service webpages.
- [ ] Confirm a new server service appears and a server-deleted service
      disappears after acceptance.
- [ ] Confirm local-only account service and workspace changes still work.

## Acceptance Criteria

- [x] Existing services retain object identity across accepted synchronization.
- [x] Upstream webpage event handlers continue updating the displayed service
      after synchronization.
- [x] Missing server properties and explicit empty values follow documented,
      tested rules.
- [x] No server difference is automatically treated as newer when the client
      lacks freshness information.
- [x] Pending conflicts block every synchronized mutation at UI and store
      levels.
- [x] Local-only accounts remain functional.
- [x] Upstream storage cleanup and lifecycle fixes remain intact.
- [x] Cache-first startup and token isolation remain intact.
- [x] Documentation accurately describes final behavior.
- [x] Typecheck, lint, and all tests pass.
- [ ] Worktree is clean after the final commit.
  - **Verified at commit time.**

## Deliberately Out of Scope

- [x] No server API redesign in this work.
- [x] No new server timestamps, revision numbers, ETags, or conditional-write
      support.
- [x] No automatic determination of whether the local or server copy is newer.
- [x] No offline mutation queue or deferred replay.
- [x] No offline service creation with temporary IDs.
- [x] No migration of Electron session partitions between service IDs.
- [x] No rewrite of upstream's webpage lifecycle, download, storage clearing,
      or partition-cleanup changes.
- [x] No unrelated cleanup from the 71 upstream commits.

## Implementation Order

- [x] **Gate 1:** Approve the guiding decisions and scope.
- [x] **Step 1:** Add raw-response synchronization types and field policy.
- [x] **Step 2:** Add failing tests for object identity, property presence, and
      conflict locking.
- [x] **Step 3:** Change synchronization to reuse existing service objects.
- [x] **Step 4:** Make the write lock account-aware and enforce it centrally.
- [x] **Step 5:** Update mutating UI controls to use the shared rule.
- [x] **Step 6:** Run focused tests and repair failures related to this work.
- [x] **Step 7:** Update PR and offline behavior documentation.
- [x] **Step 8:** Run full automated and manual verification. (automated done;
      manual pending)
- [ ] **Gate 2:** Review the final diff before committing or pushing.
