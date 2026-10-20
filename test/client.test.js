// The REST API client against the fake Icinga (real v2.16.5 answers): the
// snapshot, the scope (host groups), the errors, and acknowledgements.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, IcingaClient, SERVICE_FILTER, inScope } from '../src/icinga/client.js';
import { API_URL, FakeIcinga, PASSWORD, USERNAME } from './helpers/fakeIcinga.js';

const clientFor = (icinga, options = {}) =>
  new IcingaClient({
    url: API_URL,
    username: USERNAME,
    password: PASSWORD,
    request: (url, request) => icinga.request(url, request),
    ...options,
  });

async function rejectsWith(promise, kind) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind, err.message);
    return true;
  });
}

test('snapshot: version, hosts and the services that are not OK, from the real answers', async () => {
  const icinga = new FakeIcinga();
  const snapshot = await clientFor(icinga).snapshot();
  assert.equal(snapshot.version, '2.16.5');
  assert.equal(snapshot.total, 6);
  assert.deepEqual(
    snapshot.hosts.map((host) => [host.name, host.alias, host.state, host.downtime, host.hard]),
    [
      ['behindhost', 'behindhost', 2, false, true], // DOWN behind a parent down: UNREACHABLE
      ['router', 'router', 0, false, true],
      ['outside', 'outside', 1, true, true],
      ['deadhost', 'deadhost', 1, false, true],
      ['nas', 'NAS', 0, false, true],
      ['newhost', 'newhost', null, false, false], // never checked: PENDING, though Icinga says DOWN
    ],
  );
  assert.deepEqual(snapshot.hosts[1].groups, ['homelab', 'office']);
  assert.deepEqual(
    snapshot.services.find((service) => service.name === 'backup'),
    {
      host: 'nas',
      name: 'backup',
      service: 'Nightly backup',
      state: 2,
      acknowledged: false,
      downtime: false,
      since: 1792500541.792216,
      hard: true,
      output: 'Last backup 3 days ago',
    },
  );
  const byName = (name) => snapshot.services.find((service) => service.name === name);
  assert.equal(byName('disk').acknowledged, true, 'sticky acknowledgement (2)');
  assert.equal(byName('http').downtime, true);
  assert.equal(byName('ping4').hard, false, 'SOFT while Icinga retries');
  assert.equal(byName('load'), undefined, 'a service never checked is PENDING, not UNKNOWN');
  assert.equal(snapshot.services.length, 6);
  // Basic auth, and the services filter asks for the non-OK ones.
  const services = icinga.calls.find((call) => call.path === '/objects/services');
  assert.ok(services.params.some(([key, value]) => key === 'filter' && value === SERVICE_FILTER));
  assert.ok(
    services.params.some(([key, value]) => key === 'attrs' && value === 'last_check_result'),
  );
});

test('host groups keep their hosts, case aside', async () => {
  const icinga = new FakeIcinga();
  const { hosts, services, total } = await clientFor(icinga).snapshot({ groups: ['HomeLab'] });
  assert.deepEqual(
    hosts.map((host) => host.name),
    ['router', 'nas', 'newhost'],
  );
  assert.equal(total, 6, 'the total counts every host');
  assert.ok(services.every((service) => ['router', 'nas'].includes(service.host)));
  assert.equal(inScope({ groups: [] }, { groups: ['x'] }), false);
  assert.equal(inScope({ groups: [] }, {}), true);
});

test('a service of a host in downtime is in downtime too', async () => {
  const icinga = new FakeIcinga();
  icinga.setService('outside', 'ssh', 2, { downtime_depth: 0 });
  const { services } = await clientFor(icinga).snapshot();
  assert.equal(services.find((service) => service.name === 'ssh').downtime, true);
});

test('the output keeps its first line only', async () => {
  const icinga = new FakeIcinga();
  icinga.setService('nas', 'multi', 1, {
    last_check_result: { output: 'WARNING - two disks\ndisk1 ok\ndisk2 85%' },
  });
  const { services } = await clientFor(icinga).snapshot();
  assert.equal(services.find((service) => service.name === 'multi').output, 'WARNING - two disks');
});

test('without status/query, the version stays unknown: not an error', async () => {
  const icinga = new FakeIcinga();
  icinga.missing.add('status/query');
  const snapshot = await clientFor(icinga).snapshot();
  assert.equal(snapshot.version, '');
  assert.equal(snapshot.hosts.length, 6);
});

test('the version is read once, again after reset()', async () => {
  const icinga = new FakeIcinga();
  const client = clientFor(icinga);
  await client.snapshot();
  await client.snapshot();
  const reads = () => icinga.calls.filter((call) => call.path === '/status/IcingaApplication');
  assert.equal(reads().length, 1);
  client.reset();
  await client.snapshot();
  assert.equal(reads().length, 2);
});

test('errors: credentials, permissions, no host, not Icinga, unreachable, TLS, http://', async () => {
  const icinga = new FakeIcinga();
  await rejectsWith(clientFor(icinga, { password: 'wrong' }).snapshot(), ERROR_KINDS.AUTH);
  await rejectsWith(
    clientFor(icinga, { password: '' }).snapshot(),
    ERROR_KINDS.CREDENTIALS_MISSING,
  );

  icinga.missing.add('objects/query/Host');
  await rejectsWith(clientFor(icinga).snapshot(), ERROR_KINDS.PERMISSION);
  icinga.missing.clear();

  const empty = new FakeIcinga();
  empty.hosts = [];
  await rejectsWith(clientFor(empty).snapshot(), ERROR_KINDS.NO_HOSTS);

  icinga.failure = 'not_icinga';
  await rejectsWith(clientFor(icinga).snapshot(), ERROR_KINDS.NOT_ICINGA);
  icinga.failure = 'proxy';
  await rejectsWith(clientFor(icinga).snapshot(), ERROR_KINDS.UNREACHABLE);
  icinga.failure = 'down';
  await rejectsWith(clientFor(icinga).snapshot(), ERROR_KINDS.UNREACHABLE);

  await rejectsWith(
    clientFor(icinga, {
      request: async () => ({ status: 401, headers: {}, body: '<html>Proxy login</html>' }),
    }).snapshot(),
    ERROR_KINDS.AUTH,
  );
  // Spaces travel as %20: Icinga does not decode `+`.
  const sent = [];
  await clientFor(icinga, {
    request: (url, request) => {
      sent.push(url);
      return new FakeIcinga().request(url, request);
    },
  }).snapshot();
  assert.ok(
    sent.some((url) => url.includes('filter=service.state%20!%3D%200')),
    sent.join('\n'),
  );
  assert.ok(sent.every((url) => !url.includes('+')));

  const failing = (code) => async () => {
    throw Object.assign(new Error(code), { code });
  };
  await rejectsWith(
    clientFor(icinga, { request: failing('SELF_SIGNED_CERT_IN_CHAIN') }).snapshot(),
    ERROR_KINDS.TLS,
  );
  await rejectsWith(
    clientFor(icinga, {
      url: 'http://192.0.2.10:5665/v1',
      request: failing('ECONNRESET'),
    }).snapshot(),
    ERROR_KINDS.HTTPS_REQUIRED,
  );
  await rejectsWith(
    clientFor(icinga, { request: failing('ECONNRESET') }).snapshot(),
    ERROR_KINDS.UNREACHABLE,
  );
});

test('the password never appears in an error message', async () => {
  const icinga = new FakeIcinga();
  for (const failure of [null, 'not_icinga', 'proxy', 'down']) {
    icinga.failure = failure;
    await assert.rejects(
      clientFor(icinga, { password: failure ? PASSWORD : 'wrong' }).snapshot(),
      (err) => {
        assert.ok(!err.message.includes(PASSWORD));
        return true;
      },
    );
  }
});

test('acknowledge: counts the objects acknowledged, a 409 counts for nothing', async () => {
  const icinga = new FakeIcinga();
  const client = clientFor(icinga);
  assert.equal(await client.acknowledgeHost('deadhost', 'Seen'), 1);
  assert.equal(icinga.host('deadhost').acknowledgement, 2);
  assert.equal(await client.acknowledgeHost('deadhost', 'Seen'), 0, 'already acknowledged');
  assert.equal(await client.acknowledgeHost('router', 'Seen'), 0, 'UP');
  assert.equal(
    await client.acknowledgeServices('nas', ['backup', 'temperature', 'disk'], 'Seen'),
    2,
  );
  assert.equal(await client.acknowledgeServices('nas', ['gone'], 'Seen'), 0, '404 no objects');
  assert.deepEqual(icinga.acknowledged[0], {
    type: 'Host',
    filter: 'host.name == h',
    filter_vars: { h: 'deadhost' },
    author: 'Gladys',
    comment: 'Seen',
    sticky: true,
    notify: false,
  });
  icinga.missing.add('actions/acknowledge-problem');
  await rejectsWith(client.acknowledgeHost('outside', 'Seen'), ERROR_KINDS.PERMISSION);
});
