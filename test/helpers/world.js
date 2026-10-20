// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Icinga, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read Icinga with
// `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { hostIds, instanceIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { ADDRESS, API_URL, FakeIcinga, PASSWORD, USERNAME } from './fakeIcinga.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const BASE_CONFIG = {
  icinga_url: ADDRESS,
  username: USERNAME,
  password: PASSWORD,
  language: 'en',
};

/** A manual clock, shared by the hub and the tests (the fixture states changed around 1792500540). */
export function createClock(start = 1792500600_000) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  icinga = new FakeIcinga(),
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-icinga-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: (url, options) => {
      if (!url.startsWith(new URL(API_URL).origin)) {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      }
      return icinga.request(url, options);
    },
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, icinga, app, hub: app.hub, clock, dataDir };
}

export const hostDevice = (gladys, name) => hostIds(gladys, name).device;
export const hostFeature = (gladys, name, key) => hostIds(gladys, name).feature(key);
export const instanceFeature = (gladys, key) => instanceIds(gladys).feature(key);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { ADDRESS, API_URL, FakeIcinga, PASSWORD, USERNAME };
