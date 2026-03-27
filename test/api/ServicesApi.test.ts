import ServicesApi from '../../src/api/ServicesApi';

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
  it('loads services from cache by default', () => {
    const { api, server } = createApi();

    api.all();

    expect(server.getCachedServices).toHaveBeenCalledTimes(1);
    expect(server.getServices).not.toHaveBeenCalled();
  });

  it('syncs services from server when requested', () => {
    const { api, server } = createApi();

    api.sync();

    expect(server.getServices).toHaveBeenCalledTimes(1);
  });

  it('persists service models to cache', () => {
    const { api, server } = createApi();
    const services = [{ id: 'service-1' }];

    api.cacheFromModels(services);

    expect(server.cacheServicesFromModels).toHaveBeenCalledWith(services);
  });
});
