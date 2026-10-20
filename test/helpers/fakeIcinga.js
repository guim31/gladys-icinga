// -----------------------------------------------------------------------------
// An in-memory Icinga 2 REST API, seeded with the real answers of Icinga 2
// v2.16.5 (test/fixtures/icinga): the hosts and the services that are not OK,
// Basic auth, the `filter` of the services, acknowledgements (with their
// `filter_vars`) and the real error answers. Tests change its state (host
// states, services, downtimes, failures) between two reads.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const ADDRESS = '192.0.2.10';
export const API_URL = `https://${ADDRESS}:5665/v1`;
export const USERNAME = 'gladys';
export const PASSWORD = 'test-password-0123';

export const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/icinga/icinga-2.16.5.json', import.meta.url), 'utf8'),
);
const objects = (name) => fixture[name].response.results.map((row) => structuredClone(row.attrs));
const answer = (name) => structuredClone(fixture[name].response);

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const CHECKED = 1792500600;

export class FakeIcinga {
  constructor({ version = 'v2.16.5' } = {}) {
    this.version = version;
    this.hosts = objects('hosts');
    this.services = objects('services');
    /** 'down' (connection refused), 'proxy' (502), 'not_icinga', or null */
    this.failure = null;
    /** Permissions the API user lacks, e.g. 'status/query'. */
    this.missing = new Set();
    this.calls = [];
    this.acknowledged = [];
  }

  host(name) {
    return this.hosts.find((host) => host.name === name);
  }

  service(host, name) {
    return this.services.find((service) => service.host_name === host && service.name === name);
  }

  /** Put a host in a state: 0 UP, 1 DOWN, 2 UNREACHABLE (DOWN, not reachable). */
  setHost(name, state, extra = {}) {
    Object.assign(this.host(name), {
      state: state === 0 ? 0 : 1,
      last_reachable: state !== 2,
      state_type: 1,
      last_check: CHECKED,
      acknowledgement: 0,
      ...extra,
    });
  }

  /** Put a service in a state (0 removes it from the answers: OK). */
  setService(host, name, state, extra = {}) {
    const existing = this.service(host, name);
    if (state === 0) {
      this.services = this.services.filter((service) => service !== existing);
      return;
    }
    if (existing) {
      Object.assign(existing, { state, state_type: 1, ...extra });
      return;
    }
    this.services.push({
      host_name: host,
      name,
      display_name: name,
      state,
      state_type: 1,
      acknowledgement: 0,
      downtime_depth: 0,
      last_check: CHECKED,
      last_state_change: 1792500000,
      last_check_result: { output: `${name} is ${state}`, state, type: 'CheckResult' },
      ...extra,
    });
  }

  /** The network seam of the client (src/icinga/http.js). */
  async request(url, { method = 'GET', body, headers = {} }) {
    if (this.failure === 'down') {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
    if (this.failure === 'proxy') {
      return { status: 502, headers: {}, body: '<html>Bad Gateway</html>' };
    }
    if (this.failure === 'not_icinga' || !url.startsWith(API_URL)) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<html>Hi</html>' };
    }
    const target = new URL(url);
    const path = target.pathname.slice(new URL(API_URL).pathname.length);
    this.calls.push({ method, path, params: [...target.searchParams] });
    const expected = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;
    if (headers.authorization !== expected) {
      return json(401, answer('unauthorized'));
    }
    const forbidden = (permission) =>
      json(403, { error: 403, status: `Missing permission: ${permission}` });
    const attrs = target.searchParams.getAll('attrs');
    const pick = (row) => Object.fromEntries(attrs.map((attr) => [attr, row[attr]]));
    const results = (type, list, nameOf) =>
      json(200, {
        results: list.map((row) => ({
          attrs: pick(row),
          joins: {},
          meta: {},
          name: nameOf(row),
          type,
        })),
      });

    if (method === 'GET' && path === '/status/IcingaApplication') {
      if (this.missing.has('status/query')) {
        return json(403, answer('status_forbidden'));
      }
      const status = answer('status');
      status.results[0].status.icingaapplication.app.version = this.version;
      return json(200, status);
    }
    if (method === 'GET' && path === '/objects/hosts') {
      if (this.missing.has('objects/query/Host')) {
        return forbidden('objects/query/Host');
      }
      return results('Host', this.hosts, (row) => row.name);
    }
    if (method === 'GET' && path === '/objects/services') {
      const filter = target.searchParams.get('filter');
      const list =
        filter === 'service.state != 0'
          ? this.services.filter((service) => service.state !== 0)
          : this.services;
      return results('Service', list, (row) => `${row.host_name}!${row.name}`);
    }
    if (method === 'POST' && path === '/actions/acknowledge-problem') {
      if (this.missing.has('actions/acknowledge-problem')) {
        return json(403, answer('acknowledge_forbidden'));
      }
      const request = JSON.parse(body);
      this.acknowledged.push(request);
      const { h, names } = request.filter_vars ?? {};
      const targets =
        request.type === 'Host'
          ? this.hosts.filter((host) => host.name === h)
          : this.services.filter(
              (service) => service.host_name === h && names.includes(service.name),
            );
      if (targets.length === 0) {
        return json(404, answer('acknowledge_no_object'));
      }
      const outcome = targets.map((object) => {
        const label = request.type === 'Host' ? object.name : `${object.host_name}!${object.name}`;
        if (object.state === 0) {
          return {
            code: 409,
            status: `${request.type} ${label} is ${request.type === 'Host' ? 'UP' : 'OK'}.`,
          };
        }
        if (object.acknowledgement > 0) {
          return { code: 409, status: `${request.type} ${label} is already acknowledged.` };
        }
        object.acknowledgement = request.sticky ? 2 : 1;
        return { code: 200, status: `Successfully acknowledged problem for object '${label}'.` };
      });
      return json(outcome.some((result) => result.code === 200) ? 200 : 409, { results: outcome });
    }
    return json(404, { error: 404, status: `The requested path '${path}' could not be found.` });
  }
}
