import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseRemains, type ProviderUsage } from "../lib/parse-remains.ts";
import {
  STATUS_KEY,
  STATUS_NO_DATA,
  STATUS_NO_KEY,
  formatUsageStatus,
  resolveApiKey,
} from "../lib/standalone-status.ts";

const NOW = 1_759_500_000_000;
const HOME = "/home/tester";
const AUTH_PATH = `${HOME}/.pi/agent/auth.json`;

function loadOkFixture(): unknown {
  return JSON.parse(
    readFileSync(new URL("./fixtures/remains-ok.json", import.meta.url), "utf8"),
  ) as unknown;
}

test("STATUS constants are the pinned strings", () => {
  assert.equal(STATUS_KEY, "minimax-usage");
  assert.equal(STATUS_NO_KEY, "MM: sin API key");
  assert.equal(STATUS_NO_DATA, "MM: sin datos");
});

test("formatUsageStatus renders the first window of each limit", () => {
  const usage = parseRemains(loadOkFixture(), NOW);
  assert.ok(usage);
  assert.equal(formatUsageStatus(usage), "MM 5h 55% · week 6%");
});

test("formatUsageStatus rounds fractional percents", () => {
  const usage: ProviderUsage = {
    provider: "minimax",
    limits: [
      {
        name: "general",
        limitReached: false,
        windows: [{ label: "5h", usedPercent: 44.6, windowSeconds: 18000, resetAt: NOW }],
      },
    ],
    fetchedAt: NOW,
  };
  assert.equal(formatUsageStatus(usage), "MM 5h 45%");
});

test("formatUsageStatus without a notice is exactly the current text", () => {
  const usage = parseRemains(loadOkFixture(), NOW);
  assert.ok(usage);
  assert.equal(formatUsageStatus(usage), "MM 5h 55% · week 6%");
  assert.equal(formatUsageStatus(usage, undefined), "MM 5h 55% · week 6%");
});

test("formatUsageStatus appends the notice of a newer version", () => {
  const usage = parseRemains(loadOkFixture(), NOW);
  assert.ok(usage);
  assert.equal(formatUsageStatus(usage, "0.6.0"), "MM 5h 55% · week 6% · new 0.6.0");
});

test("formatUsageStatus returns undefined without usage or windows", () => {
  assert.equal(formatUsageStatus(undefined), undefined);
  const windowless: ProviderUsage = {
    provider: "minimax",
    limits: [{ name: "general", limitReached: false, windows: [] }],
    fetchedAt: NOW,
  };
  assert.equal(formatUsageStatus(windowless), undefined);
});

test("formatUsageStatus returns undefined without usage, even with a notice", () => {
  assert.equal(formatUsageStatus(undefined, "0.6.0"), undefined);
});

test("resolveApiKey prefers a non-empty MINIMAX_API_KEY over auth.json", () => {
  const key = resolveApiKey({
    env: { MINIMAX_API_KEY: "env-key" },
    home: HOME,
    readFile: () => '{"minimax":{"key":"file-key"}}',
  });
  assert.equal(key, "env-key");
});

test("resolveApiKey falls back to minimax.key in the agent auth.json", () => {
  const key = resolveApiKey({
    env: {},
    home: HOME,
    readFile: (path) => {
      assert.equal(path, AUTH_PATH);
      return JSON.stringify({ minimax: { key: "file-key" } });
    },
  });
  assert.equal(key, "file-key");
});

test("resolveApiKey uses PI_CODING_AGENT_DIR for auth.json when set", () => {
  const key = resolveApiKey({
    env: { PI_CODING_AGENT_DIR: "/custom-agent" },
    home: HOME,
    readFile: (path) => {
      assert.equal(path, "/custom-agent/auth.json");
      return '{"minimax":{"key":"file-key"}}';
    },
  });
  assert.equal(key, "file-key");
});

test("resolveApiKey lets a whitespace-only env value fall through", () => {
  const key = resolveApiKey({
    env: { MINIMAX_API_KEY: "   " },
    home: HOME,
    readFile: () => '{"minimax":{"key":"file-key"}}',
  });
  assert.equal(key, "file-key");
});

test("resolveApiKey trims the resolved key", () => {
  const key = resolveApiKey({
    env: { MINIMAX_API_KEY: "  padded  " },
    home: HOME,
    readFile: () => {
      throw new Error("should not be read");
    },
  });
  assert.equal(key, "padded");
});

test("resolveApiKey returns undefined on unreadable, malformed or key-less auth.json", () => {
  const base = { env: {} as Record<string, string | undefined>, home: HOME };
  assert.equal(
    resolveApiKey({
      ...base,
      readFile: () => {
        throw new Error("ENOENT");
      },
    }),
    undefined,
  );
  assert.equal(resolveApiKey({ ...base, readFile: () => "not json" }), undefined);
  assert.equal(resolveApiKey({ ...base, readFile: () => "{}" }), undefined);
  assert.equal(resolveApiKey({ ...base, readFile: () => '{"minimax":{}}' }), undefined);
  assert.equal(resolveApiKey({ ...base, readFile: () => '{"minimax":{"key":42}}' }), undefined);
  assert.equal(resolveApiKey({ ...base, readFile: () => '{"minimax":{"key":"  "}}' }), undefined);
});
