import { ipcRenderer } from 'electron';
import {
  action,
  computed,
  makeObservable,
  observable,
  runInAction,
} from 'mobx';
import ms from 'ms';

import type { Stores } from '../@types/stores.types';
import type { Actions } from '../actions/lib/actions';
import type { ApiInterface } from '../api';
import { LOCAL_HOSTNAME, LOCAL_PORT, LOCAL_SERVER } from '../config';
import type CachedRequest from './lib/CachedRequest';
import type Request from './lib/Request';

import TypedStore from './lib/TypedStore';

const debug = require('../preload-safe-debug')('Ferdium:RequestsStore');

// Exponential backoff schedule for auto-retrying when the Ferdium server is
// unreachable. Only runs while `serverConnection === 'disconnected'`. When
// connected, no background polling happens at all.
const RETRY_INTERVALS_MS = [ms('30s'), ms('1m'), ms('5m'), ms('15m'), ms('1h')];
const RETRY_INTERVAL_CAP_MS = ms('1h');

export type ServerConnectionState = 'connected' | 'connecting' | 'disconnected';

export default class RequestStore extends TypedStore {
  @observable userInfoRequest: CachedRequest;

  @observable servicesRequest: CachedRequest;

  @observable syncServicesRequest: Request;

  // Single source of truth for server connection state.
  // - 'connected': last check succeeded — writes enabled
  // - 'connecting': check in progress — writes disabled, purple banner
  // - 'disconnected': last check failed — writes disabled, red banner
  // Always starts as 'connecting' on app startup.
  @observable serverConnection: ServerConnectionState = 'connecting';

  @observable localServerPort = LOCAL_PORT;

  @observable localServerToken: string | undefined;

  // Set when the embedded local API fails to start or becomes unreachable.
  // Kept separate from the remote-account write lock: a local server failure
  // is a local operational error, not a remote synchronization problem.
  @observable localServerError: string | null = null;

  // Backoff state (only used while disconnected).
  _backoffIndex: number = 0;

  _isBackoffScheduled: boolean = false;

  _backoffTimer: ReturnType<typeof setTimeout> | null = null;

  _connectionCheckId: number = 0;

  constructor(stores: Stores, api: ApiInterface, actions: Actions) {
    super(stores, api, actions);

    makeObservable(this);

    this.actions.requests.retryRequiredRequests.listen(
      this._retryRequiredRequests.bind(this),
    );

    this.registerReactions([this._autoRetry.bind(this)]);

    this.userInfoRequest = {} as CachedRequest;
    this.servicesRequest = {} as CachedRequest;
    this.syncServicesRequest = {} as Request;
  }

  async setup(): Promise<void> {
    this.userInfoRequest = this.stores.user.getUserInfoRequest;
    this.servicesRequest = this.stores.services.allServicesRequest;
    this.syncServicesRequest = this.stores.services.syncServicesRequest;

    ipcRenderer.on('localServerPort', (_, data) => {
      this.setData(data);
      // The embedded server reported its port — clear any prior failure.
      runInAction(() => {
        this.localServerError = null;
      });
    });

    ipcRenderer.on('localServerError', (_, data) => {
      runInAction(() => {
        this.localServerError =
          data?.message ?? 'The embedded local server failed to start';
      });
    });
  }

  // True when the embedded local API failed to start while a local-only
  // account is active. Reported separately from remote sync state.
  @computed get hasLocalServerError(): boolean {
    return this.isLocalOnlyAccount && this.localServerError !== null;
  }

  // Ask the main process to retry starting the embedded local server.
  @action _retryLocalServer(): void {
    this.localServerError = null;
    ipcRenderer.send('startLocalServer');
  }

  // True when the active account is backed by Ferdium's embedded local API
  // (LOCAL_SERVER). Local-only accounts are exempt from remote connection
  // state and remote health checks.
  @computed get isLocalOnlyAccount(): boolean {
    return this.stores.settings.all.app.server === LOCAL_SERVER;
  }

  /**
   * Single shared write-lock rule for all synchronized changes.
   *
   * - Local-only accounts: never locked by remote connection state; the
   *   embedded local API is their source of truth and is always writable
   *   once running.
   * - Remote accounts: locked while connecting, disconnected, or waiting for
   *   a synchronization conflict to be resolved.
   */
  @computed get isWriteLocked(): boolean {
    if (this.isLocalOnlyAccount) {
      return false;
    }
    return (
      this.serverConnection !== 'connected' ||
      this.stores.services.hasPendingSyncConflict
    );
  }

  /**
   * What the UI banners should display. This differs from the internal
   * `serverConnection` state: when the server is unreachable we keep retrying
   * on an exponential backoff. The UI must show the purple "Connecting…"
   * banner for the ENTIRE retry schedule — the red "Unable to sync" banner
   * only appears once all retries are exhausted (backoff index has reached
   * the cap and the next scheduled attempt would be >= the cap interval).
   *
   * Internally `serverConnection` still flips to 'disconnected' on each failed
   * attempt (so writes are locked and _autoRetry schedules the next backoff),
   * but the user should not see red until we've genuinely given up.
   */
  @computed get connectionDisplayState(): ServerConnectionState {
    if (this.serverConnection === 'connected') {
      return 'connected';
    }
    // While we still have meaningful retries left (backoff index hasn't
    // reached the last/cap interval), display 'connecting' (purple banner).
    if (this._backoffIndex < RETRY_INTERVALS_MS.length) {
      return 'connecting';
    }
    // All retries exhausted — show the red banner.
    return 'disconnected';
  }

  @computed get areRequiredRequestsLoading(): boolean {
    return this.userInfoRequest.isExecuting || this.servicesRequest.isExecuting;
  }

  @computed get localServerOrigin(): string {
    return `http://${LOCAL_HOSTNAME}:${this.localServerPort}`;
  }

  @action _retryRequiredRequests(): void {
    // User-initiated retry: reset the backoff schedule and check connection.
    this._clearScheduledRetry();
    this._backoffIndex = 0;
    this._checkServerConnection();
  }

  /**
   * The single connection-check entry point. Sets state to 'connecting',
   * attempts a sync, and resolves to 'connected' or 'disconnected'.
   */
  async _checkServerConnection(): Promise<void> {
    this._clearScheduledRetry();
    this._connectionCheckId += 1;
    const checkId = this._connectionCheckId;
    runInAction(() => {
      this.serverConnection = 'connecting';
    });
    try {
      await this.stores.services._syncFromServer();
      if (checkId !== this._connectionCheckId) return;
      runInAction(() => {
        this.serverConnection = 'connected';
      });
    } catch {
      if (checkId !== this._connectionCheckId) return;
      runInAction(() => {
        this.serverConnection = 'disconnected';
      });
    }
  }

  @action _triggerServerSync(): void {
    this._checkServerConnection();
  }

  /**
   * Verify that the server is live and ready to accept writes. This is a
   * lightweight health check (not a full sync). Called before every write
   * operation that needs server confirmation.
   *
   * - For LOCAL_SERVER accounts, returns true immediately (no server check needed)
   * - For remote accounts, performs a live health check
   * - On failure, sets serverConnection='disconnected' and returns false
   * - On success, returns true (but does NOT change serverConnection)
   *
   * This is different from _checkServerConnection which does a full sync and
   * may set connection='connected'. This method only confirms the server is
   * reachable; it doesn't update full connection state.
   */
  async _verifyServerWritable(): Promise<boolean> {
    // Local-only accounts don't need server verification: they read and
    // write through the embedded local API, independent of remote connection
    // state, remote health checks, and remote retry backoff.
    if (this.isLocalOnlyAccount) {
      return true;
    }

    // A pending synchronization conflict blocks remote writes immediately,
    // even when a health check would succeed. Accepting the server copy (or
    // transitioning accounts) is the only way to resume synchronized writes.
    if (this.stores.services.hasPendingSyncConflict) {
      debug('Write blocked: a synchronization conflict is pending');
      return false;
    }

    // Remote account — perform live health check. Note: a successful health
    // check only proves the server is reachable, NOT that local and server
    // data agree; full synchronization remains responsible for that decision.
    try {
      debug('Verifying server writability with health check');
      await this.api.app.health();
      debug('Server health check passed — write allowed');
      return true;
    } catch (error) {
      debug('Server health check failed — write blocked', error);
      runInAction(() => {
        this.serverConnection = 'disconnected';
      });
      return false;
    }
  }

  /**
   * Flush pending offline writes, then re-check the connection. The ordering
   * matters: writes must land on the server before the sync runs.
   */
  async _flushPendingWritesThenSync(): Promise<void> {
    try {
      await this.stores.services._flushPendingWrites();
    } catch (error) {
      debug('Flush of pending writes failed, continuing with sync', error);
    }
    this._checkServerConnection();
  }

  @action setData(data: { port: number; token: string | undefined }): void {
    if (data.port) {
      this.localServerPort = data.port;
    }
    if (data.token) {
      this.localServerToken = data.token;
    }
  }

  // Reactions
  _clearScheduledRetry(): void {
    if (this._backoffTimer) {
      clearTimeout(this._backoffTimer);
      this._backoffTimer = null;
    }
    this._isBackoffScheduled = false;
  }

  /**
   * Watches `serverConnection`. When disconnected, schedules the next backoff
   * attempt. When connected, resets the backoff index. When connecting, does
   * nothing (waits for the in-progress check to resolve). This reaction ONLY
   * acts when disconnected — there is no background polling while connected.
   */
  _autoRetry(): void {
    if (this.serverConnection === 'connected') {
      this._clearScheduledRetry();
      if (this._backoffIndex > 0) {
        runInAction(() => {
          this._backoffIndex = 0;
        });
      }
      return;
    }

    if (this.serverConnection === 'connecting') {
      return;
    }

    // disconnected — schedule next backoff attempt
    if (!this.stores.user.isLoggedIn) {
      this._clearScheduledRetry();
      return;
    }

    if (!this._isBackoffScheduled) {
      const delay =
        RETRY_INTERVALS_MS[
          Math.min(this._backoffIndex, RETRY_INTERVALS_MS.length - 1)
        ] ?? RETRY_INTERVAL_CAP_MS;

      this._isBackoffScheduled = true;
      debug(
        `Server disconnected — scheduling backoff attempt #${this._backoffIndex + 1} in ${delay / 1000}s`,
      );

      this._backoffTimer = setTimeout(
        action(() => {
          this._backoffTimer = null;
          this._isBackoffScheduled = false;
          this._backoffIndex += 1;
          this._checkServerConnection();
        }),
        delay,
      );
    }
  }
}
