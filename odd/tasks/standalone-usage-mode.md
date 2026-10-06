# Standalone usage mode (switch manual sin gentle-shell)

## Objective

Keep the `minimax` meter working when Gentle Shell is not there. Today the extension
emits `gentle-pi:usage-source/v1` and nothing else: with no shell listening, the event
is a no-op and the user sees nothing. Add an automatic fallback surface on Pi's own
status line, controlled by a manual switch.

## Problem

The shell is the only consumer of the usage source, and it is also the only thing that
resolves the API key (`getApiKeyForProvider`). Without it: no meter, and no key.

## Decision (user-approved, option A)

- **Auto-detection**: probe for the `gentle-pi` package; absent means "no shell".
- **Manual switch**: env var `MINIMAX_USAGE_MODE` with four values.
- **Standalone surface**: `ctx.ui.setStatus("minimax-usage", ...)` in Pi's own footer.

| `MINIMAX_USAGE_MODE` | Registers the shell source | Writes the Pi status |
| --- | --- | --- |
| `auto` (default) | yes | only when no Gentle Shell was detected |
| `status` | yes | always (force the segment) |
| `shell` | yes | never |
| `off` | no | no |

Detection is a heuristic (package installed ≠ shell running); the env var is the
escape hatch, which is exactly why the switch exists.

## Scope

- In: mode parsing and detection, standalone status formatting, key resolution
  (env first, then `auth.json`), extension wiring, tests, README, version bump.
- Out: UI panels or widgets beyond `setStatus`, retries/backoff, a config file,
  touching `~/.pi/agent/auth.json` in any way other than reading it.

## Constraints

- No imports from `gentle-pi`; literal channel and schema strings stay as they are.
- The standalone path may **read** `~/.pi/agent/auth.json` (plain JSON,
  `minimax.key`) but never writes it, never logs the key, and `MINIMAX_API_KEY`
  wins over the file.
- The shell keeps supplying the key in shell mode; the standalone path only runs
  when the status surface is active.
- The shell applies its own 10 s abort; standalone must bound itself with its own
  timeout, or a hung request leaks a pending status.
- No status writes in `print`/headless modes.
- Tests: `node --experimental-strip-types --test tests/*.test.ts` (Node 24), no network.

## Acceptance criteria

- `parseUsageMode`: exact match on the four values after trim+lowercase; anything
  else, including `undefined`, resolves to `auto`.
- `detectGentleShell`: true when a `gentle-pi/package.json` probe path exists, under
  `PI_CODING_AGENT_DIR` (default `~/.pi/agent`), `PI_PACKAGE_DIR`, or `~/.pi/npm`; the
  probe never throws.
- `decideSurface` matches the table above for all eight combinations.
- `formatUsageStatus` renders `MM 5h 45% · week 6%` from a parsed snapshot, and
  returns `undefined` for a snapshot without windows.
- `resolveApiKey`: non-empty `MINIMAX_API_KEY` wins; otherwise `auth.json` →
  `minimax.key`; a missing, unreadable, malformed or key-less file yields `undefined`
  instead of throwing.
- Extension: `off` emits nothing; `status` writes the status on `session_start` and
  on `agent_settled`; missing key writes `MM: sin API key`; no data writes
  `MM: sin datos`; `print` mode writes nothing; a throwing fetch never escapes.
- `npm test` green and `npm run typecheck` exit 0.

## Delivery strategy

`exception-ok`: no pull request. Delivery is a local install copy at
`~/.pi/agent/extensions/minimax-usage/` (v0.0.3).

## Tasks

- [x] T1 `lib/usage-mode.ts` + `tests/usage-mode.test.ts` (test-first). Route: delegated writer (`gentle-ai-worker`).
- [x] T2 `lib/standalone-status.ts` + `tests/standalone-status.test.ts` (test-first). Route: delegated writer.
- [x] T3 Wire the extension + extend `tests/minimax-usage-source.test.ts` (test-first). Route: same writer, after T1/T2.
- [x] T4 `README.md` (standalone mode + switch + credential note) and `package.json` 0.0.3. Route: same writer.
- [x] T5 Copy to `~/.pi/agent/extensions/minimax-usage/`. Route: inline (mechanical copy).

## Applicable checks

- `npm test`, `npm run typecheck`.
- Manual: `MINIMAX_USAGE_MODE=status pi` without Gentle Shell → footer shows
  `MM 5h …% · week …%`; `MINIMAX_USAGE_MODE=off pi` → nothing anywhere.

## Progress

- Feature authorized by the user (option A chosen over a command-only switch and a config file).
- ODD doc created before the first source write; last commit on the branch `8415122`.
- T1–T4 done by one delegated writer. RED observed: `npm test` exit 1, 16 pass / 3 fail with
  `ERR_MODULE_NOT_FOUND` for `lib/usage-mode.ts` and `lib/standalone-status.ts`. GREEN: 48 pass /
  0 fail, exit 0. Two real defects were caught mid-green and fixed: the `PI_PACKAGE_DIR` probe
  carried a wrong `npm/` segment, and the refresh handler bound the event string to its first
  parameter so `ctx` was dropped and every status write silently no-op'd.
- Parent verification (not the writer's summary): `npm test` 48/48 exit 0, `npm run typecheck` exit 0.
- T5 done: copied `package.json`, `README.md`, `extensions/`, `lib/` to
  `~/.pi/agent/extensions/minimax-usage/` (v0.0.3) and smoke-tested the installed copy, not the
  source: 8/8 scenarios — `status` without a key → `MM: sin API key`; `status` with a key and a
  stubbed healthy endpoint → `MM 5h 55% · week 6%`; a rejecting fetch → `MM: sin datos`;
  `auto` with a shell detected → no status; `auto` without one → status; `shell` → no status;
  `off` → 0 emissions and no status; `print` → no status.
- Release: the standalone mode ships as `0.4.0`. The `0.0.3` bump from T4 was never published,
  and the `0.0.2` copy predates the switch, so nothing published carries a version without it.

## Pending checks

- Manual acceptance in a real Pi without Gentle Shell: `MINIMAX_USAGE_MODE=status pi` shows the
  segment in the footer; `MINIMAX_USAGE_MODE=off pi` shows nothing. Needs a Pi restart.

## Next step

Commit per task with the user's explicit approval (project rule in `AGENTS.md`), then the manual
check above.
