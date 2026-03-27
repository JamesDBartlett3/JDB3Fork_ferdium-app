import { createHash } from 'node:crypto';
import mobxLocalStorage from 'mobx-localstorage';

jest.mock('mobx-localstorage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
  },
}));

jest.mock('../../src/helpers/recipe-helpers', () => ({
  getDevRecipeDirectory: jest.fn(() => '/tmp/recipes/dev'),
  getRecipeDirectory: jest.fn(() => '/tmp/recipes'),
  loadRecipeConfig: jest.fn(),
}));

jest.mock('../../src/environment-remote', () => ({
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
    (mobxLocalStorage.getItem as jest.Mock).mockReturnValue(null);
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: createLocalStorage() },
      writable: true,
      configurable: true,
    });
  });

  it('migrates legacy token key to hashed key when reading cached services', () => {
    const { default: ServerApi } = require('../../src/api/server/ServerApi');
    const api = new ServerApi();
    const legacyServices = [{ id: 'legacy-service-1' }];

    window.localStorage.setItem('authToken', authToken);
    window.localStorage.setItem(legacyCacheKey, JSON.stringify(legacyServices));

    const result = api.getCachedServicesRaw();

    expect(result).toEqual(legacyServices);
    expect(window.localStorage.getItem(legacyCacheKey)).toBeNull();
    expect(window.localStorage.getItem(hashedCacheKey)).toEqual(
      JSON.stringify(legacyServices),
    );
  });
});
