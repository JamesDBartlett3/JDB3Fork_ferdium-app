# API Connection Review Follow-ups

These lower-priority findings from the branch review are intentionally deferred.

## 1. Correct local-account workspace availability

`EditWorkspaceScreen` and `WorkspacesScreen` attempt to exempt local-only
accounts from the remote connection requirement, but their Boolean expression
reduces to `isServerConnected`. Use an explicit condition such as
`!isRemoteAccount || isServerConnected`, and verify both local and remote
account behavior.

## 2. Remove production diagnostic logging

The branch adds extensive `console.log` diagnostics to service model, webview,
loader, deletion, and synchronization paths. Remove temporary diagnostics or
route useful messages through the existing namespaced `debug` logger. Pay
particular attention to logs in render and frequently emitted webview lifecycle
paths.

## 3. Reconcile settings health checks and service syncs

`RequestStore.checkServerHealth()` and its loading overlay currently have no
caller. `SettingsWindow` instead performs a full service sync when settings
opens and on every settings route change. Decide whether settings should run a
lightweight health check or a full sync, remove the unused path, and avoid
unnecessary network and recipe-loading work during navigation.
