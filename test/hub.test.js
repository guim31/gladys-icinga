// The hub against the fake Icinga: discovery, states of the added devices
// only, scene events on hosts and services (kept across a restart, held
// during a downtime, HARD states only), Icinga unreachable, heartbeat, the
// reading timer, and quiet logs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS } from '../src/devices.js';
import { TRIGGERS } from '../src/hub.js';
import {
  BASE_CONFIG,
  FakeIcinga,
  PASSWORD,
  createClock,
  createDevices,
  createWorld,
  hostDevice,
  hostFeature,
  instanceFeature,
} from './helpers/world.js';

/** The lines written at `LOG_LEVEL=info` from now on (the SDK logger reads it per line). */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

async function world(t, options = {}) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

const keysOf = (w) => w.fake.sceneEvents.map((event) => event.key);
const DEVICES = 7; // "Icinga" and the six hosts of the fixture

test('discovery: the Icinga device and one device per host, sorted by display name', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Icinga', 'behindhost', 'deadhost', 'NAS', 'newhost', 'outside', 'router'],
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // Nothing is published for a device not added: Gladys would drop it.
  assert.equal(w.fake.states.length, 0);
});

test('host groups keep their hosts, and the Icinga device counts them only', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, host_groups: 'homelab' } });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Icinga', 'NAS', 'newhost', 'router'],
  );
  await createDevices(w);
  assert.equal(w.fake.lastState(instanceFeature(w.gladys, FEATURE_KEYS.HOSTS_DOWN)), 0);
  assert.equal(w.fake.lastState(instanceFeature(w.gladys, FEATURE_KEYS.CRIT)), 2);
});

test('added devices get every state, then only the changes', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const state = (host, key) => w.fake.lastState(hostFeature(w.gladys, host, key));
  assert.equal(state('nas', FEATURE_KEYS.UP), 1);
  assert.equal(state('nas', FEATURE_KEYS.WARN), 1);
  assert.equal(state('nas', FEATURE_KEYS.CRIT), 1);
  assert.equal(state('nas', FEATURE_KEYS.UNKNOWN), 1);
  assert.equal(state('nas', FEATURE_KEYS.UNHANDLED), 2, 'the disk is acknowledged');
  assert.equal(state('router', FEATURE_KEYS.CRIT), 1, 'a SOFT state counts in the devices');
  assert.equal(state('deadhost', FEATURE_KEYS.UP), 0);
  assert.equal(state('deadhost', FEATURE_KEYS.UNHANDLED), 1);
  assert.equal(state('deadhost', FEATURE_KEYS.ACKNOWLEDGED), 0);
  assert.equal(state('behindhost', FEATURE_KEYS.UP), 0, 'UNREACHABLE is not up');
  assert.equal(state('behindhost', FEATURE_KEYS.UNHANDLED), 2);
  assert.equal(state('outside', FEATURE_KEYS.DOWNTIME), 1);
  assert.equal(state('outside', FEATURE_KEYS.UNHANDLED), 0, 'in a downtime: handled');
  assert.equal(state('newhost', FEATURE_KEYS.UP), undefined, 'PENDING: nothing for "up"');
  const total = (key) => w.fake.lastState(instanceFeature(w.gladys, key));
  assert.equal(total(FEATURE_KEYS.HOSTS_DOWN), 3);
  assert.equal(total(FEATURE_KEYS.WARN), 1);
  assert.equal(total(FEATURE_KEYS.CRIT), 4);
  assert.equal(total(FEATURE_KEYS.UNKNOWN), 1);
  assert.equal(total(FEATURE_KEYS.UNHANDLED), 6);

  const before = w.fake.states.length;
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');

  w.icinga.setHost('behindhost', 0);
  w.icinga.setService('behindhost', 'ping', 0);
  w.icinga.setService('nas', 'web', 3);
  w.icinga.host('deadhost').acknowledgement = 1;
  await w.hub.pollAll();
  assert.equal(state('behindhost', FEATURE_KEYS.UP), 1);
  assert.equal(state('behindhost', FEATURE_KEYS.CRIT), 0);
  assert.equal(state('nas', FEATURE_KEYS.UNKNOWN), 2);
  assert.equal(state('deadhost', FEATURE_KEYS.ACKNOWLEDGED), 1);
  assert.equal(state('deadhost', FEATURE_KEYS.UNHANDLED), 0);
  assert.equal(total(FEATURE_KEYS.HOSTS_DOWN), 2);
});

test('a device added later receives everything at once, and the widget is refreshed', async (t) => {
  const w = await world(t);
  const nas = w.fake.discoveredDevices.find((device) => device.name === 'NAS');
  await w.fake.deviceCreated(nas);
  assert.equal(w.fake.lastState(hostFeature(w.gladys, 'nas', FEATURE_KEYS.CRIT)), 1);
  assert.ok(w.fake.widgetRefreshes.includes('problems'));
  // "Update" (onDeviceUpdated) sends everything again too.
  const count = w.fake.states.length;
  await w.fake.deviceUpdated(nas);
  assert.ok(w.fake.states.length > count);
});

test('scene events: the first read records, then hosts down and up', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  assert.deepEqual(w.fake.sceneEvents, [], 'the problems already there are not announced');

  w.icinga.setHost('nas', 1, { last_state_change: 1792500600 });
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.HOST_DOWN,
      data: { device: hostDevice(w.gladys, 'nas'), host: 'NAS', state_name: 'DOWN' },
    },
  ]);
  // DOWN to UNREACHABLE: still down, not announced again.
  w.icinga.setHost('nas', 2);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 1);

  clock.advance(10 * 60_000);
  w.icinga.setHost('nas', 0);
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: TRIGGERS.HOST_UP,
    data: { device: hostDevice(w.gladys, 'nas'), host: 'NAS', duration_minutes: 10 },
  });
  // A host down from the start is announced up when it comes back.
  w.icinga.setHost('deadhost', 0);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.at(-1).data.host, 'deadhost');
  assert.equal(w.fake.sceneEvents.length, 3);
});

test('a host that goes UNREACHABLE is announced with that state', async (t) => {
  const w = await world(t);
  w.icinga.setHost('router', 2);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents[0].data.state_name, 'UNREACHABLE');
});

test('scene events: a service enters a problem, worsens, recovers', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  w.icinga.setService('nas', 'memory', 1, {
    display_name: 'Memory',
    last_state_change: 1792500600,
    last_check_result: { output: 'RAM used: 85%' },
  });
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.SERVICE_PROBLEM,
      data: {
        device: hostDevice(w.gladys, 'nas'),
        host: 'NAS',
        service: 'Memory',
        state: 1,
        state_name: 'WARNING',
        output: 'RAM used: 85%',
      },
    },
  ]);
  w.icinga.setService('nas', 'memory', 2);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.at(-1).data.state_name, 'CRITICAL');
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 2, 'unchanged: not again');

  clock.advance(5 * 60_000);
  w.icinga.setService('nas', 'memory', 0);
  // A service of the fixture, CRITICAL from the start, recovers too.
  w.icinga.setService('nas', 'backup', 0);
  await w.hub.pollAll();
  assert.deepEqual(
    w.fake.sceneEvents.slice(2).map((event) => [event.key, event.data.service, event.data.state]),
    [
      [TRIGGERS.SERVICE_RECOVERED, 'Nightly backup', 2],
      [TRIGGERS.SERVICE_RECOVERED, 'Memory', 2],
    ],
  );
  const memory = w.fake.sceneEvents.at(-1).data;
  assert.equal(memory.duration_minutes, 5);
  assert.equal(memory.state_name, 'CRITICAL');
});

test('a service renamed (display name) is the same service', async (t) => {
  const w = await world(t);
  w.icinga.service('nas', 'backup').display_name = 'Backup';
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('a host removed from Icinga takes its services along, without events', async (t) => {
  const w = await world(t);
  w.icinga.hosts = w.icinga.hosts.filter((host) => host.name !== 'behindhost');
  w.icinga.setService('behindhost', 'ping', 0);
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('a downtime holds the events until it ends', async (t) => {
  const w = await world(t);
  w.icinga.setHost('nas', 1, { downtime_depth: 1 });
  // A service of a host in downtime is held too.
  w.icinga.setService('nas', 'memory', 2);
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
  w.icinga.host('nas').downtime_depth = 0;
  await w.hub.pollAll();
  assert.deepEqual(keysOf(w), [TRIGGERS.HOST_DOWN, TRIGGERS.SERVICE_PROBLEM]);
  // A problem born and gone in a downtime is never announced.
  w.icinga.setService('router', 'flapping', 2, { downtime_depth: 1 });
  await w.hub.pollAll();
  w.icinga.setService('router', 'flapping', 0);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 2);
});

test('a restart neither repeats nor misses a change', async (t) => {
  const icinga = new FakeIcinga();
  const first = await world(t, { icinga });
  icinga.setService('nas', 'kept', 2);
  await first.hub.pollAll();
  await first.app.stop();
  assert.equal(first.fake.sceneEvents.length, 1);

  // While the integration was stopped: one problem ends, another one starts.
  icinga.setService('nas', 'kept', 0);
  icinga.setService('nas', 'fresh', 1);
  const second = await world(t, { icinga, dataDir: first.dataDir });
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => [event.key, event.data.service]),
    [
      [TRIGGERS.SERVICE_PROBLEM, 'fresh'],
      [TRIGGERS.SERVICE_RECOVERED, 'kept'],
    ],
  );
});

test('another scope records its problems without announcing them', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, host_groups: 'homelab' } });
  w.icinga.host('outside').downtime_depth = 0;
  w.icinga.service('outside', 'http').downtime_depth = 0;
  await w.fake.configUpdated({ ...BASE_CONFIG, host_groups: '' });
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('Icinga silent twice: one scene event, unreachable badges, then back', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.icinga.failure = 'down';
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [], 'one failure is a blip');
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.UNREACHABLE,
      data: { address: '192.0.2.10:5665', error: 'Icinga does not answer' },
    },
  ]);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.ok(w.fake.transports.slice(-DEVICES).every((entry) => entry.transport === 'unreachable'));
  w.icinga.failure = null;
  await w.hub.pollAll();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.ok(w.fake.transports.slice(-DEVICES).every((entry) => entry.transport === 'local'));
});

test('a refused password is a connection status, not an outage', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, password: 'wrong' } });
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /password refused/);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('an unchanged value is sent again after 6 hours', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  await createDevices(w);
  const count = w.fake.states.length;
  clock.advance(6 * 3600_000);
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, count * 2);
});

test('the container reads Icinga on its own timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { timers: true });
  const reads = () => w.icinga.calls.filter((call) => call.path === '/objects/services').length;
  const first = reads();
  t.mock.timers.tick(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  await w.hub.polling;
  assert.equal(reads(), first + 1);
});

test('a normal cycle writes nothing at the info level; a failure one line each way', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const lines = captureLogs(t);
  w.icinga.setService('nas', 'quiet', 2);
  await w.hub.pollAll();
  w.icinga.setService('nas', 'quiet', 0);
  await w.hub.pollAll();
  await w.hub.rediscover();
  assert.equal(w.fake.sceneEvents.length, 2);
  assert.deepEqual(lines, []);

  w.icinga.failure = 'down';
  for (let read = 0; read < 4; read += 1) {
    await w.hub.pollAll();
  }
  w.icinga.failure = null;
  await w.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.ok(
    lines.every((line) => !line.includes(PASSWORD)),
    'no password in the logs',
  );
});

test('a burst of new problems is capped per read, the rest follows', async (t) => {
  const w = await world(t);
  for (let index = 0; index < 40; index += 1) {
    w.icinga.setService('nas', `service-${index}`, 2);
  }
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 30);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 40);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 40);
});

test('Gladys refusing the scene events (restarting): sent at a next read, once', async (t) => {
  const w = await world(t);
  const original = w.gladys.publishSceneEvent.bind(w.gladys);
  let refuse = true;
  w.gladys.publishSceneEvent = (key, data) =>
    refuse ? Promise.reject(new Error('ECONNREFUSED')) : original(key, data);
  w.icinga.setHost('nas', 1);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 0);
  refuse = false;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(keysOf(w), [TRIGGERS.HOST_DOWN]);
});

test('a new scope during a read: the old read does not prime the new scope', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, host_groups: 'homelab' } });
  const reading = w.hub.pollAll();
  await w.fake.configUpdated({ ...BASE_CONFIG, host_groups: '' });
  await reading;
  w.icinga.host('outside').downtime_depth = 0;
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.equal(w.fake.discoveredDevices.length, DEVICES);
});

test('no configuration: a clear connection status, no request', async (t) => {
  const w = await world(t, { config: {} });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Enter the address/);
  assert.equal(w.icinga.calls.length, 0);
});

test('"Test the connection" sums up Icinga', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, host_groups: 'homelab' } });
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    '192.0.2.10:5665: OK, Icinga 2.16.5, 3/6 host(s), 0 host(s) down, 4 service problem(s)',
  );
  assert.match(ack.data.message.fr, /^192\.0\.2\.10:5665 : OK/);
});

test('no host visible: an error, and nothing is taken for resolved', async (t) => {
  const w = await world(t);
  const hosts = w.icinga.hosts;
  const services = w.icinga.services;
  w.icinga.hosts = [];
  w.icinga.services = [];
  await w.hub.pollAll();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /no host visible/);
  assert.equal(w.fake.discoveredDevices.length, DEVICES, 'the list Gladys has stays');
  w.icinga.hosts = hosts;
  w.icinga.services = services;
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('a SOFT state is not announced until Icinga confirms it (HARD)', async (t) => {
  const w = await world(t);
  w.icinga.setHost('nas', 1, { state_type: 0 });
  w.icinga.setService('nas', 'flaky', 2, { state_type: 0 });
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
  w.icinga.setHost('nas', 0);
  w.icinga.setService('nas', 'flaky', 0);
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [], 'a SOFT blip that heals: nothing at all');
  w.icinga.setService('nas', 'flaky', 2, { state_type: 1 });
  await w.hub.pollAll();
  assert.deepEqual(keysOf(w), [TRIGGERS.SERVICE_PROBLEM]);
  // The SOFT ping4 of the router, already there, turns HARD: announced.
  w.icinga.service('router', 'ping4').state_type = 1;
  await w.hub.pollAll();
  assert.deepEqual(keysOf(w), [TRIGGERS.SERVICE_PROBLEM, TRIGGERS.SERVICE_PROBLEM]);
});

test('a new password for the same user keeps the problems already seen', async (t) => {
  const w = await world(t);
  w.icinga.setService('nas', 'kept', 2);
  await w.hub.pollAll();
  await w.fake.configUpdated({ ...BASE_CONFIG, password: 'rotated' });
  await w.fake.configUpdated(BASE_CONFIG);
  w.icinga.setService('nas', 'kept', 0);
  await w.hub.pollAll();
  assert.deepEqual(keysOf(w), [TRIGGERS.SERVICE_PROBLEM, TRIGGERS.SERVICE_RECOVERED]);
});

test('a host down since its creation (last_state_change 0) still gets a duration', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  clock.advance(3 * 3600_000);
  w.icinga.setHost('deadhost', 0);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents[0].data.duration_minutes, 180);
});

test('a recovery carries the current display name of the service', async (t) => {
  const w = await world(t);
  w.icinga.service('nas', 'backup').display_name = 'Backup job';
  await w.hub.pollAll();
  w.icinga.setService('nas', 'backup', 0);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents[0].data.service, 'Backup job');
});

test('an outage after another kind of error is announced again', async (t) => {
  const w = await world(t);
  w.icinga.failure = 'down';
  await w.hub.pollAll();
  await w.hub.pollAll();
  w.icinga.failure = 'not_icinga';
  await w.hub.pollAll();
  w.icinga.failure = 'down';
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(keysOf(w), [TRIGGERS.UNREACHABLE, TRIGGERS.UNREACHABLE]);
});
