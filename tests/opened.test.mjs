import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarStore, PARTICIPANT_DELETE_AT } from '../server/store.mjs';

test('Öffnungen sind je Konto und Kalenderjahr getrennt, wiederholbar und ohne zusätzliche Profildaten', () => {
  const store = new CalendarStore(':memory:');
  try {
    store.login({ id: '123456789012345678' }, Date.parse('2026-12-02T12:00:00Z'));
    store.login({ id: '999999999999999999' }, Date.parse('2026-12-02T12:00:00Z'));
    store.openDoor('123456789012345678', 2026, 2);
    store.openDoor('123456789012345678', 2026, 1);
    store.openDoor('123456789012345678', 2026, 1);
    store.openDoor('123456789012345678', 2025, 4);
    store.openDoor('999999999999999999', 2026, 2);
    assert.deepEqual(store.opened('123456789012345678', 2026), [1,2]);
    store.resetOpened('123456789012345678', 2026);
    assert.deepEqual(store.opened('123456789012345678', 2026), []);
    assert.deepEqual(store.opened('123456789012345678', 2025), [4]);
    assert.deepEqual(store.opened('999999999999999999', 2026), [2]);
    assert.deepEqual(store.db.prepare('PRAGMA table_info(opened)').all().map(column => column.name), ['user_id','year','day']);
    store.cleanup(PARTICIPANT_DELETE_AT);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM opened').get().count, 0);
  } finally { store.close(); }
});
