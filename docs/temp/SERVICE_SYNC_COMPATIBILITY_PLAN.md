# Service Sync Compatibility Plan

**Status:** Approved for implementation; implementation not started  
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

- [ ] Display cached services immediately.
- [ ] Fetch the current service list from the server in the background.
- [ ] If meaningful service settings match, update existing objects in place
      and continue without prompting.
- [ ] Keep webpage connections, event handlers, loading state, unread counts,
      crash state, and other client-only state attached to those same objects.

### Empty Local Cache

- [ ] Accept the server list without showing a conflict because no local
      service state can be lost.
- [ ] Create `Service` objects for the server entries.
- [ ] Save the accepted final state to the token-scoped cache.

### Local and Server Copies Differ

- [ ] Do not guess which copy is newer.
- [ ] Keep displaying the local cached copy.
- [ ] Save the complete pending server result, including the raw property
      information needed for later application.
- [ ] Keep the existing token-scoped cache unchanged while the conflict is
      pending.
- [ ] Show the existing conflict warning.
- [ ] Block synchronized changes until the conflict is resolved or dismissed
      according to the existing product behavior.
- [ ] Apply server settings in place only after the user chooses "Use server
      version."

### Services Added or Removed on the Server

- [ ] Create a new object for a genuinely new service.
- [ ] Remove the local object for a service absent from the accepted server
      list.
- [ ] Preserve the accepted server ordering while reusing existing object
      references.
- [ ] Confirm that service removal continues to use upstream's storage
      clearing and deferred partition cleanup behavior.

### Local-Only Accounts

- [ ] Treat `LOCAL_SERVER` as an account backed by Ferdium's embedded local
      API and SQLite database, not as an account with no persistence service at
      all.
- [ ] Never contact the configured remote Ferdium API while `LOCAL_SERVER` is
      selected.
- [ ] Continue using the embedded local API for service and workspace reads
      and writes.
- [ ] Continue allowing local-account service and workspace changes without
      depending on remote connection state, remote health checks, or remote retry
      backoff.
- [ ] Do not show remote synchronization conflicts when no remote synchronized
      account is involved.
- [ ] Treat the embedded local database as the accepted source for local-only
      account data because writes are already committed there before local state
      is changed.
- [ ] Keep failures of the embedded local API visible as local operational
      errors rather than presenting them as remote-account sync conflicts.

### Account or Server Changes During Sync

- [ ] Bind each sync and pending conflict to the account token, configured
      server, and local-only/remote mode that started it.
- [ ] Discard a response if that account context changes before the response is
      applied.
- [ ] Clear pending conflict data on logout, account change, and server change.
- [ ] Never display or apply one account's pending service data after another
      account becomes active.
- [ ] Keep account-specific cache data isolated during every transition.

## Phase 1: Define the Server Data Boundary

### 1.1 Add Explicit Service Synchronization Types

- [ ] Define a raw service response type for values received from
      `GET /me/services`.
- [ ] Define a prepared synchronization entry that keeps the raw response and
      its constructed `Service` model together.
- [ ] Define a synchronization result containing all prepared entries.
- [ ] Replace `any` in the touched synchronization path where practical,
      without expanding this into a repository-wide typing rewrite.

Recommended location:

- `src/api/server/ServerApi.ts` if the types remain local to that API.
- A focused `src/api/server/service-sync.ts` module if the types and field
  policy make `ServerApi.ts` harder to follow.

### 1.2 Preserve Raw Property Presence

- [ ] Change `ServerApi.getServices()` so it retains each raw response while
      preparing its corresponding `Service` model.
- [ ] Stop `ServerApi.getServices()` from caching an incoming response before
      conflict detection and user approval.
- [ ] Return the paired synchronization result through `ServicesApi.sync()`.
- [ ] Keep `ServicesApi.all()` cache-first and returning display-ready
      `Service` objects.
- [ ] Persist server data only after `ServicesStore` accepts it automatically
      as non-conflicting or the user chooses "Use server version."
- [ ] Leave create, update, delete, and reorder response shapes unchanged
      unless a focused test proves an adjustment is required.

### 1.3 Create an Explicit Field Policy

Classify every property used by `Service` into one of these groups:

- [ ] **Required server identity:** `id` and `recipeId`.
- [ ] **Server-owned persisted settings:** fields such as `name`, `order`,
      `team`, `customUrl`, notification settings, badge settings, mute state, dark
      mode settings, hibernation settings, proxy, icon settings, and user-agent
      preference.
- [ ] **Local metadata:** `updatedAt` while the server does not return a
      reliable comparable value.
- [ ] **Client-only runtime state:** webpage reference, attachment state,
      loading state, unread counts, crash state, dialog title, polling state,
      media state, and other values produced by the running app.
- [ ] **Ignored response fields:** server fields not represented by or relevant
      to the `Service` model, such as account identifiers.

For each server-owned property:

- [ ] If the raw response contains the property, apply its value even when
      that value is `null`, `false`, `0`, or an empty string.
- [ ] If the property is absent, follow the documented policy for that
      property instead of silently relying on constructor defaults.
- [ ] Use a known client default only where current server behavior clearly
      defines omission as that default.
- [ ] Otherwise preserve the existing local value and cover the decision with
      a test.

### 1.4 Separate Cache Failures From Connection Failures

- [ ] Handle `localStorage` write failures explicitly, including quota and
      unavailable-storage errors.
- [ ] Do not mark the server disconnected when the server request succeeded but
      local cache persistence failed.
- [ ] Keep accepted in-memory services usable after a cache failure.
- [ ] Surface or log a clear persistence warning so the user is not promised
      offline recovery that was not saved.
- [ ] Use the same safe persistence path after sync, create, update, delete,
      and reorder operations.

### 1.5 Handle Exceptional Identity Changes

- [ ] Treat matching service ID and recipe ID as the condition for safe
      in-place reuse.
- [ ] Treat a matching service ID with a different recipe ID as exceptional
      rather than changing the recipe beneath a live webpage.
- [ ] For that exceptional case, explicitly detach the old service, create the
      new service, and ensure React mounts a fresh service view.
- [ ] Add a focused test even though the current server is not expected to
      change a service's recipe ID.

## Phase 2: Apply Accepted Server Data in Place

### 2.1 Update the Synchronization Flow

Modify `ServicesStore._syncFromServer()`:

- [ ] Capture the active account/server context before starting the request.
- [ ] Receive the paired raw/model synchronization result.
- [ ] Re-check the account/server context before creating a conflict or
      applying the response, and discard stale results.
- [ ] Compare prepared server models with current local services using the
      existing meaningful-field comparison.
- [ ] If a non-empty local list differs, store the full pending synchronization
      result and return without changing displayed services.
- [ ] If no conflict exists, pass the full result to
      `_applyServerServices()`.
- [ ] Preserve error propagation so `RequestStore` can mark the connection as
      unavailable while cached services remain displayed.

### 2.2 Rework `_applyServerServices()`

- [ ] Build a lookup of current services by ID.
- [ ] Construct the next service array in accepted server order.
- [ ] Reuse the existing local object when both ID and recipe ID match.
- [ ] Apply only accepted server-owned properties to that existing object
      inside a MobX action.
- [ ] Do not copy a snapshot of client-only fields because the original object,
      event handlers, and live values are retained.
- [ ] Use the prepared new model for a genuinely new service.
- [ ] Exclude local objects absent from the accepted server list.
- [ ] Replace the request's service array with the new array of reused and new
      references.
- [ ] Cache the final accepted local array, not the temporary incoming model
      array.
- [ ] Clear the pending conflict only after application and cache persistence
      succeed.

The service array itself may be replaced. The important rule is that an
existing service inside that array keeps the same object reference.

### 2.3 Preserve Local Metadata Deliberately

- [ ] Keep `updatedAt` when applying a server response that does not supply it.
- [ ] Set or advance `updatedAt` after successful local create and update
      operations according to one documented rule.
- [ ] Do not use local `updatedAt` to decide whether server data is newer,
      because the server does not provide a comparable timestamp.
- [ ] Continue excluding `updatedAt` from conflict comparison.

### 2.4 Apply a Pending Server Copy Safely

Modify `ServicesStore.applyPendingServerSync()`:

- [ ] Pass the full pending raw/model result to `_applyServerServices()`.
- [ ] Reuse current service objects wherever identity matches.
- [ ] Keep the conflict visible if application fails.
- [ ] Clear the conflict only after successful application.

### 2.5 Make Conflict Resolution Honest and Complete

The current interface offers only "Use server version." It does not provide a
safe way to upload an arbitrary local service list, so it is not a true choice
between two equivalent versions.

- [ ] Do not tell users they can choose either copy unless a complete and safe
      "Keep local version" workflow is implemented.
- [ ] Explain that the local copy remains visible while writes are paused and
      that accepting the server copy resumes synchronized changes.
- [ ] Decide whether the unused `dismissPendingServerSync()` action should be
      removed or given explicit product behavior.
- [ ] Do not let dismissal silently unlock writes while unresolved copies still
      differ.
- [ ] Prevent repeated clicks on "Use server version" while application is in
      progress.

## Phase 3: Make Write Blocking Consistent

### 3.1 Define One Source of Truth

Modify `RequestStore`:

- [ ] Make `isWriteLocked` account-aware so local-only accounts are not blocked
      by remote connection state.
- [ ] Keep local embedded-API readiness separate from the remote-account write
      lock instead of reporting local startup as remote synchronization.
- [ ] For remote accounts, lock writes while connecting, disconnected, or
      waiting for conflict resolution.
- [ ] Make `_verifyServerWritable()` reject a remote synchronized write
      immediately when a conflict is pending.
- [ ] Keep the live health check before remote writes when no conflict is
      pending.
- [ ] Preserve the rule that a failed health check marks the connection
      disconnected.
- [ ] Do not treat a successful health check as proof that local and server
      data agree; full synchronization remains responsible for that decision.

### 3.2 Use the Shared Rule in Stores

Audit and retain a final store-level guard for:

- [ ] Service creation.
- [ ] Service updates, including enable/disable and notification updates.
- [ ] Service deletion.
- [ ] Service reordering.
- [ ] Workspace creation, updates, deletion, and service ordering.
- [ ] User profile updates and account deletion.
- [ ] Password recovery.
- [ ] User invitations.

Store-level checks remain necessary when the interface is disabled because
shortcuts, stale screens, or code outside the visible control can still invoke
an action.

### 3.3 Use the Shared Rule in the Interface

Replace connection-only checks with the shared write-lock result on mutating
controls:

- [ ] `src/components/layout/Sidebar.tsx` and
      `src/components/services/tabs/Tabbar.tsx` for adding and reordering services.
- [ ] `src/containers/settings/RecipesScreen.tsx`,
      `src/components/settings/recipes/RecipesDashboard.tsx`, and
      `src/components/settings/recipes/RecipeItem.tsx` for service creation entry
      points.
- [ ] `src/containers/settings/EditServiceScreen.tsx` and
      `src/components/settings/services/EditServiceForm.tsx` for service changes.
- [ ] `src/containers/settings/EditUserScreen.tsx` and
      `src/components/settings/user/EditUserForm.tsx` for user changes.
- [ ] `src/containers/settings/InviteScreen.tsx` and
      `src/components/auth/Invite.tsx` for invitations.
- [ ] Workspace screens, forms, dashboard, drawer, and store actions.
- [ ] Setup-assistant service creation controls.
- [ ] Settings-level conflict controls and banners.

Current local-only gaps that this audit must remove:

- [ ] `Sidebar` and `SetupAssistantScreen` currently consume
      `RequestStore.isWriteLocked`, which is not yet local-account aware.
- [ ] `WorkspaceDrawer`, `EditUserScreen`, and `InviteScreen` currently check
      raw `serverConnection` rather than account-aware write permission.
- [ ] `Tabbar` currently receives raw connection state for service reordering.
- [ ] Service and recipe screens mix raw connection state, conflict state, and
      local-account special cases instead of using one shared rule.
- [ ] `TabItem` context-menu mutations, including enable/disable,
      notifications, audio, dark mode, and deletion, currently lack write-lock
      state and can appear available when the store will reject them.
- [ ] The embedded local server currently logs startup failures without sending
      a failure state to the renderer; add an IPC error path and a distinct
      local-service error message.

### 3.4 Keep Non-Mutating Actions Available

- [ ] Keep opening and switching existing services available while offline.
- [ ] Keep cached services visible and usable.
- [ ] Keep the setup-assistant "Skip" action available.
- [ ] Keep local cache clearing and other device-only maintenance actions
      available unless they directly alter synchronized server data.
- [ ] Keep retry and "Use server version" controls available while normal
      writes are locked.

### 3.5 Use Clear Prop Names

- [ ] Prefer `isWriteLocked` or `canWriteSyncedData` for component props that
      include connectivity and conflict state.
- [ ] Reserve `isServerConnected` for displays that truly need only connection
      status.
- [ ] Remove separate `hasPendingSyncConflict` disabling props where the shared
      value makes them redundant, while preserving conflict-specific warning text
      where useful.

### 3.6 Preserve Accessibility When Controls Are Locked

- [ ] Use native `disabled` where the control supports it.
- [ ] Use `aria-disabled` and keyboard guards for custom controls that must
      remain hoverable for a tooltip.
- [ ] Ensure disabled context-menu commands are announced as unavailable.
- [ ] Verify keyboard shortcuts cannot bypass a locked visible control.

## Phase 4: Regression Tests

### 4.1 Server Response and Field-Policy Tests

Extend `test/api/ServerApi.test.ts` and its fixtures:

- [ ] A missing optional property remains distinguishable from an explicit
      `null`.
- [ ] Explicit `null`, `false`, `0`, and empty-string values survive
      preparation.
- [ ] Raw and prepared entries remain correctly paired by service ID.
- [ ] Reject the complete synchronization result if any raw service cannot be
      prepared, rather than interpreting the missing model as a server-side
      deletion.
- [ ] Distinguish a genuinely empty server list from a non-empty response whose
      services all failed model or recipe preparation.
- [ ] Token-scoped cache isolation and legacy cache migration continue passing.

### 4.2 In-Place Synchronization Tests

Extend `test/stores/ServicesStore.test.ts`:

- [ ] A matching service remains the exact same object after synchronization.
- [ ] Server-owned settings update on that object.
- [ ] Its webpage reference, attachment state, loading state, unread counts,
      crash state, and polling values remain intact.
- [ ] A simulated event callback still updates the object returned by
      `store.one(id)` after synchronization.
- [ ] A new server service creates a new object.
- [ ] A removed server service disappears from the final array.
- [ ] Accepted server ordering is reflected without replacing matching service
      objects.
- [ ] Final reused objects, including local metadata, are written to the cache.
- [ ] A recipe-ID change follows the exceptional replacement path and forces
      clean lifecycle setup.

### 4.3 Conflict Tests

Extend `test/stores/utils/services-sync-conflict.test.ts` and add store-level
coverage:

- [ ] Different response-array order alone is ignored.
- [ ] A different saved `order` property remains a meaningful conflict.
- [ ] `updatedAt` differences remain ignored.
- [ ] A meaningful setting difference creates a pending conflict without
      changing displayed services.
- [ ] A pending conflict leaves the token-scoped local cache unchanged.
- [ ] Restarting while a conflict is pending still loads the previously
      accepted local copy rather than the unapproved server copy.
- [ ] Choosing the server version updates existing objects in place.
- [ ] A failed application leaves the conflict pending.
- [ ] The client never claims to know which differing copy is newer.
- [ ] A second click while server-version application is running cannot apply
      the same pending result twice.

### 4.4 Account-Transition and Persistence Tests

- [ ] Logout during an in-flight sync cannot apply or display the old account's
      response afterward.
- [ ] Switching accounts during an in-flight sync cannot populate the new
      account with old-account services.
- [ ] Switching between a remote server and `LOCAL_SERVER` discards stale
      responses and pending conflicts from the previous mode.
- [ ] Logout clears pending conflict data immediately.
- [ ] A cache quota failure does not change a successful connection state to
      disconnected.
- [ ] A cache persistence failure leaves accepted in-memory services usable and
      reports the loss of offline persistence.

### 4.5 Write-Lock Tests

Add focused `RequestStore` and action tests:

- [ ] A remote account with a connected server and no conflict permits a write.
- [ ] A remote account while connecting blocks a write.
- [ ] A remote account while disconnected blocks a write.
- [ ] A remote account with a pending conflict blocks a write even when the
      health check succeeds.
- [ ] A local-only account bypasses remote-server availability checks.
- [ ] A local-only account does not perform a remote health request.
- [ ] A local-only account does not show a remote sync conflict when its
      embedded database and cache differ; the embedded database copy is applied.
- [ ] A local-only account still reads and writes through the embedded API.
- [ ] Failure to start or reach the embedded API is reported without entering
      the remote retry/conflict workflow.
- [ ] Service reorder does not run while conflict-locked.
- [ ] Service enable/disable does not run while conflict-locked.
- [ ] User and workspace writes do not run while conflict-locked.
- [ ] Retry and conflict-resolution actions remain available.

### 4.6 UI Tests Where Practical

- [ ] Verify the tab bar cannot start or finish sorting while write-locked.
- [ ] Verify recipe, service, user, invite, and workspace mutation controls are
      disabled from the same shared state.
- [ ] Verify conflict-specific text remains distinct from offline text where
      that distinction helps the user.
- [ ] Verify service context-menu mutations are disabled while write-locked,
      while device-only actions such as reload and cache clearing remain
      usable.
- [ ] Verify locked controls expose correct native or ARIA disabled state.
- [ ] Avoid broad snapshot tests; assert actual enabled and disabled behavior.

## Phase 5: Documentation Cleanup

### 5.1 Update `PR_DESCRIPTION.md`

- [ ] Remove the project-configuration section because upstream now owns the
      pnpm workspace configuration and the final branch matches upstream.
- [ ] Clarify that local `updatedAt` is preserved but is not proof of server
      freshness.
- [ ] Replace "ignore ordering" with the precise rule: response-array order is
      ignored, but each service's saved `order` value is meaningful.
- [ ] Explain that accepted server settings are applied to existing in-memory
      service objects.
- [ ] Explain that differing copies still require user resolution.
- [ ] Describe compatibility with upstream webpage lifecycle and storage
      cleanup fixes.
- [ ] Update validation totals only after final commands run, or avoid
      hard-coded totals that quickly become stale.

### 5.2 Update `docs/OFFLINE_WRITES.md`

- [ ] Remove the claim that user profile updates and account deletion remain
      unguarded or out of scope.
- [ ] Document the shared write-lock rule.
- [ ] Document the local-account exemption.
- [ ] Clarify that there is still no offline write queue.
- [ ] Clarify that conflict resolution does not determine freshness
      automatically.
- [ ] Keep offline service creation and deferred mutation replay explicitly out
      of scope.

### 5.3 Complete Localization

- [ ] Move added hard-coded user-facing text into `defineMessages`, including
      "Retry sync," user-settings lock messages, and invitation lock messages.
- [ ] Use different translated messages for a remote outage, a pending
      conflict, and an embedded local API failure.
- [ ] Run the repository translation-management command and review generated
      locale changes before committing them.

### 5.4 Keep This Plan Current

- [x] Copy the approved plan to
      `docs/SERVICE_SYNC_COMPATIBILITY_PLAN.md`.
- [ ] Check items as implementation and verification finish.
- [ ] Record approved deviations beside the affected item.
- [ ] Mark the document complete only after automated and manual verification.

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

- [ ] Confirm Node.js `24.18.1` and pnpm `11.20.0` are the versions actually
      used by pnpm subprocesses, with no engine warning.
- [ ] Update the recipes submodule checkout to the commit recorded by this
      branch before running tests.
- [ ] Run focused API synchronization tests.
- [ ] Run focused `ServicesStore` identity and conflict tests.
- [ ] Run focused `RequestStore` write-lock tests.
- [ ] Run focused UI behavior tests.
- [ ] Run `pnpm typecheck`.
- [ ] Run ESLint on all touched source and test files with zero warnings.
- [ ] Run `pnpm exec jest --runInBand`.
- [ ] Run `git diff --check`.
- [ ] Confirm no conflict markers remain.

### Pull Request Submission

- [ ] Complete every item in `.github/PULL_REQUEST_TEMPLATE.md`.
- [ ] Use `PR_DESCRIPTION.md` as the GitHub PR body, then remove that temporary
      submission file from the branch unless maintainers explicitly want it.
- [ ] Decide whether this implementation plan belongs in permanent upstream
      documentation; remove it from the final branch if it is only a working
      checklist.
- [ ] Include a concise release-note entry in the PR body.
- [ ] Attach screenshots of connecting, disconnected, conflict, and local-only
      states because this change alters visible interface behavior.
- [ ] Confirm the recipes submodule is clean and exactly matches the commit
      recorded by the parent repository.
- [ ] Review the final upstream diff for unrelated files before pushing.
- [ ] Give reviewers a short file-by-file guide because the feature spans API,
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

- [ ] Existing services retain object identity across accepted synchronization.
- [ ] Upstream webpage event handlers continue updating the displayed service
      after synchronization.
- [ ] Missing server properties and explicit empty values follow documented,
      tested rules.
- [ ] No server difference is automatically treated as newer when the client
      lacks freshness information.
- [ ] Pending conflicts block every synchronized mutation at UI and store
      levels.
- [ ] Local-only accounts remain functional.
- [ ] Upstream storage cleanup and lifecycle fixes remain intact.
- [ ] Cache-first startup and token isolation remain intact.
- [ ] Documentation accurately describes final behavior.
- [ ] Typecheck, lint, and all tests pass.
- [ ] Worktree is clean after the final commit.

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
- [ ] **Step 1:** Add raw-response synchronization types and field policy.
- [ ] **Step 2:** Add failing tests for object identity, property presence, and
      conflict locking.
- [ ] **Step 3:** Change synchronization to reuse existing service objects.
- [ ] **Step 4:** Make the write lock account-aware and enforce it centrally.
- [ ] **Step 5:** Update mutating UI controls to use the shared rule.
- [ ] **Step 6:** Run focused tests and repair failures related to this work.
- [ ] **Step 7:** Update PR and offline behavior documentation.
- [ ] **Step 8:** Run full automated and manual verification.
- [ ] **Gate 2:** Review the final diff before committing or pushing.
