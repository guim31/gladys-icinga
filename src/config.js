// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Icinga 2 instance, through its REST API: always HTTPS, port 5665 by
// default. The address can be typed with or without scheme and port, or
// copied from an API URL (`https://192.0.2.5:5665/v1/objects/hosts`).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  icinga_url: '',
  username: '',
  password: '',
  host_groups: '',
  poll_interval: '60',
  allow_acknowledge: true,
  allow_self_signed: true,
  language: 'fr',
};

export const MAX_GROUPS = 20;

export const DEFAULT_PORT = '5665';
const API_PATH = '/v1';

/**
 * Parse the address typed by the user into the base URL of the REST API:
 * `192.0.2.5`, `icinga.lan:5665`, `https://192.0.2.5:5665/v1/…`, or a
 * reverse proxy path. HTTPS and port 5665 unless typed.
 * @param {unknown} raw
 * @returns {string|null} `https://host:port[/prefix]/v1`, null when unusable
 */
export function parseApiUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  // URL drops a default port (443): read the typed authority instead.
  const authority = (withScheme.split('/')[2] ?? '').split(/[?#]/)[0];
  if (!/:\d+$/.test(authority)) {
    url.port = DEFAULT_PORT;
  }
  // Everything before /v1 is the prefix of a reverse proxy.
  const at = url.pathname.search(/\/v1(\/|$)/);
  const prefix = (at >= 0 ? url.pathname.slice(0, at) : url.pathname).replace(/\/+$/, '');
  return `${url.origin}${prefix}${API_PATH}`;
}

/** The address shown to the user: host and port, without scheme nor API path. */
export const addressOf = (apiUrl) =>
  apiUrl.replace(/^https?:\/\//, '').replace(new RegExp(`${API_PATH}$`), '');

/** Host group names, separated by commas, `;` or new lines. */
export function parseGroups(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const seen = new Set();
  const groups = [];
  for (const entry of raw.split(/[\n,;]/)) {
    const name = entry.trim();
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      groups.push(name);
    }
  }
  return groups.slice(0, MAX_GROUPS);
}

const isTrue = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const typed = text('icinga_url');
  const apiUrl = parseApiUrl(typed);
  return {
    apiUrl,
    invalidUrl: Boolean(typed) && !apiUrl,
    username: text('username'),
    // A pasted password often carries a trailing space or new line.
    password: text('password'),
    groups: parseGroups(source.host_groups),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    allowAcknowledge:
      source.allow_acknowledge === undefined || source.allow_acknowledge === null
        ? DEFAULT_CONFIG.allow_acknowledge
        : isTrue(source.allow_acknowledge),
    // Icinga signs its API certificate with its own CA: on by default.
    allowSelfSigned:
      source.allow_self_signed === undefined || source.allow_self_signed === null
        ? DEFAULT_CONFIG.allow_self_signed
        : isTrue(source.allow_self_signed),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
