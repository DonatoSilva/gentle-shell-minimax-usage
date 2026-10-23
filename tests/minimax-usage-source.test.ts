import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import minimaxUsageSource, { type UsageRuntime } from "../extensions/minimax-usage-source.ts";
import type {
  CommandCtx,
  CommandRegistrationOptions,
  CustomComponent,
  ThemeLike,
  TuiLike,
  UiLike,
} from "../lib/commands.ts";
import type { FetchFn } from "../lib/fetch-remains.ts";
import { parseRemains } from "../lib/parse-remains.ts";
import {
  STATUS_KEY,
  STATUS_NO_DATA,
  STATUS_NO_KEY,
  formatUsageStatus,
} from "../lib/standalone-status.ts";

const NOW = 1_759_500_000_000;
const HOME = "/home/tester";
const CHANNEL = "gentle-pi:usage-source/v1";

interface Emitted {
  channel: string;
  data: Record<string, unknown>;
}

type StatusCall = [key: string, text: string | undefined];

interface Ctx {
  mode?: string;
  ui?: { setStatus(key: string, text: string | undefined): void };
}

type Handler = (event: unknown, ctx?: Ctx) => void;

function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const emitted: Emitted[] = [];
  const statusCalls: StatusCall[] = [];
  const ctx: Ctx = {
    ui: {
      setStatus(key, text) {
        statusCalls.push([key, text]);
      },
    },
  };
  const pi = {
    events: {
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data: data as Record<string, unknown> });
      },
    },
    on(event: "session_start" | "agent_settled", handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
  const fire = (event: string, callCtx?: Ctx) => {
    for (const handler of handlers.get(event) ?? []) handler(event, callCtx ?? ctx);
  };
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  return { pi, emitted, fire, flush, statusCalls, ctx };
}

function baseRuntime(overrides: Partial<UsageRuntime> = {}): Partial<UsageRuntime> {
  return { env: {}, home: HOME, exists: () => false, readFile: () => "{}", ...overrides };
}

function okFetch(): FetchFn {
  const ok = JSON.parse(
    readFileSync(new URL("./fixtures/remains-ok.json", import.meta.url), "utf8"),
  ) as unknown;
  return (async () => ({ ok: true, json: async () => ok }) as Response) as FetchFn;
}

function assertRegistration(emitted: Emitted): void {
  assert.equal(emitted.channel, CHANNEL);
  const { data } = emitted;
  assert.equal(data.schema, "gentle-pi.usage-source/v1");
  assert.equal(data.provider, "minimax");
  assert.equal(data.pendingNote, "no usage yet · r to fetch");
  assert.equal(typeof data.fetch, "function");
}

test("registers the usage source at factory time", () => {
  const { pi, emitted } = fakePi();

  minimaxUsageSource(pi, baseRuntime());

  assert.equal(emitted.length, 1);
  assertRegistration(emitted[0] as Emitted);
});

test("registers the usage source on session_start", () => {
  const { pi, emitted, fire } = fakePi();
  minimaxUsageSource(pi, baseRuntime());

  fire("session_start");

  assert.equal(emitted.length, 2);
  assertRegistration(emitted.at(-1) as Emitted);
});

test("the registered fetch returns the parsed snapshot", async () => {
  const stubFetch = okFetch();
  const { pi, emitted, fire } = fakePi();
  minimaxUsageSource(pi, baseRuntime());
  fire("session_start");

  const fetch = emitted.at(-1)?.data.fetch as (
    apiKey: string | undefined,
    fetchFn: FetchFn,
    now: number,
  ) => Promise<unknown>;

  assert.deepStrictEqual(
    await fetch("key", stubFetch, NOW),
    parseRemains(
      JSON.parse(
        readFileSync(new URL("./fixtures/remains-ok.json", import.meta.url), "utf8"),
      ) as unknown,
      NOW,
    ),
  );
});

test("re-registers on every session_start", () => {
  const { pi, emitted, fire } = fakePi();
  minimaxUsageSource(pi, baseRuntime());

  fire("session_start");
  fire("session_start");

  assert.equal(emitted.length, 3);
  assert.ok(emitted.every((e) => e.channel === CHANNEL));
});

test("status mode writes the usage status on session_start and agent_settled", async () => {
  const { pi, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "status", MINIMAX_API_KEY: "env-key" },
      fetchFn: okFetch(),
      now: () => NOW,
    }),
  );

  fire("session_start");
  await flush();
  fire("agent_settled");
  await flush();

  assert.equal(statusCalls.length, 2);
  assert.ok(
    statusCalls.every(([key, text]) => key === STATUS_KEY && text === "MM 5h 55% · week 6%"),
  );
});

test("off mode emits nothing and writes nothing", async () => {
  const { pi, emitted, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "off", MINIMAX_API_KEY: "env-key" },
      fetchFn: okFetch(),
    }),
  );

  fire("session_start");
  fire("agent_settled");
  await flush();

  assert.equal(emitted.length, 0);
  assert.equal(statusCalls.length, 0);
});

test("off mode registers no command either", () => {
  const { pi, registrations } = commandPi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "off", MINIMAX_API_KEY: "env-key" },
      fetchFn: okFetch(),
    }),
  );

  assert.deepEqual(registrations, []);
});

test("shell mode emits but never writes the status", async () => {
  const { pi, emitted, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "shell", MINIMAX_API_KEY: "env-key" },
      exists: () => true,
      fetchFn: okFetch(),
    }),
  );

  fire("session_start");
  fire("agent_settled");
  await flush();

  assert.ok(emitted.length >= 1);
  assert.ok(emitted.every((e) => e.channel === CHANNEL));
  assert.equal(statusCalls.length, 0);
});

test("auto mode writes the status without a shell and stays silent with one", async () => {
  const withoutShell = fakePi();
  minimaxUsageSource(
    withoutShell.pi,
    baseRuntime({ env: { MINIMAX_API_KEY: "env-key" }, fetchFn: okFetch(), now: () => NOW }),
  );
  withoutShell.fire("session_start");
  await withoutShell.flush();

  // Source still registers at factory time and on session_start.
  assert.equal(withoutShell.emitted.length, 2);
  assert.deepStrictEqual(withoutShell.statusCalls, [
    [
      STATUS_KEY,
      formatUsageStatus(
        parseRemains(
          JSON.parse(
            readFileSync(new URL("./fixtures/remains-ok.json", import.meta.url), "utf8"),
          ) as unknown,
          NOW,
        ),
      ),
    ],
  ]);

  const withShell = fakePi();
  minimaxUsageSource(
    withShell.pi,
    baseRuntime({ env: { MINIMAX_API_KEY: "env-key" }, exists: () => true, fetchFn: okFetch() }),
  );
  withShell.fire("session_start");
  withShell.fire("agent_settled");
  await withShell.flush();

  assert.ok(withShell.emitted.length >= 1);
  assert.equal(withShell.statusCalls.length, 0);
});

test("a missing key writes the no-key status without fetching", async () => {
  let fetched = false;
  const { pi, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "status" },
      fetchFn: (() => {
        fetched = true;
        return Promise.reject(new Error("must not be called"));
      }) as FetchFn,
      readFile: () => {
        throw new Error("no auth.json");
      },
    }),
  );

  fire("session_start");
  await flush();

  assert.equal(fetched, false);
  assert.deepStrictEqual(statusCalls, [[STATUS_KEY, STATUS_NO_KEY]]);
});

test("print mode never writes the status", async () => {
  const { pi, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "status", MINIMAX_API_KEY: "env-key" },
      fetchFn: okFetch(),
    }),
  );

  fire("session_start", { mode: "print" });
  fire("agent_settled", { mode: "json" });
  await flush();

  assert.equal(statusCalls.length, 0);
});

test("a rejecting fetchFn writes the no-data status and never throws", async () => {
  const { pi, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "status", MINIMAX_API_KEY: "env-key" },
      fetchFn: (async () => {
        throw new Error("network down");
      }) as FetchFn,
    }),
  );

  fire("session_start");
  await flush();

  assert.deepStrictEqual(statusCalls, [[STATUS_KEY, STATUS_NO_DATA]]);
});

// --- commands ----------------------------------------------------------------

// The details view anchors its window on the UTC day of `now` while the ledger
// buckets by local day, so the fixture instant sits at 06:00 UTC: every
// timezone lands on the same day or on the day before, and both are inside
// the trailing 30 days window.
const DETAILS_NOW = Date.UTC(2026, 9, 22, 6, 0, 0);
const WIDTH = 72;

type CustomFactory = (
  tui: TuiLike,
  theme: ThemeLike,
  keybindings: unknown,
  done: (result: unknown) => void,
) => CustomComponent;

interface CommandRegistration {
  name: string;
  description: string;
  handler: (args: string, ctx: CommandCtx) => Promise<void>;
}

function commandPi() {
  const registrations: CommandRegistration[] = [];
  const pi = {
    events: { emit() {} },
    on() {},
    registerCommand(name: string, options: CommandRegistrationOptions) {
      registrations.push({
        name,
        description: options.description,
        handler: async (args, ctx) => {
          await options.handler(args, ctx);
        },
      });
    },
  };
  return { pi, registrations };
}

function fakeCtx(mode: string) {
  const notifications: { message: string; level?: string }[] = [];
  const factories: CustomFactory[] = [];
  const ui: UiLike = {
    async custom<T>(
      factory: (
        tui: TuiLike,
        theme: ThemeLike,
        keybindings: unknown,
        done: (result: T) => void,
      ) => CustomComponent,
    ) {
      factories.push(factory as unknown as CustomFactory);
      return undefined as T;
    },
    notify(message: string, level?: string) {
      notifications.push({ message, level });
    },
  };
  const ctx: CommandCtx = { mode, ui };
  return { ctx, notifications, factories };
}

function fakeTheme() {
  const colors: string[] = [];
  const theme: ThemeLike = {
    fg(color: string, text: string) {
      colors.push(color);
      return text;
    },
  };
  return { theme, colors };
}

function fakeTui() {
  const renders = { count: 0 };
  const tui: TuiLike = {
    requestRender() {
      renders.count += 1;
    },
  };
  return { tui, renders };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** The `remains-ok` fixture, counted on every call. */
function countedOkFetch(counter: { count: number }): FetchFn {
  const body = JSON.parse(
    readFileSync(new URL("./fixtures/remains-ok.json", import.meta.url), "utf8"),
  ) as unknown;
  return (async () => {
    counter.count += 1;
    return { ok: true, json: async () => body } as Response;
  }) as FetchFn;
}

/** An assistant message of the MiniMax provider, with its numeric usage. */
function ledgerEntry(now: number): unknown {
  return {
    type: "message",
    timestamp: new Date(now).toISOString(),
    message: {
      role: "assistant",
      provider: "minimax",
      model: "MiniMax-M2",
      usage: {
        input: 1000,
        output: 200,
        cacheRead: 3000,
        cacheWrite: 400,
        cost: { total: 0.5 },
      },
    },
  };
}

/** A temporary agent directory with one session file in it. */
function ledgerDir(now: number): string {
  const root = mkdtempSync(join(tmpdir(), "minimax-details-"));
  const bucket = join(root, "sessions", "2026-10-22");
  mkdirSync(bucket, { recursive: true });
  writeFileSync(join(bucket, "session.jsonl"), `${JSON.stringify(ledgerEntry(now))}\n`, "utf8");
  return root;
}

test("registers the usage and the details commands", () => {
  const { pi, registrations } = commandPi();

  minimaxUsageSource(pi, baseRuntime());

  assert.deepStrictEqual(
    registrations.map((registration) => registration.name),
    ["minimax:usage", "minimax:details"],
  );
  assert.ok(registrations.every((registration) => registration.description.length > 0));
  assert.ok(
    registrations[1]?.description.includes("session history"),
    registrations[1]?.description,
  );
});

test("the usage command fetches the state and paints the panel", async () => {
  const counter = { count: 0 };
  const { pi, registrations } = commandPi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_API_KEY: "env-key" },
      fetchFn: countedOkFetch(counter),
      now: () => NOW,
    }),
  );
  const { ctx, factories } = fakeCtx("tui");

  await registrations[0]?.handler("", ctx);

  assert.equal(factories.length, 1);
  assert.equal(counter.count, 1);

  const { theme } = fakeTheme();
  const component = factories[0]?.(fakeTui().tui, theme, {}, () => {});
  const text = (component?.render(WIDTH) ?? []).join("\n");

  assert.ok(text.includes("minimax · updated just now"), text);
  assert.ok(text.includes("general 5h"), text);
  assert.ok(text.includes("general week"), text);
  assert.ok(text.includes("55%"), text);
});

test("the usage command paints with the tokens of the active Pi theme", async () => {
  const { pi, registrations } = commandPi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_API_KEY: "env-key" },
      fetchFn: countedOkFetch({ count: 0 }),
      now: () => NOW,
    }),
  );
  const { ctx, factories } = fakeCtx("tui");

  await registrations[0]?.handler("", ctx);

  const { theme, colors } = fakeTheme();
  const component = factories[0]?.(fakeTui().tui, theme, {}, () => {});
  component?.render(WIDTH);

  assert.ok(colors.includes("accent"), colors.join(","));
  assert.ok(colors.includes("border"), colors.join(","));
  assert.ok(colors.includes("muted"), colors.join(","));
});

test("r refreshes the usage panel and esc or q closes it", async () => {
  const counter = { count: 0 };
  const { pi, registrations } = commandPi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_API_KEY: "env-key" },
      fetchFn: countedOkFetch(counter),
      now: () => NOW,
    }),
  );
  const { ctx, factories } = fakeCtx("tui");

  await registrations[0]?.handler("", ctx);

  const { theme } = fakeTheme();
  const { tui, renders } = fakeTui();
  let closed = 0;
  const component = factories[0]?.(tui, theme, {}, () => {
    closed += 1;
  });
  assert.ok(component);

  component?.handleInput?.("r");
  await flushMicrotasks();

  assert.equal(counter.count, 2);
  assert.equal(renders.count, 1);

  component?.handleInput?.("\x1b");
  assert.equal(closed, 1);

  component?.handleInput?.("q");
  assert.equal(closed, 2);
});

test("the details command builds the view from the local ledger", async () => {
  const root = ledgerDir(DETAILS_NOW);
  try {
    const { pi, registrations } = commandPi();
    minimaxUsageSource(
      pi,
      baseRuntime({ env: { PI_CODING_AGENT_DIR: root }, now: () => DETAILS_NOW }),
    );
    const { ctx, factories } = fakeCtx("tui");

    await registrations[1]?.handler("", ctx);

    assert.equal(factories.length, 1);

    const { theme } = fakeTheme();
    const component = factories[0]?.(fakeTui().tui, theme, {}, () => {});
    const text = (component?.render(WIDTH) ?? []).join("\n");

    assert.ok(text.includes("MiniMax · Pi usage (local)"), text);
    assert.ok(text.includes("4.60K tokens"), text);
    assert.ok(text.includes("$0.50"), text);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("r re-reads the ledger and esc or q closes the details view", async () => {
  const root = ledgerDir(DETAILS_NOW);
  try {
    const { pi, registrations } = commandPi();
    minimaxUsageSource(
      pi,
      baseRuntime({ env: { PI_CODING_AGENT_DIR: root }, now: () => DETAILS_NOW }),
    );
    const { ctx, factories } = fakeCtx("tui");

    await registrations[1]?.handler("", ctx);

    const { theme } = fakeTheme();
    const { tui, renders } = fakeTui();
    let closed = 0;
    const component = factories[0]?.(tui, theme, {}, () => {
      closed += 1;
    });
    assert.ok(component);

    component?.handleInput?.("r");
    await flushMicrotasks();

    assert.equal(renders.count, 1);
    assert.ok((component?.render(WIDTH) ?? []).join("\n").includes("4.60K tokens"));

    component?.handleInput?.("\x1b");
    assert.equal(closed, 1);

    component?.handleInput?.("q");
    assert.equal(closed, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the details command says so when there is no local data", async () => {
  const root = mkdtempSync(join(tmpdir(), "minimax-details-"));
  try {
    const { pi, registrations } = commandPi();
    minimaxUsageSource(
      pi,
      baseRuntime({ env: { PI_CODING_AGENT_DIR: root }, now: () => DETAILS_NOW }),
    );
    const { ctx, factories } = fakeCtx("tui");

    await registrations[1]?.handler("", ctx);

    const { theme } = fakeTheme();
    const component = factories[0]?.(fakeTui().tui, theme, {}, () => {});
    const text = (component?.render(WIDTH) ?? []).join("\n");

    assert.ok(text.includes("No local MiniMax usage"), text);
    assert.equal(text.includes("0.00B tokens"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MINIMAX_DETAILS=off reads nothing and notifies", async () => {
  const root = ledgerDir(DETAILS_NOW);
  try {
    const { pi, registrations } = commandPi();
    minimaxUsageSource(
      pi,
      baseRuntime({
        env: { PI_CODING_AGENT_DIR: root, MINIMAX_DETAILS: " off " },
        now: () => DETAILS_NOW,
      }),
    );
    const { ctx, factories, notifications } = fakeCtx("tui");

    await registrations[1]?.handler("", ctx);

    assert.equal(factories.length, 0);
    assert.equal(notifications.length, 1);
    assert.ok(notifications[0]?.message.includes("disabled"), notifications[0]?.message);
    assert.equal(notifications[0]?.message.includes("4.60K"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a non TUI mode notifies instead of opening a component", async () => {
  const counter = { count: 0 };
  const { pi, registrations } = commandPi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_API_KEY: "env-key" },
      fetchFn: countedOkFetch(counter),
      now: () => NOW,
    }),
  );

  for (const mode of ["print", "json", "rpc"]) {
    const { ctx, factories, notifications } = fakeCtx(mode);

    await registrations[0]?.handler("", ctx);

    assert.equal(factories.length, 0, mode);
    assert.equal(notifications.length, 1, mode);
    assert.ok(notifications[0]?.message.includes("MiniMax"), notifications[0]?.message);
    assert.ok(notifications[0]?.message.includes("55%"), notifications[0]?.message);
  }
});

test("a failing fetch paints a state instead of throwing", async () => {
  const { pi, registrations } = commandPi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_API_KEY: "env-key" },
      fetchFn: (async () => {
        throw new Error("network down");
      }) as FetchFn,
      now: () => NOW,
    }),
  );
  const { ctx, factories } = fakeCtx("tui");

  await registrations[0]?.handler("", ctx);

  assert.equal(factories.length, 1);
  const { theme } = fakeTheme();
  const component = factories[0]?.(fakeTui().tui, theme, {}, () => {});
  const text = (component?.render(WIDTH) ?? []).join("\n");

  assert.ok(text.includes("minimax · no data"), text);
});
