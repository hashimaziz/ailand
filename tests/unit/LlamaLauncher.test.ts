import { describe, it, expect, afterEach, vi } from 'vitest';
import { LlamaLauncher, portFromUrl } from '../../src/ai/llamaLauncher';

type Handler = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function mockFetch(handler: Handler) {
  const spy = vi.fn((url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('portFromUrl', () => {
  it('reads an explicit port', () => {
    expect(portFromUrl('http://127.0.0.1:9099')).toBe(9099);
  });

  it('falls back to the scheme default', () => {
    expect(portFromUrl('http://127.0.0.1')).toBe(80);
  });

  it('returns undefined for nonsense', () => {
    expect(portFromUrl('not a url')).toBeUndefined();
  });
});

describe('LlamaLauncher', () => {
  it('reports unsupported when the dev-server API is absent', async () => {
    mockFetch(async () => {
      throw new Error('404');
    });
    expect(await new LlamaLauncher().isSupported()).toBe(false);
  });

  it('reports supported when the status endpoint answers', async () => {
    mockFetch(async () => jsonResponse({ state: 'stopped', port: 8080, log: [] }));
    expect(await new LlamaLauncher().isSupported()).toBe(true);
  });

  it('reads status', async () => {
    mockFetch(async () => jsonResponse({ state: 'ready', port: 8080, log: ['listening'] }));
    const status = await new LlamaLauncher().status();
    expect(status?.state).toBe('ready');
    expect(status?.log).toEqual(['listening']);
  });

  it('posts the start request with options', async () => {
    const spy = mockFetch(async () => jsonResponse({ state: 'starting', port: 9099, log: [] }));
    await new LlamaLauncher().start({ port: 9099, contextSize: 2048 });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/__llama/start');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ port: 9099, contextSize: 2048 });
  });

  it('returns null rather than throwing when start fails', async () => {
    mockFetch(async () => {
      throw new Error('network');
    });
    expect(await new LlamaLauncher().start()).toBeNull();
  });

  describe('ensureRunning', () => {
    it('starts the server and waits for it to become ready', async () => {
      const states = ['starting', 'starting', 'ready'];
      let index = 0;
      mockFetch(async (url) => {
        if (url.endsWith('/status')) {
          return jsonResponse({ state: states[Math.min(index++, states.length - 1)], port: 8080, log: [] });
        }
        return jsonResponse({ state: 'starting', port: 8080, log: [] });
      });

      const seen: string[] = [];
      const result = await new LlamaLauncher().ensureRunning(
        'http://127.0.0.1:8080',
        {},
        (s) => seen.push(s.state),
      );

      expect(result?.state).toBe('ready');
      expect(seen).toContain('starting');
      expect(seen.at(-1)).toBe('ready');
    });

    it('does not start a second server when one is already ready', async () => {
      const spy = mockFetch(async (url) => {
        if (url.endsWith('/status')) return jsonResponse({ state: 'ready', port: 8080, log: [] });
        return jsonResponse({ state: 'starting', port: 8080, log: [] });
      });

      const result = await new LlamaLauncher().ensureRunning('http://127.0.0.1:8080', {}, () => {});
      expect(result?.state).toBe('ready');
      expect(spy.mock.calls.some(([url]) => String(url).endsWith('/start'))).toBe(false);
    });

    it('surfaces an error state instead of waiting forever', async () => {
      mockFetch(async (url) => {
        if (url.endsWith('/status')) return jsonResponse({ state: 'error', port: 8080, log: [], message: 'no model' });
        return jsonResponse({ state: 'error', port: 8080, log: [], message: 'no model' });
      });

      const result = await new LlamaLauncher().ensureRunning('http://127.0.0.1:8080', {}, () => {});
      expect(result?.state).toBe('error');
      expect(result?.message).toBe('no model');
    });

    it('returns null when there is no launcher to ask', async () => {
      mockFetch(async () => {
        throw new Error('no api');
      });
      expect(await new LlamaLauncher().ensureRunning('http://127.0.0.1:8080', {}, () => {})).toBeNull();
    });

    it('abandons the wait when cancelled', async () => {
      mockFetch(async (url) => {
        if (url.endsWith('/status')) return jsonResponse({ state: 'starting', port: 8080, log: [] });
        return jsonResponse({ state: 'starting', port: 8080, log: [] });
      });

      const result = await new LlamaLauncher().ensureRunning(
        'http://127.0.0.1:8080',
        {},
        () => {},
        () => true,
      );
      expect(result).toBeNull();
    });
  });
});