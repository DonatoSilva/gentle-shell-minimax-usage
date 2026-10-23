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
- The panel floats over the transcript as a window (a Pi overlay), at the width
  of its content. It never stretches over the terminal nor takes the screen.
- Layout mirrors the Gentle Shell usage panel: framed box, a provider row
  (`minimax`, optional plan, `updated just now` / `updated Nm ago`), then one row
  per window: label, a 16-cell meter (`▰` filled / `▱` empty), the percentage
  padded to 4 columns, and `resets in X` when the window reports a reset.
- Meter tone follows the shell gauge: accent below 80%, warning from 80%, error
  from 95%; empty cells in the border role.
- Frame: `╭─ 🐙 MiniMax ─…╮` … `│ r refresh   esc close │` … `╰──…╯`. The
  octopus is the MiniMax mark (the Gentle Shell flower is not used here).
- The width helpers count a wide glyph (the emoji) as TWO cells: a title padded
  with a one-cell count leaves the frame one column short.
- Keys: `r` refetches, `esc` or `q` closes.
- Colors come from Pi's active theme (theme tokens), never hardcoded ANSI.
- Data comes from the existing `token_plan/remains` fetch, unchanged.

### S2 — `/minimax:details` opens the full-screen consumption view

> "un /minimax:details que abre la lista que propones"
> "lo otro es que el details solo el details deberia ser 100% no 80% osea esatr full-screen"
> "y lo otro es si puedes hacer que daily tren y heatmap sea como tabs o collapse asi provechamos mas el espacio"
> "si me hago entender eso aprovecah mejor el espacio orizontal"

Acceptance:

- Registers a Pi command named `minimax:details`.
- It is a FULL SCREEN view that FLOATS: `ctx.ui.custom(factory, { overlay: true,
overlayOptions: { width: "100%", maxHeight: "100%", margin: 0 } })`. The
  overlay covers the whole terminal and the transcript is intact underneath when
  the view closes. The component pads its lines with blanks up to
  `tui.terminal.rows` so the window fills the height too; when the terminal
  size is not reachable, it renders the content without padding.
- The view has a tab bar with four tabs: `Overview`, `Trend`, `Heatmap`,
  `Models`. The active tab is painted in the accent role and bold and it is the
  only one bracketed, so the bar says which tab is open even without colors.
  `Tab` and the right arrow go to the next tab, `Shift+Tab` and the left arrow
  to the previous one, and `1` to `4` jump to a tab.
- `Overview`: the headline metrics in four columns (a row of labels and a row
  of values: LLM, Cache hit, Daily avg, Cost) plus the cumulative footer
  (total tokens, peak day, active days).
- `Trend`: the daily column chart alone, at the full width of the view and
  taller than in the compact card, with the first and the last day under it.
- `Heatmap`: the weekday × week heatmap alone, over the WHOLE history of the
  ledger (not only the window), so it fills the width of the view. Its legend is
  a weight scale with the color scale: `poco ░▒▓█ mucho`.
- `Models`: what was spent per model, with a bar per model and its share of
  the window.
- The view scrolls (`↑`/`↓`, `j`/`k`) when it does not fit the terminal, so
  nothing is lost.
- The title uses the MiniMax octopus mark `🐙`, not the Gentle Shell flower,
  and the wide glyph is measured as two cells.
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
      Route: delegated writer. Commit: `feat(ledger): agregar el parser del ledger local` (`d6642c2`).
- [x] T2 `lib/parse-remains.ts` + `tests/parse-remains.test.ts` (test-first):
      additive state classification (`ok` / `no-key` / `invalid-key` / `no-plan` /
      `unknown`) without changing the existing `parseRemains` contract.
      Route: delegated writer. Commit: `feat(parse): clasificar el estado del plan` (`78d9daa`).
- [x] T3 `lib/details-view.ts` + `tests/details-view.test.ts` (test-first): the
      console-style renderer as a pure function over lines.
      Route: delegated writer. Commit: `feat(details): agregar la vista de consumo` (`8c7f652`).
      Reopened for the full screen and the tabs (L17): the renderer now draws
      one tab at a time plus the tab bar, the metrics in four columns, and the
      width helpers count a wide glyph as two cells.
- [x] T4 `lib/usage-panel.ts` + `tests/usage-panel.test.ts` (test-first): the
      Gentle-Shell-style panel renderer as a pure function over lines.
      Route: delegated writer. Commit: `feat(usage): agregar el panel de cuota` (`a0daff7`).
      Reopened for the MiniMax mark (L17): the frame title uses the octopus
      `🐙` instead of the Gentle Shell flower.
- [x] T5 `extensions/minimax-usage-source.ts` + `lib/commands.ts` +
      `tests/minimax-usage-source.test.ts`: register both commands, wire the TUI
      components, guard the non-TUI modes and the `MINIMAX_DETAILS` switch.
      Route: delegated writer. Commit:
      `feat(commands): registrar los comandos usage y details` (`bfca824`).
      Reopened for the floating window (L14): both commands open as a Pi
      overlay instead of taking the screen.
      Reopened again for the full screen and the tabs (L17): the details view
      stops being an overlay and becomes a full screen view with tabs.
- [x] T6 `README.md`, `package.json` version bump to `0.5.0`, `scripts/preview-views.ts`
      and the release checklist. Route: inline. Commits:
      `docs(readme): documentar los comandos` (`64588ac`) +
      `chore(release): subir la versión a 0.5.0` (`4d6b03d`).
- [x] T7 Verification: `npm test` (129/129), `npm run typecheck`, `npm run lint`,
      `npm run format:check`, the text preview of both views, the load in a real
      Pi and the native assessment of the committed range.
      Route: inline. Native review: candidate-scoped decline, see L13.

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
- L11 (2026-10-22, parent): the eight work units landed on `dev` with the
  user's approval: `d6642c2` ledger, `78d9daa` parse, `1df0b3c` ui, `a0daff7`
  usage, `8c7f652` details, `bfca824` commands, `64588ac` docs, `4d6b03d`
  release. The committed tree was re-verified after the hooks ran: 129 tests,
  typecheck, eslint and prettier clean. Four units go over the 400 line review
  budget (the ledger, the usage panel, the details view and the commands); the
  overage was reported instead of shrinking the diff.
- L12 (2026-10-22, parent): the native assessment of the committed range
  (`baseRef fc325c1`, 19 paths, 3085 changed lines) answered `risk: medium`,
  `reviewDue: false`, `reviewDueReason: under_budget`, so no native review was
  started from that route. The plan it returned keeps the writer
  self-verification and adds no independent verifier, because no Task Size
  high-risk item was escalated.
- L13 (2026-10-23, parent): a later `inspect` on the controller's own base
  (`4378553`, the commit before the tooling work) answered `status: ready`,
  `action: start` for the target `sha256:5b09b43f…` (33 paths, 6777 changed
  lines, `risk_level: high` with the evidence "an executable permission change
  in .husky/commit-msg"), and the START was attempted with the four pertinent
  lenses. The eligible interactive host resolved the consent and the human
  **declined the review of this candidate**:
  `outcome: consent-declined-this-candidate`, `lineage_created: false`,
  `mutation_performed: false`, `mutation_outcome: none`.
  - Disposition: **decline with candidate scope**, not a kill switch. The
    consent is not retried for this target and no lineage is burned.
  - `nativeReviewOutcome` stays `unknown`: there is no lineage and no consumed
    candidate, so closure by review cannot be derived. The work is NOT closed
    by a review; it stands on the writer self-verification (129 tests,
    typecheck, eslint, prettier, the preview and the load in a real Pi).
  - The previous declines of the tooling work (`sha256:bda49b2f…` and
    `sha256:9c6d1a70…`, base `4378553`) were also candidate-scoped and
    explicitly limited to that change: a review is due for materially new
    work, which is why this candidate was started.
- L14 (user): "de la forma que estas haciendo eso: /tmp/gpeixFFL/pi-clipboard-c4488860-9d05-4764-ada5-e2db7d6d54dd.png, /tmp/gpeixFFL/pi-clipboard-aa96ae76-ca00-43b9-960a-184498b65781.png... de esta manera se ve todo espicahdo mientras que lo de gentle-shell se ve como ventanas flotante"
  - What changed: both commands now open as a Pi overlay (`overlay: true` with
    `overlayOptions`), so they float over the transcript like the Gentle Shell
    panel instead of taking the screen. The quota panel is measured at the
    width of its content (`usagePanelBodyWidth` plus the four columns of the
    frame); the consumption view is a framed card of a fixed body width (60)
    with the same title and hints as the panel.
  - Why: the first rendering took over the whole terminal and the frame was
    cut at the right edge; the shell draws the same panel as a floating window.
- L15 (user): "mejoro, pero a tener en cuenta en deatils /tmp/gpeixFFL/pi-clipboard-e516448d-24b0-4770-a40c-fff223816749.png, mira como se ve presionado las barras y el heatmap no muestra la escala de color como si lo hace gentle /tmp/gpeixFFL/pi-clipboard-47c6c612-7ec7-48f3-9c16-430f58b7b8da.png" and "tampoco se ve en que modelo gaste tampoco la grafica de barras"
  - What changed: the daily trend is now a column chart (five rows, one column
    per day) instead of a baseline ramp that read as a squeezed line; the
    heatmap paints every cell with its level of the scale (shape and color)
    and shows the `Less ░▒▓█ More` legend; and a new `Models` section reports
    what was spent per model, with a bar per model and its share of the
    window. The ledger now aggregates the same numbers per model
    (`LedgerSummary.models`).
  - Why: the shell paints a calendar heatmap with a real color scale and a
    legend, and its bars are columns; ours had neither the scale nor the
    per-model breakdown.
- L16 (user): "ojo yo no lo veo así /tmp/gpeixFFL/pi-clipboard-bb6074b3-fa3f-4cad-a655-8ba7f55b63c3.png"
  - What changed: the card was being cut by the overlay (`maxHeight: 80%`),
    so the legend, the models and the footer never showed. The card now fits:
    the trend and the heatmap sit side by side, the models moved up under the
    headline numbers, and the card scrolls (`↑↓`, `j`/`k`) when the terminal
    is short. The bars use a half block (`▌`) so two adjacent days do not
    merge into one block, and the days outside the window are no longer drawn
    as cells (they were a stripe of empty days that read like usage).
  - Why: the card is taller than the space Pi leaves over the transcript, and
    a clipped card is worse than a compact one.
- L17 (user): "para lo del logo no es una mancha investiga y es como un pulpo" and
  "vamos por la a aplica el odd de los ajuste como lo venimos hablando"
  - What changed: the logo is the MiniMax octopus (`🐙`), not the Gentle Shell
    flower. The details view stops being an overlay and becomes a FULL SCREEN
    view (`ctx.ui.custom` without `overlay: true`): the transcript stays above,
    the editor is restored on exit and nothing is clipped. It gets a tab bar
    (`Overview`, `Trend`, `Heatmap`, `Models`) switched with `Tab`, `Shift+Tab`,
    the arrows or the keys `1` to `4`, and the headline metrics move to four
    columns (a row of labels and a row of values) to use the horizontal space.
    The width helpers now count a wide glyph as two cells.
  - Why: the user asked for the details view to be 100% and not 80%, for the
    trend and the heatmap to behave like tabs, for the metrics to use the
    horizontal space, and for the MiniMax mark instead of the shell flower.
  - Research: MiniMax has two marks: the official one (a single line that
    rises and falls like a waveform, magenta to orange) and the octopus
    character. The user chose the octopus (`🐙`).
- L19 (user): "espera y por que no se puede float de la forma que lo pusiste... pero al 100% de ancho y de alto" and "ira como se ve /tmp/gpvlw5n8/pi-clipboard-8fd95e2c-fe4f-4452-8d24-05556166007f.png, seria mas ancho esos detalles con un un visualizador de peso osea | poco || mucho y ais pero con el peso de color que manejas"
  - What changed: the details view goes back to being an OVERLAY, but at 100%
    of the width and of the height (`width: "100%"`, `maxHeight: "100%"`,
    `margin: 0`), and the component pads its lines up to `tui.terminal.rows` so
    the window fills the screen. The heatmap now draws the WHOLE history of the
    ledger instead of only the 30 day window, so it fills the width, and its
    legend is a weight scale (`poco ░▒▓█ mucho`) painted with the color scale.
  - Why: the overlay was never the problem, the `maxHeight: "80%"` cap was.
    And the heatmap of a 30 day window is five columns wide: too small to read.
- L20 (user): "mas ancho y la escala de poco mucho puede ser es al lado" and
  "antes de hacer cambios quiero saber el json que te responde el api ocn el que forma la grafica de varras"
  - What changed: the cells of the calendar are TWO columns wide (the grid
    reads as blocks and the calendar is twice as wide) and the weight scale
    sits at the RIGHT of the calendar, on its middle row, instead of under it.
    The calendar only takes the room the scale leaves: a long history shows
    its most recent weeks instead of running past the edge of the view.
  - The JSON (asked before the change): the API that answers
    `GET /v1/token_plan/remains` carries ONLY the remaining percentages of the
    5h and weekly windows (`current_interval_remaining_percent: 85`,
    `current_weekly_remaining_percent: 72`, `remains_time`,
    `weekly_remains_time`) and not a single token: that is why the M Plan has
    no monthly quota. The bars do NOT come from an API: they are the sum of
    `usage.input + output + cacheRead + cacheWrite` of every assistant message
    of `provider=minimax` in the local session files, bucketed by the local day
    of the entry `timestamp` (`model` gives the per model breakdown and
    `cost.total` the money).
- L21 (user): "pero espera osea que el trend no se trae del api ??? osea no podemos hacer que una barra tenga color segun modelo osea diamos asi segun el modelo un color y eso lo representa la barra amontondo colores y lo otro es posible que al darle click en una barra se vea el dia y el consumo total y individual de los modelos que la conforma ??"
  - What changed: the trend bars are STACKED BY MODEL: every column of a day
    is split into one segment per model, each segment painted with the color of
    its model, so a column shows at a glance how the day was spent. The ledger
    keeps the per day, per model matrix (`LedgerDay.models`). The trend tab
    gains a model legend and a DETAIL LINE for the selected day: the day, its
    total and the models that make it up, each one in its color. The day is
    selected with the left and right arrows (the tabs keep `Tab`,
    `Shift+Tab` and the keys `1` to `4`) and, when the terminal delivers the
    event, with a click on the column.
  - The mouse caveat: Pi only routes mouse events to a component in its
    alt-screen (fullscreen) mode; in the regular mode the terminal keeps the
    mouse (`docs/tui.md:60`). The keyboard is therefore the path that always
    works, and `handleMouse` is the extra that works when Pi runs fullscreen.
- L23 (user): "vale en el heatmap falta tamvien la opcion de al darle clic al dia ver el gasto y el dia y en treand los modelos con su porcentage ... quiero que deber de amontonarse de manera vertical dejalo horizontal osea uno al lado del otro separados u antes de la grafica no despues por cuestion de como el ser humano lee y guarda contexto ... del resto si logras eso con exito temrina la version 0.5.0"
  - What changed: the model legend of the Trend tab is laid out HORIZONTALLY
    (the entries one next to the other, separated) and it sits BEFORE the
    chart, not under it: the eye reads the legend first and keeps it as the
    context of the bars that follow. The HEATMAP tab also answers a click: a
    click on a cell selects that day and the detail line under the calendar
    shows the day, its total and the models that make it up, the same line the
    Trend tab shows. The selected day is one selection for both tabs.
  - Why: a vertical legend under the chart has to be read backwards, after the
    bars it explains; and the heatmap was the only tab without the detail of
    the day.
- L25 (user): "ajuste antes de publicar en el overview pon tambien los modelossi quias el tabde models"
  - What changed: the `Overview` tab also carries the models, the same rows
    as the `Models` tab, between the headline numbers and the cumulative
    footer. The first tab is the one people look at, so it holds the whole
    picture. The tab isolation test changed with it: the overview is no longer
    "the headline numbers and nothing else".
- L26 (user): "te dije que al poner los modelos de primera no era necesario la tab de models que pones"
  - What changed: the `Models` tab is GONE. With the models already in the
    Overview it was a duplicate of the same rows, so the bar is now
    `Overview`, `Trend`, `Heatmap` and the digit keys are `1` to `3`. The
    models rows moved nowhere: they are the ones the Overview paints. The
    scroll test now uses a short terminal instead of the tall models tab.
- L27 (user): "esto no funcionacdentro de minimax:details no esta funcionando, o quitalo a arreclaro ←→ day"
  - What changed: the keys were matched as RAW BYTES, and Pi asks the terminal
    for the kitty keyboard protocol (flags 7: disambiguate plus event types),
    so the arrows arrived as `CSI 1 ; modifiers D` (`\x1b[1;1D`) and the tab
    as `CSI 9 u` (`\x1b[9u`): the views were DEAF to them. A new
    `lib/view-keys.ts` reads both encodings (the legacy CSI and SS3 forms and
    the kitty ones) and every key of the views goes through it. The overview
    also paints the detail of the selected day, so the arrows always change
    something visible.
  - Why: the arrows and the tab never arrived: the bug was the encoding, not
    the feature.
- L24 (2026-10-23, parent): the unit landed delegated and the parent verified
  it: `npm test` 169/169, typecheck, eslint and prettier clean; the previews
  paint the legend before the chart (horizontal, wrapping when it does not
  fit) and the detail line under the calendar. The parent kept the extra
  `Daily trend` title of the section: it names the block that follows, and
  the legend now reads as a legend and not as a list of models. The version is
  closed with this commit: the tree is the 0.5.0 candidate.
- L22 (2026-10-23, parent): the unit landed delegated (160 tests green) and the
  parent made the `model` slot of `ViewTheme` REQUIRED (the writer had left it
  optional to avoid touching a test outside its surface; the usage panel test
  now declares it and the renderers call it without a fallback). The hints line
  of the view now reads `↑↓ scroll · ←→ day · tab cambia · r refresh · esc
close`. Verification: `npm test` 160/160, typecheck, eslint and prettier
  clean, and the preview paints the Trend tab with the stacked bars, the model
  legend and the detail of the selected day.
- L18 (2026-10-23, parent): the unit landed delegated (T3+T4+T5 reopened, 143
  tests green) and the parent adjusted the tab bar: only the ACTIVE tab is
  bracketed, so the bar still says which tab is open when the theme paints no
  color. The delegated chart spreads the leftover columns between the days to
  fill the width of the view (the bars stay one cell wide and separated), which
  is what S2 asked for with "at the full width of the view". Verification:
  `npm test` 143/143, typecheck, eslint and prettier clean, the preview paints
  the four tabs, and the extension still loads in a real Pi.
