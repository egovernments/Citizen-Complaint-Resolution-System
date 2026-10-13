// ours#840: Localization Edit moves a message when its module or locale changes (configurator-next patch 32).
import { describe, it, beforeEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from '../client/DigitApiClient.js';
import { createDigitDataProvider } from './dataProvider.js';

describe('localization edit: move, not copy', () => {
  let client: DigitApiClient;
  beforeEach(() => {
    client = new DigitApiClient({ url: 'https://test.example.com', stateTenantId: 'pg' });
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
  });

  it('localization edit that changes the module or locale MOVES the message (old one removed after the new one is written)', async () => {
    const calls: string[] = [];
    mock.method(client, 'localizationUpsert', async (_t: string, loc: string, msgs: { code: string; module: string; message: string }[]) => {
      calls.push(`upsert ${loc} ${msgs[0].module} ${msgs[0].code}=${msgs[0].message}`); return msgs;
    });
    mock.method(client, 'localizationDelete', async (_t: string, loc: string, msgs: { code: string; module: string }[]) => {
      calls.push(`delete ${loc} ${msgs[0].module} ${msgs[0].code}`); return true;
    });
    const dp = createDigitDataProvider(client, 'ke');
    const prev = { id: 'K__rainmaker-pgr', code: 'K', message: 'Hello', module: 'rainmaker-pgr', locale: 'en_IN' };
    // module changed, message unchanged
    await dp.update('localization', { id: prev.id, data: { ...prev, module: 'rainmaker-common' }, previousData: prev as never });
    assert.deepEqual(calls, ['upsert en_IN rainmaker-common K=Hello', 'delete en_IN rainmaker-pgr K']);
    // locale changed
    calls.length = 0;
    await dp.update('localization', { id: prev.id, data: { ...prev, locale: 'sw_KE', message: 'Habari' }, previousData: prev as never });
    assert.deepEqual(calls, ['upsert sw_KE rainmaker-pgr K=Habari', 'delete en_IN rainmaker-pgr K']);
    // same module and locale: an edit, nothing deleted
    calls.length = 0;
    await dp.update('localization', { id: prev.id, data: { ...prev, message: 'Hi' }, previousData: prev as never });
    assert.deepEqual(calls, ['upsert en_IN rainmaker-pgr K=Hi']);
  });

  it('localization move: a failed write deletes nothing (the message is never lost)', async () => {
    let deleted = false;
    mock.method(client, 'localizationUpsert', async () => { throw new Error('upsert failed'); });
    mock.method(client, 'localizationDelete', async () => { deleted = true; return true; });
    const dp = createDigitDataProvider(client, 'ke');
    const prev = { id: 'K__a', code: 'K', message: 'Hello', module: 'a', locale: 'en_IN' };
    await assert.rejects(dp.update('localization', { id: prev.id, data: { ...prev, module: 'b' }, previousData: prev as never }));
    assert.equal(deleted, false);
  });
});
