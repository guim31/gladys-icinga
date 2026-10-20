import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  MAX_GROUPS,
  addressOf,
  normalizeConfig,
  parseApiUrl,
  parseGroups,
} from '../src/config.js';

test('the address, with or without scheme, port or API path, gives the REST API URL', () => {
  const api = 'https://192.0.2.5:5665/v1';
  const cases = {
    '192.0.2.5': api,
    '192.0.2.5:5665': api,
    'https://192.0.2.5': api,
    'https://192.0.2.5:5665/': api,
    'https://192.0.2.5:5665/v1/objects/hosts?attrs=name': api,
    ' icinga.lan ': 'https://icinga.lan:5665/v1',
    '[2001:db8::5]': 'https://[2001:db8::5]:5665/v1',
    // A port typed is kept, even the default one of HTTPS (a reverse proxy).
    'https://monitoring.example.com:443/icinga-api/v1':
      'https://monitoring.example.com/icinga-api/v1',
    'http://192.0.2.5:8080': 'http://192.0.2.5:8080/v1',
  };
  for (const [typed, expected] of Object.entries(cases)) {
    assert.equal(parseApiUrl(typed), expected, typed);
  }
  const bad = ['', '   ', 'ftp://192.0.2.5', 'https://root:pass@192.0.2.5', 'https://', 42];
  for (const typed of bad) {
    assert.equal(parseApiUrl(typed), null, String(typed));
  }
  assert.equal(addressOf(api), '192.0.2.5:5665');
});

test('host groups: separated by commas, `;` or new lines, without duplicates', () => {
  assert.deepEqual(parseGroups(' homelab, linux-servers ;Homelab\noffice,,'), [
    'homelab',
    'linux-servers',
    'office',
  ]);
  assert.deepEqual(parseGroups(undefined), []);
  assert.equal(
    parseGroups(Array.from({ length: 30 }, (_, i) => `g${i}`).join(',')).length,
    MAX_GROUPS,
  );
});

test('normalizeConfig: defaults, an invalid address, booleans as strings', () => {
  const empty = normalizeConfig({});
  assert.equal(empty.apiUrl, null);
  assert.equal(empty.invalidUrl, false);
  assert.equal(empty.pollIntervalMs, 60_000);
  assert.equal(empty.allowAcknowledge, true);
  assert.equal(empty.allowSelfSigned, true, 'Icinga has its own CA');
  assert.equal(empty.language, DEFAULT_CONFIG.language);
  assert.deepEqual(empty.groups, []);

  const config = normalizeConfig({
    icinga_url: 'ftp://192.0.2.5',
    username: ' gladys ',
    password: ' abc \n',
    host_groups: 'homelab',
    poll_interval: 120,
    allow_acknowledge: 'false',
    allow_self_signed: 'false',
    language: 'xx',
  });
  assert.equal(config.invalidUrl, true);
  assert.equal(config.username, 'gladys');
  assert.equal(config.password, 'abc');
  assert.deepEqual(config.groups, ['homelab']);
  assert.equal(config.pollIntervalMs, 120_000);
  assert.equal(config.allowAcknowledge, false);
  assert.equal(config.allowSelfSigned, false);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: '15' }).pollIntervalMs, 60_000);
});
