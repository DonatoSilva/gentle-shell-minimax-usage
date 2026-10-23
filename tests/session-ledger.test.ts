import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSessionEntries, resolveSessionsDir, summarizeUsage } from "../lib/session-ledger.ts";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0); // 2026-10-22T12:00:00Z

function assistantEntry(options: {
  timestamp: string;
  provider?: string;
  usage?: unknown;
  role?: string;
  type?: string;
}): unknown {
  return {
    type: options.type ?? "message",
    timestamp: options.timestamp,
    message: {
      role: options.role ?? "assistant",
      provider: options.provider ?? "minimax",
      model: "MiniMax-M2",
      usage: options.usage ?? {},
    },
  };
}

test("sums the assistant messages that share a local day", () => {
  const summary = summarizeUsage(
    [
      assistantEntry({
        timestamp: "2026-10-20T10:00:00Z",
        usage: { input: 1000, output: 200, cacheRead: 3000, cacheWrite: 400, cost: { total: 0.5 } },
      }),
      assistantEntry({
        timestamp: "2026-10-20T18:00:00Z",
        usage: { input: 500, output: 100, cacheRead: 1000, cacheWrite: 200, cost: { total: 0.25 } },
      }),
    ],
    { now: NOW, tzOffsetMinutes: 0 },
  );

  assert.deepStrictEqual(summary.days, [
    {
      day: "2026-10-20",
      input: 1500,
      output: 300,
      cacheRead: 4000,
      cacheWrite: 600,
      totalTokens: 6400,
      cost: 0.75,
      messages: 2,
    },
  ]);
  assert.deepStrictEqual(summary.totals, {
    input: 1500,
    output: 300,
    cacheRead: 4000,
    cacheWrite: 600,
    totalTokens: 6400,
    cost: 0.75,
  });
  assert.equal(summary.provider, "minimax");
  assert.equal(summary.activeDays, 1);
  assert.equal(summary.windowDays, 30);
});

test("ignores entries that are not assistant messages of the provider", () => {
  const summary = summarizeUsage(
    [
      assistantEntry({
        timestamp: "2026-10-20T10:00:00Z",
        role: "user",
        usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      assistantEntry({
        timestamp: "2026-10-20T10:00:00Z",
        type: "session",
        usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      assistantEntry({
        timestamp: "2026-10-20T10:00:00Z",
        provider: "anthropic",
        usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      assistantEntry({ timestamp: "2026-10-20T10:00:00Z", usage: { input: "many" } }),
      assistantEntry({ timestamp: "2026-10-20T10:00:00Z" }),
    ],
    { now: NOW, tzOffsetMinutes: 0 },
  );

  assert.deepStrictEqual(summary.days, []);
  assert.deepStrictEqual(summary.totals, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
  });
  assert.equal(summary.activeDays, 0);
  assert.equal(summary.peakDay, undefined);
  assert.equal(summary.cacheHitRate, 0);
  assert.equal(summary.dailyAverage, 0);
});

test("counts only the minimax provider when another one is requested", () => {
  const summary = summarizeUsage(
    [
      assistantEntry({
        timestamp: "2026-10-20T10:00:00Z",
        usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      assistantEntry({
        timestamp: "2026-10-20T11:00:00Z",
        provider: "openai",
        usage: { input: 99, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    ],
    { provider: "openai", now: NOW, tzOffsetMinutes: 0 },
  );

  assert.equal(summary.provider, "openai");
  assert.equal(summary.totals.input, 99);
});

test("computes the cache hit rate over input, cache read and cache write", () => {
  const summary = summarizeUsage(
    [
      assistantEntry({
        timestamp: "2026-10-20T10:00:00Z",
        usage: { input: 1500, output: 300, cacheRead: 4000, cacheWrite: 600 },
      }),
    ],
    { now: NOW, tzOffsetMinutes: 0 },
  );

  // Our own definition: cacheRead / (input + cacheRead + cacheWrite).
  assert.ok(Math.abs(summary.cacheHitRate - 4000 / 6100) < 1e-9);
});

test("returns a zero cache hit rate when the denominator is zero", () => {
  const summary = summarizeUsage(
    [
      assistantEntry({
        timestamp: "2026-10-20T10:00:00Z",
        usage: { output: 100 },
      }),
    ],
    { now: NOW, tzOffsetMinutes: 0 },
  );

  assert.equal(summary.cacheHitRate, 0);
  assert.equal(summary.totals.output, 100);
  assert.equal(summary.totals.totalTokens, 100);
});

test("sums the token fields instead of trusting usage.totalTokens", () => {
  const summary = summarizeUsage(
    [
      assistantEntry({
        timestamp: "2026-10-20T10:00:00Z",
        usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 999999 },
      }),
    ],
    { now: NOW, tzOffsetMinutes: 0 },
  );

  assert.equal(summary.totals.totalTokens, 100);
});

test("keeps only the days inside the trailing window", () => {
  const summary = summarizeUsage(
    [
      assistantEntry({
        timestamp: "2026-10-19T10:00:00Z",
        usage: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      assistantEntry({
        timestamp: "2026-10-20T10:00:00Z",
        usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      assistantEntry({
        timestamp: "2026-10-22T10:00:00Z",
        usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    ],
    { now: NOW, windowDays: 3, tzOffsetMinutes: 0 },
  );

  assert.deepStrictEqual(
    summary.days.map((day) => day.day),
    ["2026-10-20", "2026-10-22"],
  );
  assert.equal(summary.totals.input, 110);
  assert.equal(summary.windowDays, 3);
  assert.equal(summary.activeDays, 2);
  // The window divisor stays the requested window, not the active days.
  assert.equal(summary.dailyAverage, 110 / 3);
});

test("buckets the entries by local calendar day", () => {
  const summary = summarizeUsage(
    [
      assistantEntry({
        timestamp: "2026-10-22T00:30:00Z",
        usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    ],
    { now: NOW, tzOffsetMinutes: -120 },
  );

  assert.deepStrictEqual(
    summary.days.map((day) => day.day),
    ["2026-10-21"],
  );
});

test("buckets the entries with the runtime local offset by default", () => {
  const localMidnight = new Date(2026, 9, 22, 0, 30).toISOString();

  const summary = summarizeUsage(
    [
      assistantEntry({
        timestamp: localMidnight,
        usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    ],
    { now: NOW },
  );

  assert.deepStrictEqual(
    summary.days.map((day) => day.day),
    ["2026-10-22"],
  );
});

test("reports the peak day, the active days and the daily average", () => {
  const summary = summarizeUsage(
    [
      assistantEntry({
        timestamp: "2026-10-20T10:00:00Z",
        usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      assistantEntry({
        timestamp: "2026-10-21T10:00:00Z",
        usage: { input: 500, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      assistantEntry({
        timestamp: "2026-10-22T10:00:00Z",
        usage: { input: 200, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    ],
    { now: NOW, windowDays: 10, tzOffsetMinutes: 0 },
  );

  assert.equal(summary.activeDays, 3);
  assert.equal(summary.peakDay?.day, "2026-10-21");
  assert.equal(summary.peakDay?.totalTokens, 500);
  assert.equal(summary.dailyAverage, 800 / 10);
});

test("reads the session entries from a directory tree and skips malformed lines", () => {
  const root = mkdtempSync(join(tmpdir(), "session-ledger-"));

  try {
    mkdirSync(join(root, "nested"), { recursive: true });
    writeFileSync(
      join(root, "a.jsonl"),
      [
        JSON.stringify({ type: "message", timestamp: "2026-10-20T10:00:00Z" }),
        "{ not json",
        JSON.stringify({ type: "message", timestamp: "2026-10-20T11:00:00Z" }),
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "nested", "b.jsonl"),
      JSON.stringify({ type: "message", timestamp: "2026-10-21T11:00:00Z" }),
      "utf8",
    );
    writeFileSync(join(root, "ignored.txt"), "not a session file", "utf8");

    const entries = readSessionEntries(root);

    assert.equal(entries.length, 3);
    assert.deepStrictEqual(entries, [
      { type: "message", timestamp: "2026-10-20T10:00:00Z" },
      { type: "message", timestamp: "2026-10-20T11:00:00Z" },
      { type: "message", timestamp: "2026-10-21T11:00:00Z" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("returns an empty list when the sessions directory does not exist", () => {
  const root = mkdtempSync(join(tmpdir(), "session-ledger-"));

  try {
    assert.deepStrictEqual(readSessionEntries(join(root, "missing")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prefers PI_CODING_AGENT_DIR over the home fallback", () => {
  assert.equal(
    resolveSessionsDir({ PI_CODING_AGENT_DIR: "/custom/agent" }, "/home/dev"),
    join("/custom/agent", "sessions"),
  );
});

test("falls back to home/.pi/agent when the env var is absent or empty", () => {
  assert.equal(resolveSessionsDir({}, "/home/dev"), join("/home/dev", ".pi", "agent", "sessions"));
  assert.equal(
    resolveSessionsDir({ PI_CODING_AGENT_DIR: "" }, "/home/dev"),
    join("/home/dev", ".pi", "agent", "sessions"),
  );
});
