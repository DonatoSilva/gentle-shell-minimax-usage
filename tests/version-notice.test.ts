import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { FetchFn } from "../lib/fetch-remains.ts";
import {
  CHECK_INTERVAL_MS,
  REGISTRY_LATEST_URL,
  fetchLatestVersion,
  isNewerVersion,
  readPackageVersion,
} from "../lib/version-notice.ts";

/** A fetch that answers with a JSON body and counts its calls. */
function jsonFetch(body: unknown, calls: { count: number }): FetchFn {
  return (async () => {
    calls.count += 1;
    return { ok: true, json: async () => body } as Response;
  }) as FetchFn;
}

/** A fetch that answers with a non-OK response. */
function notOkFetch(calls: { count: number }): FetchFn {
  return (async () => {
    calls.count += 1;
    return { ok: false, json: async () => ({}) } as Response;
  }) as FetchFn;
}

/** A fetch that answers with a body that is not JSON. */
function brokenJsonFetch(calls: { count: number }): FetchFn {
  return (async () => {
    calls.count += 1;
    return {
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response;
  }) as FetchFn;
}

/** A fetch that fails with a network error. */
function failingFetch(calls: { count: number }): FetchFn {
  return (async () => {
    calls.count += 1;
    throw new Error("network down");
  }) as FetchFn;
}

test("the constants are the pinned ones", () => {
  assert.equal(REGISTRY_LATEST_URL, "https://registry.npmjs.org/gentle-shell-minimax-usage/latest");
  assert.equal(CHECK_INTERVAL_MS, 60 * 60 * 1000);
});

test("compares the versions segment by segment", () => {
  // The numeric segments are compared as numbers, not as text.
  assert.equal(isNewerVersion("1.9.0", "1.10.0"), true);
  assert.equal(isNewerVersion("1.10.0", "1.9.0"), false);
  assert.equal(isNewerVersion("0.4.9", "0.5.0"), true);
  assert.equal(isNewerVersion("0.5.0", "0.4.9"), false);
  // The same version is never newer.
  assert.equal(isNewerVersion("1.2.3", "1.2.3"), false);
  assert.equal(isNewerVersion("1.2.3", "1.2.4"), true);
  assert.equal(isNewerVersion("1.2.4", "1.2.3"), false);
  // A shorter version is not older than its own padding.
  assert.equal(isNewerVersion("1.2", "1.2.0"), false);
  assert.equal(isNewerVersion("1.2.0", "1.2"), false);
});

test("a garbage version is never newer", () => {
  assert.equal(isNewerVersion("", "1.0.0"), false);
  assert.equal(isNewerVersion("1.0.0", ""), false);
  assert.equal(isNewerVersion("   ", "1.0.0"), false);
  assert.equal(isNewerVersion("1.0.0", "   "), false);
  assert.equal(isNewerVersion("not-a-version", "1.0.0"), false);
  assert.equal(isNewerVersion("1.0.0", "not-a-version"), false);
  assert.equal(isNewerVersion("1..0", "1.0.1"), false);
  assert.equal(isNewerVersion("1.0.1", "1..0"), false);
});

test("reads the version of the installed package", () => {
  const expected = (
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    }
  ).version;

  assert.equal(readPackageVersion(), expected);
  assert.match(readPackageVersion() ?? "", /^\d+\.\d+\.\d+/);
});

test("the cache answers twice with one request", async () => {
  const calls = { count: 0 };
  const url = "https://registry.test/cache";
  const fetchFn = jsonFetch({ version: "2.0.0" }, calls);

  const first = await fetchLatestVersion(fetchFn, 1_000, { url });
  const second = await fetchLatestVersion(fetchFn, 2_000, { url });

  assert.equal(first, "2.0.0");
  assert.equal(second, "2.0.0");
  assert.equal(calls.count, 1);
});

test("the cache expires after the check interval", async () => {
  const calls = { count: 0 };
  const url = "https://registry.test/expire";
  const fetchFn = jsonFetch({ version: "2.0.0" }, calls);

  await fetchLatestVersion(fetchFn, 1_000, { url });
  await fetchLatestVersion(fetchFn, 1_000 + CHECK_INTERVAL_MS, { url });

  assert.equal(calls.count, 2);
});

test("a failure is cached too", async () => {
  const calls = { count: 0 };
  const url = "https://registry.test/failure";
  const fetchFn = failingFetch(calls);

  assert.equal(await fetchLatestVersion(fetchFn, 1_000, { url }), undefined);
  assert.equal(await fetchLatestVersion(fetchFn, 2_000, { url }), undefined);
  // A registry that is down does not produce a request on every refresh.
  assert.equal(calls.count, 1);
});

test("a non-OK answer yields undefined", async () => {
  const calls = { count: 0 };

  assert.equal(
    await fetchLatestVersion(notOkFetch(calls), 1_000, { url: "https://registry.test/not-ok" }),
    undefined,
  );
  assert.equal(calls.count, 1);
});

test("a body that is not JSON yields undefined", async () => {
  const calls = { count: 0 };

  assert.equal(
    await fetchLatestVersion(brokenJsonFetch(calls), 1_000, {
      url: "https://registry.test/broken",
    }),
    undefined,
  );
  assert.equal(calls.count, 1);
});

test("a body without a version yields undefined", async () => {
  const calls = { count: 0 };

  assert.equal(
    await fetchLatestVersion(jsonFetch({ name: "pkg" }, calls), 1_000, {
      url: "https://registry.test/no-version",
    }),
    undefined,
  );
  assert.equal(calls.count, 1);
});

test("the current version filters the answer", async () => {
  const calls = { count: 0 };
  const url = "https://registry.test/current";
  const fetchFn = jsonFetch({ version: "1.0.0" }, calls);

  // The registry has nothing newer: the answer is undefined.
  assert.equal(
    await fetchLatestVersion(fetchFn, 1_000, { url, currentVersion: "1.0.0" }),
    undefined,
  );
  // The same answer with an older current version: it is newer.
  assert.equal(await fetchLatestVersion(fetchFn, 2_000, { url, currentVersion: "0.9.0" }), "1.0.0");
  // The filter does not ask the registry again.
  assert.equal(calls.count, 1);
});
