import ServicesApi from '../../src/api/ServicesApi';
import { createServerService } from './__fixtures__/server-services';

const createApi = () => {
  const server = {
    getCachedServices: jest.fn(),
    getServices: jest.fn(),
    cacheServicesFromModels: jest.fn(),
    createService: jest.fn(),
    deleteService: jest.fn(),
    updateService: jest.fn(),
    reorderService: jest.fn(),
  };
  const local = {
    clearCache: jest.fn(),
  };

  return {
    api: new ServicesApi(server, local),
    server,
    local,
  };
};

describe('ServicesApi', () => {
  it('loads services from cache by default', async () => {
    const { api, server } = createApi();
    const cachedServices = [createServerService({ id: 'cache-1' })];
    server.getCachedServices.mockResolvedValue(cachedServices);

    const result = await api.all();

    expect(server.getCachedServices).toHaveBeenCalledTimes(1);
    expect(server.getServices).not.toHaveBeenCalled();
    expect(result).toEqual(cachedServices);
  });

  it('syncs services from server when requested', async () => {
    const { api, server } = createApi();
    const serverServices = [createServerService({ id: 'server-1' })];
    server.getServices.mockResolvedValue(serverServices);

    const result = await api.sync();

    expect(server.getServices).toHaveBeenCalledTimes(1);
    expect(result).toEqual(serverServices);
  });

  it('forwards sync failures from server', async () => {
    const { api, server } = createApi();
    server.getServices.mockRejectedValue(new Error('Network error'));

    await expect(api.sync()).rejects.toThrow('Network error');
    expect(server.getServices).toHaveBeenCalledTimes(1);
  });

  it('persists service models to cache', () => {
    const { api, server } = createApi();
    const services = [createServerService({ id: 'service-1' })];

    api.cacheFromModels(services);

    expect(server.cacheServicesFromModels).toHaveBeenCalledWith(services);
  });

  it('forwards cache read failures', async () => {
    const { api, server } = createApi();
    server.getCachedServices.mockRejectedValue(new Error('cache read failed'));

    await expect(api.all()).rejects.toThrow('cache read failed');
    expect(server.getCachedServices).toHaveBeenCalledTimes(1);
  });
});
