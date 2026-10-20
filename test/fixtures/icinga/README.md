# Real answers of Icinga 2

`icinga-2.16.5.json` holds answers of a real Icinga 2 v2.16.5 (official
`icinga/icinga2` Docker image, 20/10/2026), read with an API user limited to
`objects/query/Host`, `objects/query/Service`, `status/query` and
`actions/acknowledge-problem`:

- `status`: `GET /v1/status/IcingaApplication`;
- `hosts`: `GET /v1/objects/hosts` with the attributes the client reads;
- `services`: `GET /v1/objects/services` with the filter `service.state != 0`;
- `acknowledge_*`, `unauthorized`, `status_forbidden`: the answers of
  `POST /v1/actions/acknowledge-problem` and the errors, with their HTTP status.

The test setup: dummy checks driven by variables, `nas` (WARNING acknowledged,
CRITICAL, UNKNOWN), `router` (a CRITICAL still SOFT), `deadhost` (a real
`hostalive` to a documentation address: DOWN), `behindhost` (behind
`deadhost` through a dependency: UNREACHABLE), `outside` (in a downtime, with
its services) and `newhost` (never checked: PENDING). The sample host of the
image is left out. Addresses are documentation ranges; no secret.
