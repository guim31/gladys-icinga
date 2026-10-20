# Icinga

Bring your [Icinga 2](https://icinga.com/) monitoring into Gladys: each host
becomes a device (up, services WARNING, CRITICAL and UNKNOWN, unhandled
problems, acknowledged, downtime), an "Icinga" device sums up the whole
setup, and your scenes react when a host goes down or a service fails — a red
light when the NAS is down, a message when a backup is CRITICAL. A scene can
also acknowledge the problems of a host, and a dashboard widget lists the
problems in progress.

The integration reads the REST API of Icinga 2 (port 5665) on your local
network, with an API user. Nothing goes through a cloud.

Tested against a real Icinga 2.16 (official `icinga/icinga2` Docker image,
dummy checks forced to WARNING, CRITICAL and UNKNOWN, a host DOWN, a host
UNREACHABLE behind it, a downtime, an acknowledgement, a host never checked).
Feedback welcome:
[github.com/guim31/gladys-icinga/issues](https://github.com/guim31/gladys-icinga/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- Icinga 2 with its REST API enabled (`icinga2 api setup`, done by most
  installations and by the official Docker image), reachable from the Gladys
  machine on port 5665. Icinga Web and Icinga DB are not needed.
- An API user for Gladys (an `ApiUser` object), with only the permissions it
  needs.

## Getting started

### 1. Create an API user

On the Icinga 2 server, add to `/etc/icinga2/conf.d/api-users.conf` (or any
configuration file):

```
object ApiUser "gladys" {
  password = "a-long-random-password"
  permissions = [
    "objects/query/Host",
    "objects/query/Service",
    "status/query",
    "actions/acknowledge-problem",
  ]
}
```

`status/query` only gives the version shown by "Test the connection": it can
be left out. Leave out `actions/acknowledge-problem` if Gladys must never
acknowledge. Then check and reload: `icinga2 daemon -C` and
`systemctl reload icinga2`. Do not use the `root` user of `icinga2 api setup`:
it may do everything.

### 2. Configure the integration

In Gladys, open the configuration of the integration:

- **Address**: the address of the Icinga 2 server, e.g. `192.168.1.2`.
  `https://` and port 5665 are added unless you type others (e.g.
  `https://monitoring.example.com:443/icinga-api` behind a reverse proxy).
- **API user** and **Password**: the user of step 1.
- **Host groups (optional)**: names of host groups separated by commas, e.g.
  `homelab, linux-servers`: a host in one of them is kept. Empty: every host
  the API user can see.
- **Refresh interval**: 30 seconds to 5 minutes (1 minute by default).
- **Allow acknowledging from scenes**: untick to turn the acknowledgement
  action off.
- **Accept self-signed certificates**: Icinga signs its API certificate with
  its own certificate authority, so this is ticked by default. Untick it only
  if your certificate is trusted (a reverse proxy with a public certificate).
- **Language of the names**: language of the feature names and of the scene
  results.

Save, then click **Test the connection**: it shows the Icinga version, the
number of hosts, of hosts down and of services in problem.

### 3. Add the devices

Open the **Discover** tab of the integration and add the hosts to follow, and
the "Icinga" device if you want the totals. The scene triggers work for every
host, added to Gladys or not.

## The devices

Each **host** (named after its display name in Icinga):

| Feature            | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| Host up            | 1 UP, 0 DOWN or UNREACHABLE; empty while the host is PENDING         |
| Services WARNING   | number of services WARNING                                           |
| Services CRITICAL  | number of services CRITICAL                                          |
| Services UNKNOWN   | number of services UNKNOWN                                           |
| Unhandled problems | host and service problems neither acknowledged nor in a downtime     |
| Host acknowledged  | 1 while the host is DOWN or UNREACHABLE and its problem acknowledged |
| In downtime        | 1 while the host is in a scheduled downtime                          |

The **Icinga** device: Hosts down (DOWN or UNREACHABLE), Services WARNING,
Services CRITICAL, Services UNKNOWN and Unhandled problems, over the hosts of
the configuration.

A host is UNREACHABLE when it is DOWN and Icinga knows, through a dependency,
that its parent is down too. The service counts include the states Icinga is
still confirming (SOFT), as Icinga Web shows them. Values are sent to Gladys
only when they change, and every 6 hours otherwise.

## Dashboard

The **Icinga problems** widget shows three tiles — the hosts down, the
services CRITICAL, the unhandled problems — and the problems: hosts DOWN, then
UNREACHABLE, then services CRITICAL, UNKNOWN and WARNING, the newest first.
Each row gives the service and its state, the host, ✓ once acknowledged and ⏸
in a downtime. Ten rows at most. **Refresh** reads Icinga again. In its
settings, choose hosts to show only theirs (empty: every host).

## Scenes

### Triggers

- **A host goes down**: a host goes DOWN or UNREACHABLE. Filter: hosts
  (empty: any). Variables: host name, state (DOWN, UNREACHABLE). A host going
  from DOWN to UNREACHABLE is not announced twice.
- **A host is back up**: a host announced down is UP again. Variables: host
  name, duration in minutes.
- **A service has a problem**: a service enters WARNING, CRITICAL or UNKNOWN,
  or changes between them (WARNING to CRITICAL, for example). Filters: hosts,
  states (empty: any; for "CRITICAL only", choose CRITICAL). Variables: host
  name, service, state, check output (its first line).
- **A service is OK again**: a service announced in problem is OK again.
  Filters: hosts, the last problem state announced. Variables: host name,
  service, last problem state, duration in minutes.
- **Icinga no longer answers**: the REST API fails to answer twice in a row
  (variables: address, error).

The problems already there when the integration starts are not announced,
but their end is. Only confirmed (HARD) states count: while Icinga retries a
check (SOFT state, up to `max_check_attempts`), nothing is announced, as
Icinga does not notify either. A change that happens while Gladys or the
integration restarts is announced once at the next read. A problem in a
downtime (of the service or of its host) is not announced; one that is still
there when the downtime ends is announced then.

### Actions

- **Acknowledge the problems of a host**: acknowledges in Icinga the host
  problem (DOWN, UNREACHABLE) and each of its services in problem not
  acknowledged yet, with a comment (empty: "Acknowledged from Gladys") and the
  author "Gladys". The acknowledgement is sticky (until the host is UP or the
  service OK) and sends no notification. Returns the number acknowledged. Turn
  it off with "Allow acknowledging from scenes".
- **Read the problems**: counts and lists the problems of one host, or of all,
  for the next actions: number, unhandled, hosts down, services CRITICAL,
  WARNING and UNKNOWN, and the list "host: problem".

### Scene ideas

- **A red light when the NAS is down**: trigger "A host goes down", host NAS →
  turn the living-room lamp red and send
  `{{triggerEvent.data.host}}: {{triggerEvent.data.state_name}}`.
- **Critical services only**: trigger "A service has a problem", state
  CRITICAL → message `{{triggerEvent.data.host}} / {{triggerEvent.data.service}}:
{{triggerEvent.data.output}}`.
- **Morning report**: every day at 8:00, "Read the problems" → send the count
  and the list when the count is above 0.
- **Seen from the couch**: a dashboard button or a Zigbee remote runs
  "Acknowledge the problems of a host" on the NAS.

## Troubleshooting

- **"API user or password refused"**: check the `ApiUser` object, and that
  Icinga was reloaded after adding it.
- **"Icinga does not answer"**: check the address and port 5665 from the
  Gladys machine (a firewall often closes it). `localhost` is the integration
  container itself: use the IP address of the Icinga machine.
- **"No Icinga 2 API at this address"**: something else answers there (Icinga
  Web on port 80 or 443, for example): use port 5665.
- **"The Icinga API only speaks HTTPS"**: type `https://`, or nothing before
  the address.
- **"Permission missing for the API user"** or **"no host visible"**: add the
  permissions of step 1 to the `ApiUser` object, then reload Icinga. A
  permission with a `filter` can hide every host too.
- **"Certificate refused"**: tick "Accept self-signed certificates".
- **A host is missing**: it is in none of the host groups of the
  configuration.
- **The acknowledgement is refused**: the API user needs the permission
  `actions/acknowledge-problem`.

## Limits

- One Icinga 2 instance per integration (with a cluster, the address of a
  master: it sees every host of its zones).
- Host states and service states only: no metrics, no performance data.
- The integration reads Icinga at the chosen interval: an event that comes and
  goes between two reads is missed. The `/v1/events` stream is not used.
- "A service is OK again" also fires when a service in problem is removed from
  monitoring; a host removed from Icinga or from the scope ends quietly.
- At most 30 scene events per read: a network outage can raise dozens at once;
  the rest follows at the next reads.
- No quota on the REST API: each read sends two requests (three once an hour,
  for the version).

Not affiliated with the Icinga project nor with Icinga GmbH.
