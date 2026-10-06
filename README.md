# gentle-shell-minimax-usage

Shows your MiniMax Token Plan quota inside Gentle Shell for Pi. It registers a
`gentle-pi:usage-source/v1` source for the `minimax` provider and returns data
only; Gentle Shell draws the meters, thresholds and countdowns.

## What you get

With a `minimax/*` model active, Alt+U (and the sidebar Usage group) shows two
`general` rows:

- `5h`: percent used in the current 5-hour window and when it resets.
- `week`: percent used in the current weekly window and when it resets.

The footer bar shows only the `5h` window: each window is its own limit, and the
footer draws the first one.

The data comes from `GET https://api.minimax.io/v1/token_plan/remains`, with the
legacy Coding Plan path as a fallback. Gentle Shell supplies the API key, so
this extension never reads credentials.

# Without Gentle Shell

The meter also works when Gentle Shell is not running, directly on Pi's own
status line. Set `MINIMAX_USAGE_MODE` to pick the behavior:

| `MINIMAX_USAGE_MODE` | Registers the shell source | Writes the Pi status |
| --- | --- | --- |
| `auto` (default) | yes | only when no Gentle Shell was detected |
| `status` | yes | always (force the segment) |
| `shell` | yes | never |
| `off` | no | no |

With the status surface active, Pi's footer shows a `minimax-usage` segment
like:

```
MM 5h 55% · week 6%
```

Missing key shows `MM: sin API key`; a fetch without data shows `MM: sin datos`.
The status refreshes on session start and whenever the agent settles, with its
own 10-second timeout.

The standalone path resolves the API key in this order:

1. `MINIMAX_API_KEY` from the environment.
2. `minimax.key` inside `~/.pi/agent/auth.json` (or `$PI_CODING_AGENT_DIR/auth.json`).

The `auth.json` read is strictly read-only: the extension never writes it and
never logs the key.

Note that shell detection is a heuristic: it probes for the installed
`gentle-pi` package (under `$PI_CODING_AGENT_DIR` or `~/.pi/agent`, `$PI_PACKAGE_DIR`,
or `~/.pi/npm`), and an installed package does not guarantee a running shell.
The env var is the escape hatch — that is exactly why the switch exists.

## Install locally

Copy the package into a Pi extension subdirectory:

```sh
mkdir -p ~/.pi/agent/extensions/minimax-usage
cp -r package.json extensions lib ~/.pi/agent/extensions/minimax-usage/
```

Pi loads one-level subdirectories of `~/.pi/agent/extensions/` that have a
`package.json` with a `pi.extensions` manifest. Restart Pi after copying.

## Test

```sh
npm install
npm test
npm run typecheck
```

Tests run on Node 24 with `--experimental-strip-types` and need no network.

## Known limits

- The meter appears only while a `minimax/*` model is active.
- The endpoint does not report the plan tier, so no plan name is shown.
