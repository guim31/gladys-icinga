# Icinga for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Icinga 2](https://icinga.com/): your monitored hosts and their services in
Gladys, scenes that react when a host goes down or a service fails, the
problems of a host acknowledged from a scene, and a dashboard widget of the
problems in progress.

It reads the REST API of Icinga 2 (port 5665) on your local network, with an
API user.

## Features

- **One device per host** (every host the API user sees, or the hosts of
  chosen host groups): host up, services WARNING, CRITICAL and UNKNOWN,
  unhandled problems, host acknowledged, in downtime.
- **An "Icinga" device**: the hosts down and the service problems of the
  whole setup.
- **Scene triggers**: a host goes down, a host is back up, a service has a
  problem (filter: WARNING, CRITICAL, UNKNOWN), a service is OK again, Icinga
  no longer answers. HARD states only; problems in a downtime are held, as
  Icinga holds its notifications.
- **Scene actions**: acknowledge the problems of a host (with a comment, can
  be turned off), read the problems (counts and list).
- **Widget**: the hosts down and the services in problem, the most serious
  first, with the unhandled ones.
- Feature names, messages and documentation in English, French, German and
  Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Icinga 2 with its REST API (`icinga2 api setup`), reachable on port 5665.
- An `ApiUser` with the permissions `objects/query/Host`,
  `objects/query/Service`, and optionally `status/query` (version) and
  `actions/acknowledge-problem` (acknowledgement).

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-icinga` (or
   install **Icinga** from the catalog once it is listed).
2. In **Configuration**, enter the address of the Icinga 2 server
   (`192.168.1.2`: `https://` and port 5665 are added), the API user and its
   password. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the hosts to follow.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

Every minute by default, the integration sends two GET requests to the REST
API (`https://<host>:5665/v1`): `objects/hosts` (state, state type,
acknowledgement, downtime depth, last check, reachability, groups) and
`objects/services` with the filter `service.state != 0` (the services that are
not OK), plus `status/IcingaApplication` once an hour for the version. The
states of the added devices are sent only when they change (and every 6
hours), the scene events on every HARD change, added device or not. The
problems already seen are kept in `/data`: a restart neither repeats nor
misses one. Acknowledgements are POSTs on `actions/acknowledge-problem` (one
for the host, one for its services, with `filter_vars`), sticky, without
notification, author "Gladys".

The event stream (`/v1/events`) is not used: polling at 30 s to 5 min is
enough for home monitoring, survives restarts without any replay logic, and
needs no extra permission.

## Checked on a real Icinga

On 20/10/2026, the Docker image of the integration ran with the constraints
of the Gladys sandbox (read-only rootfs, no capability, 256 MB) against
Icinga 2 v2.16.5 (official `icinga/icinga2` Docker image) with a restricted
API user: dummy checks driven by variables (WARNING, CRITICAL, UNKNOWN), a
host DOWN, a host UNREACHABLE behind it through a dependency, a host in a
downtime, a host never checked (PENDING). The answers are kept as fixtures in
[`test/fixtures/icinga`](test/fixtures/icinga).

## Limitations

- One Icinga 2 instance per integration; host and service states only (no
  metrics, no performance data).
- Polling: a problem that comes and goes between two reads is missed.
- A service in problem removed from monitoring counts as OK again.
- At most 30 scene events per read.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and an in-memory Icinga
(`test/helpers/fakeIcinga.js`) seeded with real answers. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- Started from the official
  [integration template](https://github.com/GladysAssistant/integration-template-js)
  and the [integration SDK](https://github.com/GladysAssistant/integration-sdk-js)
  of Gladys Assistant (Apache-2.0).
- The [Icinga 2 REST API documentation](https://icinga.com/docs/icinga-2/latest/doc/12-icinga2-api/)
  and the answers of a real Icinga 2.16 were the references for the API
  calls; no code is copied from another project.
- Cover: the Icinga logo (`icinga-logo-big.svg`) from
  [Icinga Web 2](https://github.com/Icinga/icingaweb2/tree/main/public/img)
  (GPL-2.0, also on
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Icinga_logo.svg)),
  a trademark of Icinga GmbH.
- Architecture shared with
  [gladys-checkmk](https://github.com/guim31/gladys-checkmk) and
  [gladys-zabbix](https://github.com/guim31/gladys-zabbix).

## Disclaimer

Not affiliated with the Icinga project nor with Icinga GmbH. Icinga is a
trademark of Icinga GmbH.

## License

[Apache-2.0](LICENSE)
