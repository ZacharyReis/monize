import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the interceptor handlers registered when api.ts is imported. The
// axios mock makes `axios.create` return a callable stub (the client itself is
// invoked as a function during retries) whose `interceptors.*.use` records the
// success/error handlers so the tests can drive them directly.
//
// api.ts keeps module-level singletons (isLoggingOut, isRefreshingToken, the
// failed-request queue, refresh promises). To keep each test independent we
// reset the module registry and re-import api.ts in beforeEach, which also
// re-registers the interceptor handlers below.
const requestHandlers: {
  onFulfilled?: (config: unknown) => unknown;
  onRejected?: (error: unknown) => unknown;
} = {};
const responseHandlers: {
  onFulfilled?: (response: unknown) => unknown;
  onRejected?: (error: unknown) => unknown;
} = {};

// The callable client stub. `apiClient(config)` is used to replay retried
// requests, so it must be a function. We track its calls and resolve with a
// sentinel so the interceptor's retry branch returns something inspectable.
const clientCalls: unknown[] = [];
const clientStub = vi.fn((config: unknown) => {
  clientCalls.push(config);
  return Promise.resolve({ data: 'retried', config });
});

// Stable raw-axios mocks. They must survive vi.resetModules() so that the
// fresh api.ts import (which calls the bare axios.get/post for refresh/logout)
// shares the same spies the tests assert against. vi.hoisted keeps them alive
// across module-registry resets.
const rawAxios = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('axios', () => {
  const create = vi.fn(() => {
    const client = clientStub as unknown as {
      interceptors: {
        request: { use: (f: unknown, r: unknown) => void };
        response: { use: (f: unknown, r: unknown) => void };
      };
    };
    client.interceptors = {
      request: {
        use: (onFulfilled: unknown, onRejected: unknown) => {
          requestHandlers.onFulfilled = onFulfilled as never;
          requestHandlers.onRejected = onRejected as never;
        },
      },
      response: {
        use: (onFulfilled: unknown, onRejected: unknown) => {
          responseHandlers.onFulfilled = onFulfilled as never;
          responseHandlers.onRejected = onRejected as never;
        },
      },
    };
    return client;
  });

  return {
    default: {
      create,
      get: rawAxios.get,
      post: rawAxios.post,
    },
  };
});

const rawCookies = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('js-cookie', () => ({
  default: rawCookies,
}));

const logoutSpy = vi.fn();
vi.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ logout: logoutSpy }),
  },
}));

const setBackendDownSpy = vi.fn();
vi.mock('@/store/connectionStore', () => ({
  useConnectionStore: {
    getState: () => ({ setBackendDown: setBackendDownSpy }),
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockCookieGet = rawCookies.get;
const mockAxiosGet = rawAxios.get;
const mockAxiosPost = rawAxios.post;

async function loadApi() {
  vi.resetModules();
  await import('./api');
}

function makeError(overrides: Record<string, unknown>) {
  return {
    config: { url: '/some', headers: {} },
    response: undefined,
    code: undefined,
    ...overrides,
  } as never;
}

describe('apiClient interceptors', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    clientCalls.length = 0;
    clientStub.mockImplementation((config: unknown) => {
      clientCalls.push(config);
      return Promise.resolve({ data: 'retried', config });
    });
    Object.defineProperty(window, 'location', {
      value: { pathname: '/dashboard', replace: vi.fn() },
      writable: true,
      configurable: true,
    });
    await loadApi();
  });

  describe('request interceptor', () => {
    it('injects X-CSRF-Token header from cookie', () => {
      mockCookieGet.mockReturnValue('csrf-abc');
      const config = { headers: {}, method: 'get', url: '/x' };
      const result = requestHandlers.onFulfilled!(config) as {
        headers: Record<string, string>;
      };
      expect(result.headers['X-CSRF-Token']).toBe('csrf-abc');
      expect(result.headers['X-Client-Timezone']).toBeDefined();
    });

    it('does not overwrite an existing X-Client-Timezone header', () => {
      mockCookieGet.mockReturnValue(undefined);
      const config = {
        headers: { 'X-Client-Timezone': 'Europe/Paris' },
        method: 'post',
        url: '/y',
      };
      const result = requestHandlers.onFulfilled!(config) as {
        headers: Record<string, string>;
      };
      expect(result.headers['X-Client-Timezone']).toBe('Europe/Paris');
      expect(result.headers['X-CSRF-Token']).toBeUndefined();
    });

    it('rejects on request error', async () => {
      const err = new Error('boom');
      await expect(requestHandlers.onRejected!(err)).rejects.toBe(err);
    });
  });

  describe('response interceptor', () => {
    it('passes through successful responses', () => {
      const response = { data: 1 };
      expect(responseHandlers.onFulfilled!(response)).toBe(response);
    });

    it('marks backend down on 502', async () => {
      const error = makeError({ response: { status: 502 } });
      await expect(responseHandlers.onRejected!(error)).rejects.toBe(error);
      expect(setBackendDownSpy).toHaveBeenCalled();
    });

    it('marks backend down on network error (no response)', async () => {
      const error = makeError({ response: undefined });
      await expect(responseHandlers.onRejected!(error)).rejects.toBe(error);
      expect(setBackendDownSpy).toHaveBeenCalled();
    });

    it('does not mark backend down on client timeout', async () => {
      const error = makeError({
        response: undefined,
        code: 'ECONNABORTED',
      });
      await expect(responseHandlers.onRejected!(error)).rejects.toBe(error);
      expect(setBackendDownSpy).not.toHaveBeenCalled();
    });

    it('refreshes CSRF and retries on 403 CSRF error', async () => {
      mockAxiosGet.mockResolvedValue({});
      mockCookieGet.mockReturnValue('new-csrf');
      const error = makeError({
        config: { url: '/data', headers: {} },
        response: { status: 403, data: { message: 'Invalid CSRF token' } },
      });
      const result = (await responseHandlers.onRejected!(error)) as {
        data: string;
      };
      expect(mockAxiosGet).toHaveBeenCalledWith('/api/v1/auth/csrf-refresh', {
        withCredentials: true,
      });
      expect(result.data).toBe('retried');
      const retried = clientCalls[0] as { headers: Record<string, string> };
      expect(retried.headers['X-CSRF-Token']).toBe('new-csrf');
    });

    it('rejects when CSRF refresh fails', async () => {
      mockAxiosGet.mockRejectedValue(new Error('refresh failed'));
      const error = makeError({
        config: { url: '/data', headers: {} },
        response: { status: 403, data: { message: 'CSRF token mismatch' } },
      });
      await expect(responseHandlers.onRejected!(error)).rejects.toBe(error);
      expect(clientCalls.length).toBe(0);
    });

    it('ignores 403 that is not a CSRF error', async () => {
      const error = makeError({
        config: { url: '/data', headers: {} },
        response: { status: 403, data: { message: 'Forbidden' } },
      });
      await expect(responseHandlers.onRejected!(error)).rejects.toBe(error);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('refreshes token and retries on 401', async () => {
      mockAxiosPost.mockResolvedValue({});
      mockCookieGet.mockReturnValue('csrf-after-refresh');
      const error = makeError({
        config: { url: '/protected', headers: {} },
        response: { status: 401 },
      });
      const result = (await responseHandlers.onRejected!(error)) as {
        data: string;
      };
      expect(mockAxiosPost).toHaveBeenCalledWith(
        '/api/v1/auth/refresh',
        {},
        { withCredentials: true },
      );
      expect(result.data).toBe('retried');
      const retried = clientCalls[0] as { headers: Record<string, string> };
      expect(retried.headers['X-CSRF-Token']).toBe('csrf-after-refresh');
    });

    it('queues concurrent 401 requests during a refresh', async () => {
      let resolveRefresh: (value: unknown) => void = () => {};
      mockAxiosPost.mockReturnValue(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );
      mockCookieGet.mockReturnValue('queued-csrf');

      const first = responseHandlers.onRejected!(
        makeError({
          config: { url: '/first', headers: {} },
          response: { status: 401 },
        }),
      );
      const second = responseHandlers.onRejected!(
        makeError({
          config: { url: '/second', headers: {} },
          response: { status: 401 },
        }),
      );

      // Token refresh resolves; the in-flight request retries directly and the
      // queued request is released via processQueue and then replayed.
      resolveRefresh({});

      const [firstResult, secondResult] = (await Promise.all([
        first,
        second,
      ])) as Array<{ data: string }>;
      // Both the original (in-flight) and the queued request were retried.
      expect(firstResult.data).toBe('retried');
      expect(secondResult.data).toBe('retried');
      expect(clientStub).toHaveBeenCalledTimes(2);
      // Only one token refresh happened despite two concurrent 401s.
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
      // The queued request also picked up the refreshed CSRF token.
      const queuedReplay = clientCalls[clientCalls.length - 1] as {
        headers: Record<string, string>;
      };
      expect(queuedReplay.headers['X-CSRF-Token']).toBe('queued-csrf');
    });

    it('logs out and redirects to /login when refresh fails', async () => {
      mockAxiosPost
        .mockRejectedValueOnce(new Error('refresh failed'))
        .mockResolvedValueOnce({});
      const replaceSpy = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { pathname: '/dashboard', replace: replaceSpy },
        writable: true,
        configurable: true,
      });
      const error = makeError({
        config: { url: '/protected', headers: {} },
        response: { status: 401 },
      });
      await expect(responseHandlers.onRejected!(error)).rejects.toBe(error);
      expect(logoutSpy).toHaveBeenCalled();
      expect(mockAxiosPost).toHaveBeenCalledWith(
        '/api/v1/auth/logout',
        {},
        { withCredentials: true },
      );
      expect(replaceSpy).toHaveBeenCalledWith('/login');
    });

    it('swallows logout request errors during forced logout', async () => {
      mockAxiosPost.mockRejectedValue(new Error('everything failed'));
      const replaceSpy = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { pathname: '/dashboard', replace: replaceSpy },
        writable: true,
        configurable: true,
      });
      const error = makeError({
        config: { url: '/protected', headers: {} },
        response: { status: 401 },
      });
      await expect(responseHandlers.onRejected!(error)).rejects.toBe(error);
      expect(logoutSpy).toHaveBeenCalled();
      expect(replaceSpy).toHaveBeenCalledWith('/login');
    });

    it('does not refresh on 401 for an unauth (business) endpoint', async () => {
      const error = makeError({
        config: { url: '/auth/login', headers: {} },
        response: { status: 401 },
      });
      await expect(responseHandlers.onRejected!(error)).rejects.toBe(error);
      expect(mockAxiosPost).not.toHaveBeenCalled();
      expect(logoutSpy).not.toHaveBeenCalled();
    });

    it('does not retry a 401 that was already retried', async () => {
      const error = makeError({
        config: { url: '/protected', headers: {}, _authRetried: true },
        response: { status: 401 },
      });
      await expect(responseHandlers.onRejected!(error)).rejects.toBe(error);
      expect(mockAxiosPost).not.toHaveBeenCalled();
    });
  });
});
