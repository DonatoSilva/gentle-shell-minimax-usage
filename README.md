# gentle-shell-minimax-usage

Shows your MiniMax Token Plan quota inside Gentle Shell for Pi, and your local
MiniMax consumption inside Pi itself. It registers a `gentle-pi:usage-source/v1`
source for the `minimax` provider and returns data only; Gentle Shell draws the
meters, thresholds and countdowns.

## What you get

With a `minimax/*` model active, Alt+U (and the sidebar Usage group) shows two
`general` rows:

- `5h`: percent used in the current 5-hour window and when it resets.
- `week`: percent used in the current weekly window and when it resets.

The footer bar shows only the `5h` window: each window is its own limit, and the
footer draws the first one.

The data comes from `GET https://api.minimax.io/v1/token_plan/remains`, with the
legacy Coding Plan path as a fallback. Gentle Shell supplies the API key, so
this extension never reads credentials. Without the shell the standalone path
falls back to `MINIMAX_API_KEY` or `~/.pi/agent/auth.json`, read-only — see
[Without Gentle Shell](#without-gentle-shell).

## Commands

Two commands work in any Pi, with or without Gentle Shell.

### `/minimax:usage`

Opens the quota panel, the same one Gentle Shell draws: the `5h` and weekly
windows with their meters, the percentage used and the countdown to the reset.
`r` fetches again, `esc` (or `q`) closes it.

Without a plan (a pay-as-you-go API key has no M Plan windows) the panel says
so instead of drawing a 0% meter, and points at `/minimax:details`.

### `/minimax:details`

Opens the consumption view: the tokens of the last 30 days, the cache hit rate,
the daily average, the cost, the daily trend, the weekday × week heatmap and
the cumulative totals. `r` reads the local history again, `esc` (or `q`) closes
it.

The numbers come from the **local Pi session history**, not from the MiniMax
account: the extension reads `<agent-dir>/sessions/**/*.jsonl` and sums the
numeric usage of the `minimax` assistant messages. The read is read-only, no
credential and no network call are involved, and the message content is never
read or rendered.

Because it is local, the view shows what Pi did on this machine. The MiniMax
console adds the other machines and the other tools of the account.

Set `MINIMAX_DETAILS=off` to turn the ledger off: the command then reads
nothing and says so.

## Without Gentle Shell

The meter also works when Gentle Shell is not running, directly on Pi's own
status line. Set `MINIMAX_USAGE_MODE` to pick the behavior:

| `MINIMAX_USAGE_MODE` | Registers the shell source | Writes the Pi status                   |
| -------------------- | -------------------------- | -------------------------------------- |
| `auto` (default)     | yes                        | only when no Gentle Shell was detected |
| `status`             | yes                        | always (force the segment)             |
| `shell`              | yes                        | never                                  |
| `off`                | no                         | no                                     |

With the status surface active, Pi's footer shows a `minimax-usage` segment
like:

```
MM 5h 55% · week 6%
```

Missing key shows `MM: sin API key`; a fetch without data shows `MM: sin datos`.
The status refreshes on session start and whenever the agent settles, with its
own 10-second timeout.

`MINIMAX_USAGE_MODE=off` turns the extension off entirely: no source, no status
and no commands.

The standalone path resolves the API key in this order:

1. `MINIMAX_API_KEY` from the environment.
2. `minimax.key` inside `~/.pi/agent/auth.json` (or `$PI_CODING_AGENT_DIR/auth.json`).

The `auth.json` read is strictly read-only: the extension never writes it and
never logs the key.

Note that shell detection is a heuristic: it probes for the installed
`gentle-pi` package (under `$PI_CODING_AGENT_DIR` or `~/.pi/agent`, `$PI_PACKAGE_DIR`,
or `~/.pi/npm`), and an installed package does not guarantee a running shell.
The env var is the escape hatch — that is exactly why the switch exists.

## Install

```sh
pi install npm:gentle-shell-minimax-usage@0.5.0
```

Pin the version, or drop the `@0.5.0` to follow the latest release. `pi list`
shows the configured packages, and `pi update gentle-shell-minimax-usage` moves
to the next version. Pi keeps the package under its own npm directory, so there
is no copy step and no path to maintain.

If Gentle Shell is not installed, the extension still works: see
[Without Gentle Shell](#without-gentle-shell).

### Manual install (no registry)

Build the tarball and unpack it into a Pi extension subdirectory:

```sh
npm pack
mkdir -p ~/.pi/agent/extensions/minimax-usage
tar -xzf gentle-shell-minimax-usage-0.5.0.tgz -C ~/.pi/agent/extensions/minimax-usage --strip-components=1
```

Pi loads one-level subdirectories of `~/.pi/agent/extensions/` that have a
`package.json` with a `pi.extensions` manifest. Restart Pi after unpacking.
Do not keep this copy once the npm package is installed: two extensions would
register the same provider.

## Test

```sh
npm install
npm test
npm run typecheck
npm run preview
```

Tests run on Node 24 with `--experimental-strip-types` and need no network.

`npm run preview` paints both views as plain text, without a terminal: the
consumption view from the local session history and the quota panel from the
live endpoint (or from the state your key actually returns). It is the fastest
way to see what the commands will show.

## Known limits

- The meter appears only while a `minimax/*` model is active.
- The endpoint does not report the plan tier, so no plan name is shown.
- The M Plan has no monthly quota: it has a 5-hour window and a weekly window.
  The monthly numbers of the MiniMax console are consumption, not a limit.
- `/minimax:details` counts the local Pi history, so it does not match the
  account-wide numbers of the MiniMax console.
- The cache hit rate is ours (`cacheRead / (input + cacheRead + cacheWrite)`),
  not MiniMax's own accounting.
