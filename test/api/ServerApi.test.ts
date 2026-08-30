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

// The cache-key methods under test do not use the Service model at runtime.
// Mock it to avoid loading its heavy electron/DOM dependency tree under Jest.
jest.mock('../../src/models/Service', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  default: class ServiceModelMock {},
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
