# gentle-shell-minimax-usage

[Leer en español](README.es.md)

Shows your MiniMax Token Plan quota inside Gentle Shell for Pi, and your local
MiniMax consumption inside Pi itself. It registers a `gentle-pi:usage-source/v1`
source for the `minimax` provider and returns data only; Gentle Shell draws the
meters, thresholds and countdowns.

## Install

```sh
pi install npm:gentle-shell-minimax-usage
```

That is all. Install **without a version**: Pi follows the `latest` tag and
tells you when there is a new release (`pi list` shows your packages,
`pi update --extensions` installs the pending ones). To pin a version on
purpose, add `@<version>`; Pi never announces updates for a pinned package.

No Gentle Shell? It still works: see [Without Gentle Shell](#without-gentle-shell).
Coming from 0.4.0, or installing by hand: see [More install options](#more-install-options).

## What you get

With a `minimax/*` model active, Alt+U (and the sidebar Usage group) shows two
`general` rows:

- `5h`: percent used in the current 5-hour window and when it resets.
- `week`: percent used in the current weekly window and when it resets.

The footer bar shows only the `5h` window: each window is its own limit, and the
footer draws the first one.

The data comes from `GET https://api.minimax.io/v1/token_plan/remains`, with the
legacy Coding Plan path as a fallback. Gentle Shell supplies the API key, so
this extension never reads credentials in that mode.

## Commands

Two commands work in any Pi, with or without Gentle Shell. Both open in a
floating window over the transcript, except `/minimax:details`, which takes the
whole interactive area.

### `/minimax:usage`

The quota panel, the same one Gentle Shell draws: the `5h` and weekly windows
with their meters, the percentage used and the countdown to the reset.
`r` fetches again, `esc` (or `q`) closes it.

Without a plan (a pay-as-you-go API key has no M Plan windows) the panel says
so instead of drawing a 0% meter, and points at `/minimax:details`.

### `/minimax:details`

Your consumption, full screen, in three tabs:

- `Overview`: the headline numbers (LLM, cache hit, daily average, cost), what
  was spent per model and the cumulative totals.
- `Trend`: the daily column chart, stacked by model, with the model legend.
- `Heatmap`: the weekday × week heatmap over the whole local history, with its
  color scale and the `poco ░▒▓█ mucho` weight scale.

`Tab` / `Shift+Tab` change the tab, `1` to `3` jump straight to one, `↑`/`↓`
(or `j`/`k`) scroll, `r` reads the history again and `esc` closes it.

The numbers come from the **local Pi session history**, not from the MiniMax
account: the extension reads `<agent-dir>/sessions/**/*.jsonl` and sums the
numeric usage of the `minimax` assistant messages. The read is read-only, needs
no credential or network call, and never touches the message content. So the
view shows what Pi did on this machine; the MiniMax console adds your other
machines and tools.

Set `MINIMAX_DETAILS=off` to turn the ledger off: the command then reads
nothing and says so.

## Without Gentle Shell

The meter also works on Pi's own status line. Set `MINIMAX_USAGE_MODE` to pick
the behavior:

| `MINIMAX_USAGE_MODE` | Registers the shell source | Writes the Pi status                   |
| -------------------- | -------------------------- | -------------------------------------- |
| `auto` (default)     | yes                        | only when no Gentle Shell was detected |
| `status`             | yes                        | always (force the segment)             |
| `shell`              | yes                        | never                                  |
| `off`                | no                         | no                                     |

`off` turns the extension off entirely: no source, no status and no commands.

With the status surface active, Pi's footer shows a `minimax-usage` segment:

```
MM 5h 55% · week 6%
```

A missing key shows `MM: sin API key`; a fetch without data shows `MM: sin datos`.
The status refreshes on session start and whenever the agent settles, with its
own 10-second timeout. When the npm registry has a newer version, the segment
adds `· new 0.6.0`; the check runs once an hour and never blocks the status.

The standalone path resolves the API key in this order:

1. `MINIMAX_API_KEY` from the environment.
2. `minimax.key` inside `~/.pi/agent/auth.json` (or `$PI_CODING_AGENT_DIR/auth.json`).

The `auth.json` read is strictly read-only: the extension never writes it and
never logs the key.

Shell detection is a heuristic: it probes for the installed `gentle-pi` package
(under `$PI_CODING_AGENT_DIR` or `~/.pi/agent`, `$PI_PACKAGE_DIR`, or
`~/.pi/npm`), and an installed package does not guarantee a running shell.
`MINIMAX_USAGE_MODE` is the escape hatch.

## More install options

### Coming from 0.4.0

The pinned command of the old README leaves you on 0.4.0 with no update notice.
Unpin it:

```sh
pi remove npm:gentle-shell-minimax-usage
pi install npm:gentle-shell-minimax-usage
```

### Manual install (no registry)

Build the tarball and unpack it into a Pi extension subdirectory:

```sh
npm pack
mkdir -p ~/.pi/agent/extensions/minimax-usage
tar -xzf gentle-shell-minimax-usage-<version>.tgz -C ~/.pi/agent/extensions/minimax-usage --strip-components=1
```

Pi loads one-level subdirectories of `~/.pi/agent/extensions/` that have a
`package.json` with a `pi.extensions` manifest. Restart Pi after unpacking.
Do not keep this copy once the npm package is installed: two extensions would
register the same provider.

## Development

```sh
npm install
npm test
npm run typecheck
npm run preview
```

Tests run on Node 24 with `--experimental-strip-types` and need no network.
`npm run preview` paints both views as plain text, without a terminal: the
consumption view from the local session history and the quota panel from the
live endpoint. It is the fastest way to see what the commands will show.

## Known limits

- The meter appears only while a `minimax/*` model is active.
- The endpoint does not report the plan tier, so no plan name is shown.
- The M Plan has no monthly quota: it has a 5-hour window and a weekly window.
  The monthly numbers of the MiniMax console are consumption, not a limit.
- `/minimax:details` counts the local Pi history, so it does not match the
  account-wide numbers of the MiniMax console.
- The cache hit rate is ours (`cacheRead / (input + cacheRead + cacheWrite)`),
  not MiniMax's own accounting.
- The version notice lives in the installed code: a pinned package keeps the
  code it was installed with and never learns about a new release.
