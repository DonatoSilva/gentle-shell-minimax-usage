# MiniMax usage commands (`/minimax:usage`, `/minimax:details`)

Add two Pi commands to the extension: a Gentle-Shell-style quota panel and a
console-style consumption view. Both are read-only, work without Gentle Shell,
and never touch the shell usage-source contract.

## Specs

### S1 — `/minimax:usage` paints the shell's panel inside Pi

> "un /minimax:usage que habre una pantalla pintada de pi como la que usa gentle-shell vale asi tal cual"

Acceptance:

- Registers a Pi command named `minimax:usage` (colons are allowed; Pi's own
  `skill:<name>` uses the same shape) with a description.
- Opens a full-screen view through `ctx.ui.custom()`. Only in TUI mode
  (`ctx.mode === "tui"`); other modes get a `ctx.ui.notify()` summary instead.
- Layout mirrors the Gentle Shell usage panel: framed box, a provider row
  (`minimax`, optional plan, `updated just now` / `updated Nm ago`), then one row
  per window: label, a 16-cell meter (`▰` filled / `▱` empty), the percentage
  padded to 4 columns, and `resets in X` when the window reports a reset.
- Meter tone follows the shell gauge: accent below 80%, warning from 80%, error
  from 95%; empty cells in the border role.
- Frame: `╭─ ✿ MiniMax ─…╮` … `│ r refresh   esc close │` … `╰──…╯`.
- Keys: `r` refetches, `esc` or `q` closes.
- Colors come from Pi's active theme (theme tokens), never hardcoded ANSI.
- Data comes from the existing `token_plan/remains` fetch, unchanged.

### S2 — `/minimax:details` opens the console-style consumption view

> "un /minimax:details que abre la lista que propones"

Acceptance:

- Registers a Pi command named `minimax:details`.
- Renders the MiniMax console shape: total tokens over the window, cache hit
  rate, daily average, cost, per-day bars, a weekday × week heatmap, and the
  cumulative block (total tokens, peak day, active days).
- Data comes from the local Pi session ledger (S4), filtered to
  `provider === "minimax"`.
- Needs no credentials and no network.
- With no local data it says so explicitly. It never presents zeros as usage.

### S3 — Behavior when there is no plan (pay-as-you-go)

> "ese detals solo es cuando se tiene plan entonces entra el punto de que hacemos cuando no tiene plan, cuando es por api que le mostramos ??"

Acceptance:

- The remains payload is classified into distinct states, not a single
  `undefined`: `ok`, `no-key`, `invalid-key`, `no-plan` (valid key, no
  `general` bucket → pay-as-you-go), `unknown`.
- The existing `parseRemains(body, now)` keeps its current signature and
  current output. The classification is additive.
- `/minimax:usage` without a plan states it and points at `/minimax:details`.
  It never draws a 0% meter for a window that does not exist.
- `/minimax:details` works with or without a plan: the ledger is the source.

### S4 — Authorization and rules for the local ledger

> "y si tiene autorizacion de leer lo que me piedes"

Acceptance:

- Reads only `<agent-dir>/sessions/**/*.jsonl`, where `<agent-dir>` is
  `PI_CODING_AGENT_DIR` or `~/.pi/agent`. Read-only: no writes, no renames.
- Of each entry it reads only `type`, `timestamp` and, for assistant messages,
  `provider`, `model` and `usage`. Message content is never read or rendered.
- Never sends session data over the network.
- `MINIMAX_DETAILS=off` disables the ledger entirely.
- A missing or unreadable sessions directory yields the "no local usage" state,
  never an exception.
- The command description and the README state that the command reads the local
  session history.

### S5 — Proving the release before publishing it

> "el problema es que no se como la podemas probar antes de sacar la siguiente version"

Acceptance:

- `npm test` green and `npm run typecheck` exit 0.
- A preview entry point renders both views as plain text from real data, with
  no TTY, so the layout can be reviewed before publishing.
- The extension loads in a real Pi without crashing (`pi --extension …`).
- Release order: `npm pack` → local install → publish under the `next` dist-tag
  → install `@next` on the second machine → promote the same version to
  `latest`. `latest` never moves before the tagged build is verified.

## Tasks

- [x] T1 `lib/session-ledger.ts` + `tests/session-ledger.test.ts` (test-first):
      parse session JSONL entries into per-day usage for `provider === "minimax"`.
      Route: delegated writer. Commit: `feat(ledger): agregar el parser del ledger local`.
- [x] T2 `lib/parse-remains.ts` + `tests/parse-remains.test.ts` (test-first):
      additive state classification (`ok` / `no-key` / `invalid-key` / `no-plan` /
      `unknown`) without changing the existing `parseRemains` contract.
      Route: delegated writer. Commit: `feat(parse): clasificar el estado del plan`.
- [x] T3 `lib/details-view.ts` + `tests/details-view.test.ts` (test-first): the
      console-style renderer as a pure function over lines.
      Route: delegated writer. Commit: `feat(details): agregar la vista de consumo`.
- [x] T4 `lib/usage-panel.ts` + `tests/usage-panel.test.ts` (test-first): the
      Gentle-Shell-style panel renderer as a pure function over lines.
      Route: delegated writer. Commit: `feat(usage): agregar el panel de cuota`.
- [x] T5 `extensions/minimax-usage-source.ts` + `lib/commands.ts` +
      `tests/minimax-usage-source.test.ts`: register both commands, wire the TUI
      components, guard the non-TUI modes and the `MINIMAX_DETAILS` switch.
      Route: delegated writer. Commit:
      `feat(commands): registrar los comandos usage y details`.
- [x] T6 `README.md`, `package.json` version bump to `0.5.0`, `scripts/preview-views.ts`
      and the release checklist. Route: inline. Commit: `docs(readme): documentar los comandos` +
      `chore(release): subir la versión a 0.5.0`.
- [ ] T7 Verification: `npm test`, `npm run typecheck`, `npm run lint`,
      `npm run format:check`, the text preview of both views, and the native review
      of the work-unit commits. Route: inline.

## Log

- L1 (user): "estaba pensando el minimax en el dashboard me muestra el uso del mes con mira /tmp/gpeixFFL/pi-clipboard-882e86af-8c19-4d38-b1f2-845a5bde2984.png"
- L2 (user): "si exacto a eso me refiere que eso de la consola de minimax la foto que te pase lo quiero poner en nuestra extencion pero ojo no es que pongamos eso en el consumo si no en un /algo que lo pinte... ahi es donde actualmente entra mi punto... actualmente ponenmos /algo para ver el uso si no uso gentle-shell que es ??"
- L3 (user): "osera que en este momento la gente que tiene solo pi no puede ver el usage.. pero si eso lo planiamos desde el inicio"
- L4 (user): "vale va asi un /minimax:usage que habre una pantalla pintada de pi como la que usa gentle-shell vale asi tal cual y un /minimax:details que abre la lista que propones oso que ese detals solo es cuando se tiene plan entonces entra el punto de que hacemos cuando no tiene plan, cuando es por api que le mostramos ?? y si tiene autorizacion de leer lo que me piedes"
- L5 (user): "si dale al terminar y realiza la neuva version el problema es que no se como la podemas probar antes de sacar la siguiente version"
- L6 (2026-10-22, parent): the console's month view is consumption, not quota: the
  M Plan has only 5h and weekly windows, so the month numbers come from a
  different source. The local ledger (`~/.pi/agent/sessions`, `provider=minimax`)
  reproduces the shape without credentials. Measured on this machine: 1.74B
  tokens over 19 active days, 96% cache reads, $19.01, daily peak 366M — the same
  order of magnitude as the console's 258M daily average. The console numbers
  stay account-wide, so the local view is labelled as local.
- L7 (2026-10-22, parent): the Gentle Shell panel shape was read from
  `gentle-pi/lib/shell-usage.ts` and `lib/shell-gauge.ts` (MIT, Copyright 2025
  Mario Zechner). The extension reimplements the layout instead of importing
  `gentle-pi`, which stays an optional dependency.
- L8 (2026-10-22, parent): three parent corrections after the delegated units.
  The gauge rounds to the nearest cell and the name gap is one space, so the
  panel is byte for byte the shell layout. The window of the details view
  anchors on the LOCAL day of `now` (the ledger buckets by local day, the view
  anchored on the UTC day, which dropped a same day entry east of UTC); the
  summary now carries the offset it used. `MINIMAX_USAGE_MODE=off` now hides
  the commands too: the switch turns the extension off entirely.
- L9 (2026-10-22, parent): the preview with the real data of this machine:
  1.72B tokens over the last 30 days, 96.8% cache hit, $14.38, 13 active days,
  429.04M peak day; the live quota panel answered `5h 4%` and `week 23%`. The
  local ledger is a floor: the MiniMax console reported 7.75B for a comparable
  period, because it counts the whole account (other machines, other tools) and
  may account the tokens its own way. The view says "local" for that reason.
- L10 (2026-10-22, parent): the extension loads in a real Pi without errors
  (`pi --extension ./extensions/minimax-usage-source.ts --mode rpc`), and the
  standalone status still answers `MM 5h 5% · week 23%`. `npm pack` produces
  14 files, 19.5 kB, version 0.5.0.
