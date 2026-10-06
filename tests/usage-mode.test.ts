import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_USAGE_MODE,
  decideSurface,
  detectGentleShell,
  parseUsageMode,
} from "../lib/usage-mode.ts";

const HOME = "/home/tester";

const AGENT_PROBE = "/home/tester/.pi/agent/npm/node_modules/gentle-pi/package.json";
const PACKAGE_PROBE = "/pkg/node_modules/gentle-pi/package.json";
const NPM_PROBE = "/home/tester/.pi/npm/node_modules/gentle-pi/package.json";

test("parseUsageMode accepts the four exact values", () => {
  assert.equal(parseUsageMode("auto"), "auto");
  assert.equal(parseUsageMode("status"), "status");
  assert.equal(parseUsageMode("off"), "off");
  assert.equal(parseUsageMode("shell"), "shell");
});

test("parseUsageMode trims and lowercases before matching", () => {
  assert.equal(parseUsageMode("  STATUS "), "status");
  assert.equal(parseUsageMode("Off"), "off");
  assert.equal(parseUsageMode("\tSHELL\n"), "shell");
});

test("parseUsageMode falls back to auto on junk, empty and undefined", () => {
  assert.equal(parseUsageMode(undefined), "auto");
  assert.equal(parseUsageMode(""), "auto");
  assert.equal(parseUsageMode("   "), "auto");
  assert.equal(parseUsageMode("junk"), "auto");
  assert.equal(parseUsageMode("AUTO "), "auto");
});

test("DEFAULT_USAGE_MODE is auto", () => {
  assert.equal(DEFAULT_USAGE_MODE, "auto");
});

test("detectGentleShell probes PI_CODING_AGENT_DIR when set", () => {
  const seen: string[] = [];
  const found = detectGentleShell({
    env: { PI_CODING_AGENT_DIR: "/custom-agent" },
    home: HOME,
    exists: (path) => {
      seen.push(path);
      return path === "/custom-agent/npm/node_modules/gentle-pi/package.json";
    },
  });
  assert.equal(found, true);
  assert.ok(seen.includes("/custom-agent/npm/node_modules/gentle-pi/package.json"));
});

test("detectGentleShell probes PI_PACKAGE_DIR when non-empty", () => {
  const found = detectGentleShell({
    env: { PI_PACKAGE_DIR: "/pkg" },
    home: HOME,
    exists: (path) => path === PACKAGE_PROBE,
  });
  assert.equal(found, true);
});

test("detectGentleShell probes the default agent dir without env overrides", () => {
  const found = detectGentleShell({
    env: {},
    home: HOME,
    exists: (path) => path === AGENT_PROBE,
  });
  assert.equal(found, true);
});

test("detectGentleShell falls back to ~/.pi/npm", () => {
  const found = detectGentleShell({
    env: {},
    home: HOME,
    exists: (path) => path === NPM_PROBE,
  });
  assert.equal(found, true);
});

test("detectGentleShell returns false when no probe path exists", () => {
  const found = detectGentleShell({ env: {}, home: HOME, exists: () => false });
  assert.equal(found, false);
});

test("detectGentleShell treats a throwing exists as absent and never throws", () => {
  assert.equal(
    detectGentleShell({
      env: {},
      home: HOME,
      exists: () => {
        throw new Error("boom");
      },
    }),
    false,
  );
  // Throws only for the first path: later probes still decide the result.
  let calls = 0;
  assert.equal(
    detectGentleShell({
      env: {},
      home: HOME,
      exists: (path) => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return path === NPM_PROBE;
      },
    }),
    true,
  );
});

test("decideSurface matches the switch table for all eight combinations", () => {
  assert.deepStrictEqual(decideSurface("auto", false), {
    registerSource: true,
    standaloneStatus: true,
  });
  assert.deepStrictEqual(decideSurface("auto", true), {
    registerSource: true,
    standaloneStatus: false,
  });
  assert.deepStrictEqual(decideSurface("status", false), {
    registerSource: true,
    standaloneStatus: true,
  });
  assert.deepStrictEqual(decideSurface("status", true), {
    registerSource: true,
    standaloneStatus: true,
  });
  assert.deepStrictEqual(decideSurface("shell", false), {
    registerSource: true,
    standaloneStatus: false,
  });
  assert.deepStrictEqual(decideSurface("shell", true), {
    registerSource: true,
    standaloneStatus: false,
  });
  assert.deepStrictEqual(decideSurface("off", false), {
    registerSource: false,
    standaloneStatus: false,
  });
  assert.deepStrictEqual(decideSurface("off", true), {
    registerSource: false,
    standaloneStatus: false,
  });
});
