import type RequestStoreClass from '../../src/stores/RequestStore';

function mockCreateDebugLogger() {
  return jest.fn();
}

jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
  },
}));

jest.mock('../../src/preload-safe-debug', () => mockCreateDebugLogger);

const RequestStore = jest.requireActual<
  typeof import('../../src/stores/RequestStore')
>('../../src/stores/RequestStore').default;

const REMOTE_SERVER = 'https://api.ferdium.org';
const LOCAL_SERVER = 'You are using Ferdium without a server';

// Build a minimal RequestStore-like object wired for the write-lock computed
// and _verifyServerWritable. We avoid the full constructor (which registers
// reactions and IPC listeners) and only stub what those code paths touch.
const createStore = ({
  server = REMOTE_SERVER,
  serverConnection = 'connected' as 'connected' | 'connecting' | 'disconnected',
  hasPendingSyncConflict = false,
  health = jest.fn().mockImplementation(() => Promise.resolve()),
} = {}) => {
  const store = Object.create(RequestStore.prototype) as RequestStoreClass & {
    serverConnection: 'connected' | 'connecting' | 'disconnected';
  };

  store.serverConnection = serverConnection;
  (store as any).stores = {
    settings: { all: { app: { server } } },
    services: { hasPendingSyncConflict },
  };
  (store as any).api = { app: { health } };

  return { store, health };
};

describe('RequestStore write lock', () => {
  describe('isWriteLocked', () => {
    it('permits writes for a remote account that is connected with no conflict', () => {
      const { store } = createStore();
      expect(store.isWriteLocked).toBe(false);
    });

    it('locks writes for a remote account while connecting', () => {
      const { store } = createStore({ serverConnection: 'connecting' });
      expect(store.isWriteLocked).toBe(true);
    });

    it('locks writes for a remote account while disconnected', () => {
      const { store } = createStore({ serverConnection: 'disconnected' });
      expect(store.isWriteLocked).toBe(true);
    });

    it('locks writes for a remote account with a pending conflict even when connected', () => {
      const { store } = createStore({
        serverConnection: 'connected',
        hasPendingSyncConflict: true,
      });
      expect(store.isWriteLocked).toBe(true);
    });

    it('never locks a local-only account based on remote connection state', () => {
      for (const serverConnection of [
        'connected',
        'connecting',
        'disconnected',
      ] as const) {
        const { store } = createStore({
          server: LOCAL_SERVER,
          serverConnection,
        });
        expect(store.isWriteLocked).toBe(false);
      }
    });

    it('is account-aware: local-only accounts ignore pending remote conflict state', () => {
      // hasPendingSyncConflict is a remote-account concept; a local-only
      // account must not be blocked by it.
      const { store } = createStore({
        server: LOCAL_SERVER,
        serverConnection: 'disconnected',
        hasPendingSyncConflict: true,
      });
      expect(store.isWriteLocked).toBe(false);
    });
  });

  describe('_verifyServerWritable', () => {
    it('returns true immediately for a local-only account without a remote health check', async () => {
      const { store, health } = createStore({ server: LOCAL_SERVER });
      const result = await store._verifyServerWritable();
      expect(result).toBe(true);
      expect(health).not.toHaveBeenCalled();
    });

    it('rejects a remote write immediately when a conflict is pending, without a health check', async () => {
      const { store, health } = createStore({
        serverConnection: 'connected',
        hasPendingSyncConflict: true,
      });
      const result = await store._verifyServerWritable();
      expect(result).toBe(false);
      expect(health).not.toHaveBeenCalled();
    });

    it('permits a remote write when the health check succeeds and no conflict is pending', async () => {
      const { store, health } = createStore({ serverConnection: 'connected' });
      const result = await store._verifyServerWritable();
      expect(result).toBe(true);
      expect(health).toHaveBeenCalledTimes(1);
    });

    it('blocks a remote write and marks the connection disconnected when the health check fails', async () => {
      const health = jest.fn().mockRejectedValue(new Error('down'));
      const { store } = createStore({
        serverConnection: 'connected',
        health,
      });
      const result = await store._verifyServerWritable();
      expect(result).toBe(false);
      expect(health).toHaveBeenCalledTimes(1);
      expect(store.serverConnection).toBe('disconnected');
    });
  });

  describe('embedded local server errors', () => {
    it('reports a local server failure only for local-only accounts', () => {
      const { store } = createStore({ server: LOCAL_SERVER });
      (store as any).localServerError = 'listen EADDRINUSE';
      expect(store.hasLocalServerError).toBe(true);

      const remote = createStore();
      (remote.store as any).localServerError = 'listen EADDRINUSE';
      // A stray local-server error must never surface for remote accounts.
      expect(remote.store.hasLocalServerError).toBe(false);
    });

    it('keeps a local server failure out of the write lock and connection state', () => {
      const { store } = createStore({ server: LOCAL_SERVER });
      (store as any).localServerError = 'listen EADDRINUSE';

      // Local failures are local operational errors: they do not flip the
      // remote connection state and do not engage the remote write-lock.
      expect(store.isWriteLocked).toBe(false);
      expect(store.serverConnection).toBe('connected');
    });

    it('retries the embedded server without entering the remote retry workflow', () => {
      const { ipcRenderer } = jest.requireMock('electron');
      const { store } = createStore({ server: LOCAL_SERVER });
      (store as any).localServerError = 'boom';

      store._retryLocalServer();

      expect((store as any).localServerError).toBeNull();
      expect(ipcRenderer.send).toHaveBeenCalledWith('startLocalServer');
    });
  });
});
