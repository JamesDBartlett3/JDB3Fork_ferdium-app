/* eslint-disable global-require */
import { createHash } from 'node:crypto';
import { createServerService } from './__fixtures__/server-services';

jest.mock('mobx-localstorage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => null),
  },
}));

jest.mock('@electron/remote', () => ({
  __esModule: true,
  webContents: { fromId: jest.fn() },
}));

// The Service model is mocked with a data-carrying stub so tests can verify
// raw/model pairing without loading its heavy electron/DOM dependency tree.
jest.mock('../../src/models/Service', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  default: class ServiceModelMock {
    constructor(data: any) {
      Object.assign(this, data);
    }
  },
}));

jest.mock('../../src/api/utils/auth', () => ({
  prepareAuthRequest: jest.fn((options: any) => options),
  prepareLocalToken: jest.fn(),
  sendAuthRequest: jest.fn(),
}));

jest.mock('../../src/helpers/recipe-helpers', () => ({
  getDevRecipeDirectory: jest.fn(() => '/tmp/recipes/dev'),
  getRecipeDirectory: jest.fn(() => '/tmp/recipes'),
  loadRecipeConfig: jest.fn(),
}));

jest.mock('../../src/environment-remote', () => ({
  userDataPath: jest.fn((...segments: string[]) =>
    ['/tmp/user-data', ...segments].join('/'),
  ),
  userDataRecipesPath: jest.fn(() => '/tmp/recipes'),
}));

const createLocalStorage = () => {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };
};

describe('ServerApi cache key migration', () => {
  const cachePrefix = 'ferdium-services-cache-v1';
  const authToken = 'test-auth-token';
  const legacyCacheKey = `${cachePrefix}:${authToken}`;
  const hashedCacheKey = `${cachePrefix}:${createHash('sha256')
    .update(`${cachePrefix}:${authToken}`)
    .digest('hex')}`;

  beforeEach(() => {
    jest.resetModules();
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: createLocalStorage() },
      writable: true,
      configurable: true,
    });
  });

  it('migrates legacy token key to hashed key when reading cached services', () => {
    const { default: ServerApi } = require('../../src/api/server/ServerApi');
    const api = new ServerApi();
    // The raw services cache stores the server's `GET /me/services` payload
    // verbatim, so use a fixture that mirrors the real server response.
    const legacyServices = [createServerService({ id: 'legacy-service-1' })];

    window.localStorage.setItem('authToken', authToken);
    window.localStorage.setItem(legacyCacheKey, JSON.stringify(legacyServices));

    const result = api.getCachedServicesRaw();

    expect(result).toEqual(legacyServices);
    expect(window.localStorage.getItem(legacyCacheKey)).toBeNull();
    expect(window.localStorage.getItem(hashedCacheKey)).toEqual(
      JSON.stringify(legacyServices),
    );
  });

  it('preserves a locally-set updatedAt when extracting service config', () => {
    const { default: ServerApi } = require('../../src/api/server/ServerApi');
    const api = new ServerApi();
    const now = Date.now();
    const result = api._extractServiceConfig({
      id: 'service-1',
      recipeId: 'slack',
      name: 'Slack',
      order: 1,
      updatedAt: now,
    });

    expect(result.updatedAt).toBe(now);
  });

  it('defaults updatedAt to null for real server services (server omits it)', () => {
    const { default: ServerApi } = require('../../src/api/server/ServerApi');
    const api = new ServerApi();
    // The Ferdium server never sends `updatedAt`, so extracting config from a
    // real server service must yield `updatedAt: null`.
    const serverService = createServerService();
    expect('updatedAt' in serverService).toBe(false);

    const result = api._extractServiceConfig(serverService);

    expect(result.updatedAt).toBeNull();
    expect(result.recipeId).toBe('slack');
  });

  it('memoizes auth token hash for cache key computation', () => {
    const { default: ServerApi } = require('../../src/api/server/ServerApi');
    const api = new ServerApi();
    const token = 'memoized-token';

    const firstKey = api._getServicesCacheKey(token);
    const secondKey = api._getServicesCacheKey(token);

    expect(firstKey).toBe(secondKey);
    expect(api.tokenHashCache.get(token)).toBe(firstKey.split(':')[1]);
  });

  it('isolates cached services between different auth tokens', () => {
    const { default: ServerApi } = require('../../src/api/server/ServerApi');
    const api = new ServerApi();

    window.localStorage.setItem('authToken', 'user-1-token');
    api.setCachedServicesRaw([createServerService({ id: 'user-1-service' })]);

    window.localStorage.setItem('authToken', 'user-2-token');

    expect(api.getCachedServicesRaw()).toEqual([]);
  });
});

// Pre-load recipes so _bulkRecipeCheck never attempts a download.
const createApiWithRecipes = () => {
  const { default: ServerApi } = require('../../src/api/server/ServerApi');
  const api = new ServerApi();
  api.recipes = [{ id: 'slack' }, { id: 'discord' }];
  return api;
};

// Captured lazily: jest.resetModules() in beforeEach replaces the mocked
// module instance, so a describe-level reference would go stale.
const getSendAuthRequestMock = () =>
  jest.requireMock('../../src/api/utils/auth').sendAuthRequest;

const mockServerResponse = (services: any[]) => {
  getSendAuthRequestMock().mockResolvedValue({
    ok: true,
    json: async () => services,
  });
};

describe('ServerApi service synchronization', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: createLocalStorage(),
        ferdium: {
          stores: {
            settings: { all: { app: { server: 'https://api.ferdium.org' } } },
            requests: { localServerPort: 46_569 },
          },
        },
      },
      writable: true,
      configurable: true,
    });
    // Silence expected warnings from the failing-preparation paths.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns raw responses paired with their prepared models by service id', async () => {
    const api = createApiWithRecipes();
    const rawSlack = createServerService({
      id: 'svc-slack',
      recipeId: 'slack',
    });
    const rawDiscord = createServerService({
      id: 'svc-discord',
      recipeId: 'discord',
      name: 'Discord',
    });
    mockServerResponse([rawSlack, rawDiscord]);

    const result = await api.getServices();

    expect(result.entries).toHaveLength(2);
    // Raw payload preserved verbatim, paired with the matching model.
    expect(result.entries[0].raw).toBe(rawSlack);
    expect(result.entries[0].model.id).toBe('svc-slack');
    expect(result.entries[1].raw).toBe(rawDiscord);
    expect(result.entries[1].model.id).toBe('svc-discord');
  });

  it('preserves explicit null, false, 0 and empty-string values in prepared models', async () => {
    const api = createApiWithRecipes();
    const raw = createServerService({
      id: 'svc-1',
      recipeId: 'slack',
      iconUrl: null,
      isMuted: false,
      order: 0,
      team: '',
    });
    mockServerResponse([raw]);

    const result = await api.getServices();
    const { model } = result.entries[0];

    expect(model.iconUrl).toBeNull();
    expect(model.isMuted).toBe(false);
    expect(model.order).toBe(0);
    expect(model.team).toBe('');
  });

  it('does not write the incoming response to the cache before acceptance', async () => {
    const api = createApiWithRecipes();
    mockServerResponse([createServerService({ id: 'svc-1' })]);

    await api.getServices();

    // No token-scoped cache key may be written by getServices itself.
    expect(api.getCachedServicesRaw()).toEqual([]);
  });

  it('rejects the whole result when any raw service cannot be prepared', async () => {
    const api = createApiWithRecipes();
    const good = createServerService({ id: 'svc-good', recipeId: 'slack' });
    // Recipe not installed and not downloadable in the test environment.
    const bad = createServerService({
      id: 'svc-bad',
      recipeId: 'nonexistent-recipe',
    });
    mockServerResponse([good, bad]);

    await expect(api.getServices()).rejects.toThrow(
      /Unable to prepare service 'svc-bad'/,
    );
  });

  it('distinguishes a genuinely empty server list from an all-failed response', async () => {
    const api = createApiWithRecipes();

    // Empty list: valid result with no entries — NOT an error.
    await expect(api.prepareServiceSyncResult([])).resolves.toEqual({
      entries: [],
    });

    // Non-empty list where every service fails preparation: must reject so the
    // caller does not interpret it as a server-side deletion of everything.
    await expect(
      api.prepareServiceSyncResult([
        createServerService({ id: 'svc-x', recipeId: 'nonexistent-recipe' }),
      ]),
    ).rejects.toThrow(/Unable to prepare service/);
  });
});
