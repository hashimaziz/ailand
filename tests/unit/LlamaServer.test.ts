import { describe, it, expect, beforeEach } from 'vitest';
import { LlamaStreamDecoder } from '../../src/ai/LlamaServerLanguageModel';
import {
  DEFAULT_APP_CONFIG,
  configFromSearch,
  getConfig,
  setConfig,
  resetConfig,
} from '../../src/config/appConfig';

function deltas(events: ReturnType<LlamaStreamDecoder['push']>): string {
  return events
    .filter((e): e is { type: 'delta'; text: string } => e.type === 'delta')
    .map((e) => e.text)
    .join('');
}

describe('LlamaStreamDecoder', () => {
  it('decodes a single complete frame', () => {
    const decoder = new LlamaStreamDecoder();
    const events = decoder.push('data: {"choices":[{"delta":{"content":"Hi"}}]}\n');
    expect(deltas(events)).toBe('Hi');
  });

  it('decodes multiple frames in one chunk', () => {
    const decoder = new LlamaStreamDecoder();
    const events = decoder.push(
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n' +
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
    );
    expect(deltas(events)).toBe('Hello');
  });

  it('handles frames split at arbitrary chunk boundaries', () => {
    const stream =
      'data: {"choices":[{"delta":{"content":"Hello there"}}]}\n' +
      'data: {"choices":[{"delta":{"content":" friend"}}]}\n' +
      'data: {"timings":{"predicted_n":4,"predicted_ms":250,"prompt_n":120,"prompt_ms":40},"choices":[{"delta":{}}]}\n' +
      'data: [DONE]\n';

    for (const size of [1, 3, 7, 17, 64, 4096]) {
      const decoder = new LlamaStreamDecoder();
      let text = '';
      let done = false;
      let usage: unknown;
      for (let i = 0; i < stream.length; i += size) {
        for (const event of decoder.push(stream.slice(i, i + size))) {
          if (event.type === 'delta') text += event.text;
          else if (event.type === 'done') {
            done = true;
            if (event.usage) usage = event.usage;
          }
        }
      }
      expect(text, `chunk size ${size}`).toBe('Hello there friend');
      expect(done, `chunk size ${size}`).toBe(true);
      expect(usage, `chunk size ${size}`).toMatchObject({ completionTokens: 4, promptTokens: 120 });
    }
  });

  it('ignores keep-alive comments and blank lines', () => {
    const decoder = new LlamaStreamDecoder();
    const events = decoder.push(': keep-alive\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n');
    expect(deltas(events)).toBe('ok');
  });

  it('reports a server error frame', () => {
    const decoder = new LlamaStreamDecoder();
    const events = decoder.push('data: {"error":{"message":"model not loaded"}}\n');
    expect(events[0]).toEqual({ type: 'error', message: 'model not loaded' });
  });

  it('reports a plain string error frame', () => {
    const decoder = new LlamaStreamDecoder();
    expect(decoder.push('data: {"error":"nope"}\n')[0]).toEqual({
      type: 'error',
      message: 'nope',
    });
  });

  it('skips a malformed frame instead of failing the turn', () => {
    const decoder = new LlamaStreamDecoder();
    expect(decoder.push('data: {not json}\n')).toEqual([]);
    expect(deltas(decoder.push('data: {"choices":[{"delta":{"content":"fine"}}]}\n'))).toBe('fine');
  });

  it('flushes a trailing frame that arrived without a newline', () => {
    const decoder = new LlamaStreamDecoder();
    expect(deltas(decoder.push('data: {"choices":[{"delta":{"content":"tail"}}]}'))).toBe('');
    expect(deltas(decoder.flush())).toBe('tail');
  });

  it('stops emitting after DONE', () => {
    const decoder = new LlamaStreamDecoder();
    decoder.push('data: [DONE]\n');
    expect(decoder.isFinished).toBe(true);
    expect(decoder.push('data: {"choices":[{"delta":{"content":"late"}}]}\n')).toEqual([]);
  });

  it('tolerates an empty stream', () => {
    const decoder = new LlamaStreamDecoder();
    expect(decoder.push('')).toEqual([]);
    // Nothing to flush; the caller decides the stream simply produced no text.
    expect(decoder.flush()).toEqual([]);
  });
});

describe('runtime configuration', () => {
  beforeEach(() => resetConfig());

  it('defaults to the in-browser runtime with no setup', () => {
    expect(DEFAULT_APP_CONFIG.runtime).toBe('browser');
  });

  it('accepts a llama server runtime from the URL', () => {
    expect(configFromSearch('?runtime=llama')).toEqual({ runtime: 'llamaServer' });
    expect(configFromSearch('?runtime=browser')).toEqual({ runtime: 'browser' });
  });

  it('accepts a custom server URL', () => {
    expect(configFromSearch('?serverUrl=http://localhost:9000')).toEqual({
      llamaServerUrl: 'http://localhost:9000',
    });
  });

  it('accepts a llama model choice from the URL', () => {
    expect(configFromSearch('?llamaModel=b.gguf')).toEqual({ llamaModel: 'b.gguf' });
  });

  it('defaults the llama model to empty so the server decides', () => {
    expect(DEFAULT_APP_CONFIG.llamaModel).toBe('');
  });

  it('keeps the chosen model when other fields change', () => {
    setConfig({ llamaModel: 'b.gguf' });
    setConfig({ runBenchmark: true });
    expect(getConfig().llamaModel).toBe('b.gguf');
  });

  it('ignores an unknown runtime', () => {
    expect(configFromSearch('?runtime=carrier-pigeon')).toEqual({});
  });

  it('stores a llama server selection', () => {
    const config = setConfig({ runtime: 'llamaServer', llamaServerUrl: 'http://localhost:9999' });
    expect(config.runtime).toBe('llamaServer');
    expect(config.llamaServerUrl).toBe('http://localhost:9999');
    // Unrelated fields survive.
    expect(config.modelKey).toBe(DEFAULT_APP_CONFIG.modelKey);
  });
});