import type ServicesStoreClass from '../../src/stores/ServicesStore';

function mockCreateDebugLogger() {
  return jest.fn();
}

function mockFilterServicesByActiveWorkspace<T>(services: T): T {
  return services;
}

jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
  },
}));

jest.mock('../../src/environment-remote', () => ({
  ferdiumVersion: 'test-version',
  userDataRecipesPath: (...segments: string[]) => segments.join('/'),
}));

jest.mock('../../src/features/workspaces', () => ({
  workspaceStore: {
    filterServicesByActiveWorkspace: mockFilterServicesByActiveWorkspace,
  },
}));
jest.mock('../../src/preload-safe-debug', () => mockCreateDebugLogger);

const ServicesStore = jest.requireActual<
  typeof import('../../src/stores/ServicesStore')
>('../../src/stores/ServicesStore').default;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type StubService = Record<string, any>;

// Stubs are class instances (like production Service models) so MobX's deep
// observable() conversion leaves them untouched instead of wrapping them in
// proxies — preserving object identity through the `all` computed.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class StubServiceInstance {}

const createService = (overrides: StubService = {}): StubService =>
  Object.assign(new StubServiceInstance(), {
    id: 'service-1',
    recipe: { id: 'slack' },
    name: 'Slack',
    order: 0,
    team: '',
    customUrl: '',
    iconUrl: '',
    useFavicon: false,
    isEnabled: true,
    isNotificationEnabled: true,
    isBadgeEnabled: true,
    isMediaBadgeEnabled: true,
    trapLinkClicks: true,
    isIndirectMessageBadgeEnabled: true,
    isMuted: false,
    isDarkModeEnabled: false,
    darkReaderSettings: { brightness: 100, contrast: 90, sepia: 10 },
    isProgressbarEnabled: true,
    spellcheckerLanguage: null,
    userAgentPref: '',
    isHibernationEnabled: false,
    isWakeUpEnabled: true,
    onlyShowFavoritesInUnreadCount: false,
    proxy: null,
    customIconUrl: '',
    hasCustomUploadedIcon: false,
    // client-only runtime state
    isAttached: false,
    isFirstLoad: false,
    isLoading: false,
    unreadDirectMessageCount: 0,
    unreadIndirectMessageCount: 0,
    webview: null,
    ...overrides,
  });

// Build a minimal ServicesStore-like object wired for the sync methods. We
// avoid the full constructor (heavy action/reaction wiring) and only stub
// what `_syncFromServer`, `_applyServerServices`, and `applyPendingServerSync`
// touch.
const createSyncStore = ({
  localServices = [] as StubService[],
  token = 'token-a',
  server = 'https://api.ferdium.org',
  isLocalOnlyAccount = false,
} = {}) => {
  const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;

  const cacheFromModels = jest.fn().mockReturnValue(true);

  const allServicesRequest: any = {
    result: localServices,
    patch: jest.fn((modify: (result: any) => any) =>
      Promise.resolve().then(() => {
        const override = modify(allServicesRequest.result);
        if (override !== undefined) allServicesRequest.result = override;
      }),
    ),
  };
  // The `all` computed calls `.execute().result`; mirror CachedRequest, whose
  // execute() returns the request itself.
  allServicesRequest.execute = jest.fn(() => allServicesRequest);

  const syncServicesRequest = {
    execute: jest.fn(),
  };

  (store as any).allServicesRequest = allServicesRequest;
  (store as any).syncServicesRequest = syncServicesRequest;
  (store as any).pendingServerSyncServices = null;
  (store as any).isApplyingPendingSync = false;
  (store as any)._syncContext = null;
  (store as any).stores = {
    user: { authToken: token, isLoggedIn: true },
    settings: { all: { app: { server } } },
    requests: { _checkServerConnection: jest.fn(), isLocalOnlyAccount },
  };
  (store as any).api = {
    services: { cacheFromModels },
  };

  return { store, allServicesRequest, syncServicesRequest, cacheFromModels };
};

const makeSyncResult = (entries: { raw: any; model: StubService }[]) =>
  ({
    entries,
  }) as unknown as import('../../src/api/server/service-sync').ServiceSyncResult;

describe('ServicesStore', () => {
  it('clears UserAgent webview reference when detaching a service', () => {
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    const userAgentModel = {
      setWebviewReference: jest.fn(),
    };
    const service = {
      isAttached: true,
      userAgentModel,
      webview: { id: 'webview' },
    };

    store._detachService({ service });

    expect(userAgentModel.setWebviewReference).toHaveBeenCalledWith(null);
    expect(service.webview).toBeNull();
    expect(service.isAttached).toBe(false);
  });

  describe('_applyServerServices (in-place sync)', () => {
    it('keeps the exact same object for a matching service and updates server-owned settings', async () => {
      const local = createService({
        id: 'a',
        name: 'Old name',
        unreadDirectMessageCount: 7,
        unreadIndirectMessageCount: 3,
        isAttached: true,
        isLoading: false,
        hasCrashed: true,
        lastPoll: 111,
        lastPollAnswer: 222,
        webview: { id: 'wv-a' },
        updatedAt: 1234,
      });
      const { store, allServicesRequest, cacheFromModels } = createSyncStore({
        localServices: [local],
      });

      const serverModel = createService({ id: 'a', name: 'New name' });
      const raw = { id: 'a', recipeId: 'slack', name: 'New name' };

      await store._applyServerServices(
        makeSyncResult([{ raw, model: serverModel }]),
      );

      const { result } = allServicesRequest;
      expect(result).toHaveLength(1);
      // Same object reference retained
      expect(result[0]).toBe(local);
      // Server-owned setting applied
      expect(result[0].name).toBe('New name');
      // Client-only runtime state intact: webpage reference, attachment,
      // loading state, unread counts, crash state, and polling values.
      expect(result[0].unreadDirectMessageCount).toBe(7);
      expect(result[0].unreadIndirectMessageCount).toBe(3);
      expect(result[0].isAttached).toBe(true);
      expect(result[0].isLoading).toBe(false);
      expect(result[0].hasCrashed).toBe(true);
      expect(result[0].lastPoll).toBe(111);
      expect(result[0].lastPollAnswer).toBe(222);
      expect(result[0].webview).toEqual({ id: 'wv-a' });
      // Local metadata preserved (server omits updatedAt)
      expect(result[0].updatedAt).toBe(1234);
      // Final accepted array persisted
      expect(cacheFromModels).toHaveBeenCalledWith(result);
    });

    it('keeps event handlers updating the object returned by store.one(id) after sync', async () => {
      const local = createService({ id: 'a', unreadDirectMessageCount: 1 });
      const { store } = createSyncStore({ localServices: [local] });

      await store._applyServerServices(
        makeSyncResult([
          {
            raw: { id: 'a', recipeId: 'slack', name: 'Renamed' },
            model: createService({ id: 'a', name: 'Renamed' }),
          },
        ]),
      );

      // Simulate a webview event arriving after sync (the same path upstream's
      // webpage handlers use): it must land on the reused object.
      store._setUnreadMessageCount({
        serviceId: 'a',
        count: { direct: 42, indirect: 5 },
      });

      const fromLookup = store.one('a');
      // Class-instance stubs are not MobX-proxied (matching production
      // Service models), so the lookup returns the reused object itself.
      expect(fromLookup).toBe(local);
      expect(fromLookup.unreadDirectMessageCount).toBe(42);
      expect(fromLookup.unreadIndirectMessageCount).toBe(5);
      expect(local.unreadDirectMessageCount).toBe(42);
      expect(local.unreadIndirectMessageCount).toBe(5);
    });

    it('applies explicit empty values (null/false/0/"") from the raw response', async () => {
      const local = createService({
        id: 'a',
        name: 'X',
        team: 'team-1',
        isMuted: true,
      });
      const { store, allServicesRequest } = createSyncStore({
        localServices: [local],
      });

      const serverModel = createService({ id: 'a' });
      const raw = { id: 'a', recipeId: 'slack', team: '', isMuted: false };

      await store._applyServerServices(
        makeSyncResult([{ raw, model: serverModel }]),
      );

      expect(allServicesRequest.result[0].team).toBe('');
      expect(allServicesRequest.result[0].isMuted).toBe(false);
    });

    it('preserves the local value when a server-owned property is absent', async () => {
      const local = createService({ id: 'a', proxy: 'http://proxy:8080' });
      const { store, allServicesRequest } = createSyncStore({
        localServices: [local],
      });

      const serverModel = createService({ id: 'a' });
      // `proxy` absent from raw payload
      const raw = { id: 'a', recipeId: 'slack', name: 'a' };

      await store._applyServerServices(
        makeSyncResult([{ raw, model: serverModel }]),
      );

      expect(allServicesRequest.result[0].proxy).toBe('http://proxy:8080');
    });

    it('creates a new object for a genuinely new service and drops removed services', async () => {
      const kept = createService({ id: 'kept' });
      const removed = createService({ id: 'removed' });
      const { store, allServicesRequest } = createSyncStore({
        localServices: [kept, removed],
      });

      const keptModel = createService({ id: 'kept' });
      const newModel = createService({ id: 'brand-new' });
      const result2 = makeSyncResult([
        { raw: { id: 'kept', recipeId: 'slack' }, model: keptModel },
        { raw: { id: 'brand-new', recipeId: 'slack' }, model: newModel },
      ]);

      await store._applyServerServices(result2);

      const finalIds = allServicesRequest.result.map((s: any) => s.id);
      expect(finalIds).toEqual(['kept', 'brand-new']);
      // existing object reused
      expect(allServicesRequest.result[0]).toBe(kept);
      // new service uses the prepared model
      expect(allServicesRequest.result[1]).toBe(newModel);
      // removed service gone
      expect(finalIds).not.toContain('removed');
    });

    it('forces a fresh model when the recipe changes beneath a matching id', async () => {
      const local = createService({ id: 'a', recipe: { id: 'slack' } });
      const { store, allServicesRequest } = createSyncStore({
        localServices: [local],
      });

      const replacement = createService({ id: 'a', recipe: { id: 'discord' } });
      await store._applyServerServices(
        makeSyncResult([
          { raw: { id: 'a', recipeId: 'discord' }, model: replacement },
        ]),
      );

      // Exceptional identity change: do NOT reuse the old object.
      expect(allServicesRequest.result[0]).toBe(replacement);
      expect(allServicesRequest.result[0]).not.toBe(local);
    });
  });

  describe('_syncFromServer (conflict + staleness)', () => {
    it('stores the pending sync result and leaves displayed services unchanged on conflict', async () => {
      const local = createService({ id: 'a', isMuted: false });
      const {
        store,
        allServicesRequest,
        syncServicesRequest,
        cacheFromModels,
      } = createSyncStore({
        localServices: [local],
      });

      const conflictModel = createService({ id: 'a', isMuted: true });
      const syncResult = makeSyncResult([
        {
          raw: { id: 'a', recipeId: 'slack', isMuted: true },
          model: conflictModel,
        },
      ]);
      syncServicesRequest.execute.mockReturnValue({
        promise: Promise.resolve(syncResult),
      });

      await store._syncFromServer();

      expect((store as any).pendingServerSyncServices).toBe(syncResult);
      // Displayed (cached) services unchanged
      expect(allServicesRequest.result[0]).toBe(local);
      expect(allServicesRequest.result[0].isMuted).toBe(false);
      // The token-scoped cache is NOT touched while the conflict is pending,
      // so a restart still loads the previously accepted local copy.
      expect(cacheFromModels).not.toHaveBeenCalled();
    });

    it('applies silently when there is no conflict', async () => {
      const local = createService({ id: 'a' });
      const { store, allServicesRequest, syncServicesRequest } =
        createSyncStore({
          localServices: [local],
        });

      const matchModel = createService({ id: 'a' });
      const syncResult = makeSyncResult([
        { raw: { id: 'a', recipeId: 'slack' }, model: matchModel },
      ]);
      syncServicesRequest.execute.mockReturnValue({
        promise: Promise.resolve(syncResult),
      });

      await store._syncFromServer();

      expect((store as any).pendingServerSyncServices).toBeNull();
      expect(allServicesRequest.result[0]).toBe(local);
    });

    it('applies the embedded database copy directly for local-only accounts, without a conflict', async () => {
      // Local-only account: the embedded local API/SQLite database is the
      // accepted source of truth, so a cache/DB difference is not a conflict.
      const local = createService({ id: 'a', isMuted: false });
      const { store, allServicesRequest, syncServicesRequest } =
        createSyncStore({
          localServices: [local],
          server: 'You are using Ferdium without a server',
          isLocalOnlyAccount: true,
        });

      const dbModel = createService({ id: 'a', isMuted: true });
      syncServicesRequest.execute.mockReturnValue({
        promise: Promise.resolve(
          makeSyncResult([
            {
              raw: { id: 'a', recipeId: 'slack', isMuted: true },
              model: dbModel,
            },
          ]),
        ),
      });

      await store._syncFromServer();

      // No pending conflict; the database copy was applied in place.
      expect((store as any).pendingServerSyncServices).toBeNull();
      expect(allServicesRequest.result[0]).toBe(local);
      expect(allServicesRequest.result[0].isMuted).toBe(true);
    });

    it('discards a response when the account context changed mid-sync', async () => {
      const local = createService({ id: 'a', isMuted: false });
      const { store, allServicesRequest, syncServicesRequest } =
        createSyncStore({
          localServices: [local],
          token: 'token-a',
        });

      const conflictModel = createService({ id: 'a', isMuted: true });
      const syncResult = makeSyncResult([
        {
          raw: { id: 'a', recipeId: 'slack', isMuted: true },
          model: conflictModel,
        },
      ]);

      let resolvePromise: (v: any) => void;
      const promise = new Promise(res => {
        resolvePromise = res;
      });
      syncServicesRequest.execute.mockReturnValue({ promise });

      const syncRun = store._syncFromServer();
      // Account changes while the request is in flight
      (store as any).stores.user.authToken = 'token-b';
      resolvePromise!(syncResult);
      await syncRun;

      // Stale response discarded: no conflict created, nothing applied.
      expect((store as any).pendingServerSyncServices).toBeNull();
      expect(allServicesRequest.result[0].isMuted).toBe(false);
    });
  });

  describe('applyPendingServerSync', () => {
    it('reuses current objects and clears the conflict after success', async () => {
      const local = createService({ id: 'a', isMuted: false });
      const { store, allServicesRequest } = createSyncStore({
        localServices: [local],
      });

      const serverModel = createService({ id: 'a', isMuted: true });
      (store as any).pendingServerSyncServices = makeSyncResult([
        {
          raw: { id: 'a', recipeId: 'slack', isMuted: true },
          model: serverModel,
        },
      ]);

      await store.applyPendingServerSync();

      expect(allServicesRequest.result[0]).toBe(local);
      expect(allServicesRequest.result[0].isMuted).toBe(true);
      expect((store as any).pendingServerSyncServices).toBeNull();
    });

    it('does not apply twice while a previous application is still running', async () => {
      const local = createService({ id: 'a' });
      const { store, allServicesRequest } = createSyncStore({
        localServices: [local],
      });

      let resolvePatch: () => void;
      const patchGate = new Promise<void>(res => {
        resolvePatch = res;
      });
      // Make patch wait on our gate so we can click twice.
      allServicesRequest.patch.mockImplementationOnce(
        (modify: (result: any) => any) =>
          patchGate.then(() => {
            const override = modify(allServicesRequest.result);
            if (override !== undefined) allServicesRequest.result = override;
          }),
      );

      (store as any).pendingServerSyncServices = makeSyncResult([
        {
          raw: { id: 'a', recipeId: 'slack' },
          model: createService({ id: 'a' }),
        },
      ]);

      const first = store.applyPendingServerSync();
      const second = store.applyPendingServerSync(); // should no-op
      resolvePatch!();
      await Promise.all([first, second]);

      // patch called exactly once — the second click was a no-op.
      expect(allServicesRequest.patch).toHaveBeenCalledTimes(1);
    });

    it('keeps the conflict pending when application fails', async () => {
      const local = createService({ id: 'a' });
      const { store, allServicesRequest } = createSyncStore({
        localServices: [local],
      });
      allServicesRequest.patch.mockImplementationOnce(() =>
        Promise.reject(new Error('patch failed')),
      );

      const pending = makeSyncResult([
        {
          raw: { id: 'a', recipeId: 'slack' },
          model: createService({ id: 'a' }),
        },
      ]);
      (store as any).pendingServerSyncServices = pending;

      await store.applyPendingServerSync();

      // Conflict still pending — the user can retry.
      expect((store as any).pendingServerSyncServices).toBe(pending);
      expect((store as any).isApplyingPendingSync).toBe(false);
    });

    it('remains available while normal writes are locked', async () => {
      const local = createService({ id: 'a', isMuted: false });
      const { store, allServicesRequest } = createSyncStore({
        localServices: [local],
      });
      // Simulate the shared write-lock being active (conflict pending).
      (store as any).stores.requests.isWriteLocked = true;

      (store as any).pendingServerSyncServices = makeSyncResult([
        {
          raw: { id: 'a', recipeId: 'slack', isMuted: true },
          model: createService({ id: 'a', isMuted: true }),
        },
      ]);

      await store.applyPendingServerSync();

      // Conflict resolution itself is NOT blocked by the write-lock.
      expect(allServicesRequest.result[0].isMuted).toBe(true);
      expect((store as any).pendingServerSyncServices).toBeNull();
    });
  });

  describe('account and server transitions', () => {
    it('discards a response when the user logged out mid-sync', async () => {
      const local = createService({ id: 'a', isMuted: false });
      const { store, allServicesRequest, syncServicesRequest } =
        createSyncStore({ localServices: [local] });

      const syncResult = makeSyncResult([
        {
          raw: { id: 'a', recipeId: 'slack', isMuted: true },
          model: createService({ id: 'a', isMuted: true }),
        },
      ]);

      let resolvePromise: (v: any) => void;
      const promise = new Promise(res => {
        resolvePromise = res;
      });
      syncServicesRequest.execute.mockReturnValue({ promise });

      const syncRun = store._syncFromServer();
      // Logout while the request is in flight.
      (store as any).stores.user.authToken = null;
      resolvePromise!(syncResult);
      await syncRun;

      // The old account's response is neither applied nor displayed.
      expect((store as any).pendingServerSyncServices).toBeNull();
      expect(allServicesRequest.result[0].isMuted).toBe(false);
    });

    it('discards a response when the configured server changed mid-sync', async () => {
      const local = createService({ id: 'a', isMuted: false });
      const { store, allServicesRequest, syncServicesRequest } =
        createSyncStore({ localServices: [local] });

      const syncResult = makeSyncResult([
        {
          raw: { id: 'a', recipeId: 'slack', isMuted: true },
          model: createService({ id: 'a', isMuted: true }),
        },
      ]);

      let resolvePromise: (v: any) => void;
      const promise = new Promise(res => {
        resolvePromise = res;
      });
      syncServicesRequest.execute.mockReturnValue({ promise });

      const syncRun = store._syncFromServer();
      // User switches between a remote server and LOCAL_SERVER mid-flight.
      (store as any).stores.settings.all.app.server =
        'You are using Ferdium without a server';
      resolvePromise!(syncResult);
      await syncRun;

      expect((store as any).pendingServerSyncServices).toBeNull();
      expect(allServicesRequest.result[0].isMuted).toBe(false);
    });

    it('clears pending conflict data immediately on logout', () => {
      const { store, allServicesRequest } = createSyncStore();
      const reset = jest.fn();
      (allServicesRequest as any).invalidate = jest.fn(() => ({ reset }));
      (store as any).actions = { settings: { remove: jest.fn() } };
      (store as any).stores.user.isLoggedIn = false;
      (store as any).pendingServerSyncServices = makeSyncResult([
        {
          raw: { id: 'a', recipeId: 'slack' },
          model: createService({ id: 'a' }),
        },
      ]);

      store._logoutReaction();

      expect((store as any).pendingServerSyncServices).toBeNull();
      expect((store as any).isApplyingPendingSync).toBe(false);
    });
  });

  describe('cache persistence failures', () => {
    it('keeps accepted in-memory services usable when the cache write fails', async () => {
      const local = createService({ id: 'a', name: 'Old' });
      const { store, allServicesRequest, cacheFromModels } = createSyncStore({
        localServices: [local],
      });
      // ServerApi.cacheServicesFromModels catches quota/storage errors and
      // returns false instead of throwing.
      cacheFromModels.mockReturnValue(false);

      await store._applyServerServices(
        makeSyncResult([
          {
            raw: { id: 'a', recipeId: 'slack', name: 'New' },
            model: createService({ id: 'a', name: 'New' }),
          },
        ]),
      );

      // In-memory state applied and usable; the failure only affects offline
      // persistence, which ServerApi surfaces as a warning.
      expect(allServicesRequest.result[0]).toBe(local);
      expect(allServicesRequest.result[0].name).toBe('New');
      expect(cacheFromModels).toHaveBeenCalledTimes(1);
    });
  });

  describe('write-lock guards on mutating actions', () => {
    it('does not toggle a service while write-locked', () => {
      const service = createService({ id: 'a', isEnabled: true });
      const { store } = createSyncStore({ localServices: [service] });
      (store as any).stores.requests.isWriteLocked = true;

      store._toggleService({ serviceId: 'a' });

      expect(service.isEnabled).toBe(true);
    });

    it('does not reorder services while the server write is not verified', async () => {
      const a = createService({ id: 'a', order: 0 });
      const b = createService({ id: 'b', order: 1 });
      const { store } = createSyncStore({ localServices: [a, b] });
      const execute = jest.fn();
      (store as any).reorderServicesRequest = { execute };
      (store as any).stores.requests._verifyServerWritable = jest
        .fn()
        .mockResolvedValue(false);

      await store._reorderService({ oldIndex: 0, newIndex: 1 });

      // Blocked before touching the server or local order.
      expect(execute).not.toHaveBeenCalled();
      expect(a.order).toBe(0);
      expect(b.order).toBe(1);
    });
  });
});
