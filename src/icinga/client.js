// -----------------------------------------------------------------------------
// Icinga 2 REST API client (`https://<host>:5665/v1`), with an API user
// (`ApiUser` object) in Basic auth.
//
// One read (snapshot) = two or three GET requests: the version
// (`status/IcingaApplication`, once an hour, optional: it needs the
// `status/query` permission), the hosts and the services that are not OK
// (`objects/hosts`, `objects/services` with `attrs` and a `filter`).
// Acknowledgements are POSTs to `actions/acknowledge-problem`, one for the
// host and one for its services.
//
// Errors are thrown as IcingaError with a `kind` (ERROR_KINDS): the hub and
// the texts know what to tell the user from it.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer, timeout, 502/503/504
  TLS: 'tls', // the certificate does not verify (Icinga's own CA without the option)
  AUTH: 'auth', // user or password refused (401)
  CREDENTIALS_MISSING: 'credentials_missing', // no user or password in the configuration
  NOT_ICINGA: 'not_icinga', // something answers, but not the REST API of Icinga 2
  HTTPS_REQUIRED: 'https_required', // http:// on the API port: Icinga only speaks TLS
  NO_HOSTS: 'no_hosts', // no host visible: the API user lacks objects/query/Host
  PERMISSION: 'permission', // 403: a permission of the API user is missing
  API: 'api', // the API refused a request (parameters)
  HTTP: 'http', // anything else
});

export class IcingaError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message for the logs (never a secret)
   * @param {object} [extra] e.g. { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'IcingaError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// Attributes read on every cycle.
export const HOST_ATTRS = [
  'name',
  'display_name',
  'state',
  'state_type',
  'acknowledgement',
  'downtime_depth',
  'last_check',
  'last_state_change',
  'last_reachable',
  'groups',
];
export const SERVICE_ATTRS = [
  'host_name',
  'name',
  'display_name',
  'state',
  'state_type',
  'acknowledgement',
  'downtime_depth',
  'last_check',
  'last_state_change',
  'last_check_result',
];
// Only the services that are not OK: on a real setup, most services are.
export const SERVICE_FILTER = 'service.state != 0';

/**
 * Whether a host is in the scope of the configuration: in one of the host
 * groups (all hosts when none is set). Names compare without case.
 */
export function inScope(host, { groups = [] } = {}) {
  if (groups.length === 0) {
    return true;
  }
  const wanted = new Set(groups.map((group) => group.toLowerCase()));
  return host.groups.some((group) => wanted.has(group.toLowerCase()));
}

// The first line of a check output (the rest is the long output).
const firstLine = (text) => String(text ?? '').split('\n')[0];

export class IcingaClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL of the REST API (…/v1)
   * @param {string} [options.username] API user
   * @param {string} [options.password] its password
   * @param {boolean} [options.insecure] accept a certificate that does not verify
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({
    url,
    username = '',
    password = '',
    insecure = false,
    request = httpRequest,
    timeoutMs = 15_000,
  }) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.info = null;
  }

  /** Forget the version: read again before the next request (Icinga upgraded). */
  reset() {
    this.info = null;
  }

  /**
   * One request to the REST API.
   * @param {string} path after the API base, e.g. `/objects/hosts`
   * @param {{ method?: string, params?: Array<[string, string]>, body?: object }} [options]
   * @returns {Promise<object>} the parsed answer
   * @throws {IcingaError}
   */
  async call(path, { method = 'GET', params = [], body } = {}) {
    if (!this.username || !this.password) {
      throw new IcingaError(ERROR_KINDS.CREDENTIALS_MISSING, 'No user or password configured');
    }
    // Not URLSearchParams: it writes a space as `+`, which Icinga does not
    // decode (`service.state+!=+0` matches nothing: 404 "No objects found").
    const query = params
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    const headers = {
      authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`,
      // Icinga refuses a POST without it.
      accept: 'application/json',
    };
    if (body) {
      headers['content-type'] = 'application/json';
    }
    let response;
    try {
      response = await this.request(`${this.url}${path}${query ? `?${query}` : ''}`, {
        method,
        body: body ? JSON.stringify(body) : '',
        headers,
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new IcingaError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      // Plain HTTP on the TLS port: Icinga closes the connection.
      if (
        this.url.startsWith('http:') &&
        (err.code === 'ECONNRESET' || String(err.code).startsWith('HPE_'))
      ) {
        throw new IcingaError(ERROR_KINDS.HTTPS_REQUIRED, `${err.code} on http://`);
      }
      if (!err.code) {
        // The server answers, but not as expected (an answer too large…).
        throw new IcingaError(ERROR_KINDS.HTTP, err.message);
      }
      throw new IcingaError(ERROR_KINDS.UNREACHABLE, `${err.code}`);
    }

    const { status } = response;
    if ([502, 503, 504].includes(status)) {
      // A reverse proxy in front of a stopped Icinga.
      throw new IcingaError(ERROR_KINDS.UNREACHABLE, `HTTP ${status}`, { status });
    }
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || !('results' in parsed || 'error' in parsed)) {
      throw new IcingaError(
        status === 200 || status === 404 || (status >= 300 && status < 400)
          ? ERROR_KINDS.NOT_ICINGA
          : ERROR_KINDS.HTTP,
        `Not an Icinga 2 API answer (HTTP ${status})`,
        { status },
      );
    }
    const detail = typeof parsed.status === 'string' ? parsed.status : '';
    if (status === 401) {
      throw new IcingaError(ERROR_KINDS.AUTH, `Refused (HTTP 401)`, { status });
    }
    if (status === 403) {
      // "Missing permission: actions/acknowledge-problem"
      throw new IcingaError(ERROR_KINDS.PERMISSION, `${method} ${path}: ${detail} (HTTP 403)`, {
        status,
        detail,
      });
    }
    // An action answers one result per object, each with its own code: a
    // 409 overall ("already acknowledged") still carries them.
    if (Array.isArray(parsed.results)) {
      return parsed;
    }
    if (status === 404 && /no objects found/i.test(detail)) {
      return { results: [] };
    }
    throw new IcingaError(ERROR_KINDS.API, `${method} ${path}: ${detail} (HTTP ${status})`, {
      status,
    });
  }

  /**
   * Read the version once (again after reset()). Without the `status/query`
   * permission, the version stays unknown: not an error.
   */
  async detect() {
    if (this.info) {
      return this.info;
    }
    let version = '';
    try {
      const answer = await this.call('/status/IcingaApplication');
      const app = answer.results?.[0]?.status?.icingaapplication?.app;
      version = typeof app?.version === 'string' ? app.version.replace(/^v/, '') : '';
    } catch (err) {
      if (err.kind !== ERROR_KINDS.PERMISSION) {
        throw err;
      }
    }
    this.info = { version };
    return this.info;
  }

  /** The `attrs` of every object of a type. */
  async objects(type, attrs, filter) {
    const params = attrs.map((attr) => ['attrs', attr]);
    if (filter) {
      params.push(['filter', filter]);
    }
    const answer = await this.call(`/objects/${type}`, { params });
    return answer.results.map((row) => row?.attrs ?? {});
  }

  /**
   * Everything one cycle needs, in the scope of the configuration.
   * @param {{ groups?: string[] }} [scope]
   * @returns {Promise<{ version: string, hosts: object[], services: object[], total: number }>}
   * @throws {IcingaError}
   */
  async snapshot(scope = {}) {
    const info = await this.detect();
    const rawHosts = await this.objects('hosts', HOST_ATTRS);
    const all = rawHosts
      .filter((host) => typeof host.name === 'string' && host.name)
      .map((host) => ({
        name: host.name,
        alias:
          typeof host.display_name === 'string' && host.display_name
            ? host.display_name
            : host.name,
        // 0 UP, 1 DOWN, 2 UNREACHABLE (a DOWN host behind a parent that is
        // down); null until checked once (PENDING: Icinga says DOWN, last_check -1).
        state: !(Number(host.last_check) > 0)
          ? null
          : Number(host.state) === 0
            ? 0
            : host.last_reachable === false
              ? 2
              : 1,
        acknowledged: Number(host.acknowledgement) > 0,
        downtime: Number(host.downtime_depth) > 0,
        since: Number(host.last_state_change) || 0,
        // SOFT (0) while Icinga retries before alerting; HARD (1) once confirmed.
        hard: Number(host.state_type) !== 0,
        groups: Array.isArray(host.groups) ? host.groups.filter((g) => typeof g === 'string') : [],
      }));
    // A user restricted by a permission filter to nothing: taken as is,
    // every problem would end, then start again once the filter is fixed.
    if (all.length === 0) {
      throw new IcingaError(ERROR_KINDS.NO_HOSTS, 'No host visible to the API user');
    }
    const hosts = all.filter((host) => inScope(host, scope));
    const byName = new Map(hosts.map((host) => [host.name, host]));

    const rawServices = await this.objects('services', SERVICE_ATTRS, SERVICE_FILTER);
    const services = rawServices
      .filter(
        (service) =>
          byName.has(service.host_name) &&
          Number(service.state) > 0 &&
          // PENDING: Icinga says UNKNOWN before the first check.
          Number(service.last_check) > 0,
      )
      .map((service) => ({
        host: service.host_name,
        // The object name: what the API filters on.
        name: String(service.name ?? ''),
        service:
          typeof service.display_name === 'string' && service.display_name
            ? service.display_name
            : String(service.name ?? ''),
        // 1 WARNING, 2 CRITICAL, 3 UNKNOWN.
        state: Math.min(3, Number(service.state)),
        acknowledged: Number(service.acknowledgement) > 0,
        // A downtime of the service or of its host: Icinga does not notify.
        downtime: Number(service.downtime_depth) > 0 || byName.get(service.host_name).downtime,
        since: Number(service.last_state_change) || 0,
        hard: Number(service.state_type) !== 0,
        output: firstLine(service.last_check_result?.output),
      }));
    return { ...info, hosts, services, total: all.length };
  }

  /**
   * Acknowledge objects (sticky: until they are OK again, no notification).
   * @returns {Promise<number>} the objects acknowledged (a 409 result,
   *   "already acknowledged" or "is UP", counts for nothing)
   */
  async acknowledge(type, filter, filterVars, comment) {
    const answer = await this.call('/actions/acknowledge-problem', {
      method: 'POST',
      body: {
        type,
        filter,
        filter_vars: filterVars,
        author: 'Gladys',
        comment,
        sticky: true,
        notify: false,
      },
    });
    return answer.results.filter((result) => Number(result?.code) === 200).length;
  }

  acknowledgeHost(host, comment) {
    return this.acknowledge('Host', 'host.name == h', { h: host }, comment);
  }

  /** Acknowledge services of a host by their object names. */
  acknowledgeServices(host, names, comment) {
    return this.acknowledge(
      'Service',
      'host.name == h && service.name in names',
      { h: host, names },
      comment,
    );
  }
}
