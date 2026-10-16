import { describe, expect, it } from 'vitest';
import {
  BITCOIN_EVENTS_DEFAULT_URL,
  ETHEREUM_EVENTS_DEFAULT_URL,
  loadConfig,
  validateEventStreamUrl,
} from '../../server/config.js';

describe('operator-owned event endpoints', () => {
  it('enables defaults only alongside their matching public HTTP providers', () => {
    expect(loadConfig({})).toMatchObject({
      bitcoinEventsWsUrl: BITCOIN_EVENTS_DEFAULT_URL,
      ethereumEventsWsUrl: ETHEREUM_EVENTS_DEFAULT_URL,
    });
    const custom = loadConfig({
      BITCOIN_API_URL: 'https://private.example/api',
      ETHEREUM_RPC_URL: 'https://private.example/rpc',
    });
    expect(custom.bitcoinEventsWsUrl).toBeUndefined();
    expect(custom.ethereumEventsWsUrl).toBeUndefined();
    expect(
      loadConfig({ BITCOIN_EVENTS_WS_URL: '', ETHEREUM_EVENTS_WS_URL: '' }).ethereumEventsWsUrl,
    ).toBeUndefined();
    expect(loadConfig({ BITCOIN_EVENTS_WS_URL: '' }).bitcoinEventsWsUrl).toBeUndefined();
  });

  it('accepts only WSS or local WS without credentials and never labels a custom stream PublicNode', () => {
    for (const url of [
      'wss://node.example/private-path?key=example',
      'ws://127.0.0.1:8546',
      'ws://[::1]:8546',
    ])
      expect(validateEventStreamUrl(url)).toMatch(/^wss?:/);
    for (const url of [
      'invalid',
      'ws://node.example',
      'https://node.example',
      'file:///x',
      'wss://user:password@node.example',
      'wss://node.example/#fragment',
    ])
      expect(() => validateEventStreamUrl(url)).toThrow();
    expect(
      loadConfig({ ETHEREUM_EVENTS_WS_URL: 'wss://node.example/private' }).ethereumEventsSource,
    ).toBe('Flux Ethereum configuré');
    expect(
      loadConfig({ BITCOIN_EVENTS_WS_URL: 'wss://node.example/private' }).bitcoinEventsSource,
    ).toBe('Flux Bitcoin configuré');
  });
});
