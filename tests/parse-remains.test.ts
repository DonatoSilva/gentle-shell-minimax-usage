import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyRemains, parseRemains } from "../lib/parse-remains.ts";

const NOW = 1_759_500_000_000;

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

function okBucket(): Record<string, unknown> {
  const body = fixture("remains-ok.json") as { model_remains: Record<string, unknown>[] };
  return { ...body.model_remains[0] };
}

function bodyWith(bucket: Record<string, unknown>): unknown {
  return { model_remains: [bucket], base_resp: { status_code: 0, status_msg: "success" } };
}

function bodyWithStatus(statusCode: number, statusMsg = "success"): unknown {
  return { model_remains: [], base_resp: { status_code: statusCode, status_msg: statusMsg } };
}

test("maps the real /remains payload to a ProviderUsage snapshot", () => {
  const usage = parseRemains(fixture("remains-ok.json"), NOW);

  assert.deepStrictEqual(usage, {
    provider: "minimax",
    limits: [
      {
        name: "general",
        limitReached: false,
        windows: [{ label: "5h", usedPercent: 55, windowSeconds: 18000, resetAt: NOW + 5100631 }],
      },
      {
        name: "general",
        limitReached: false,
        windows: [
          { label: "week", usedPercent: 6, windowSeconds: 604800, resetAt: NOW + 591900631 },
        ],
      },
    ],
    fetchedAt: NOW,
  });
  assert.equal(Object.hasOwn(usage ?? {}, "plan"), false);
});

test("returns undefined when there is no general bucket", () => {
  assert.equal(parseRemains(fixture("remains-no-general.json"), NOW), undefined);
});

test("returns undefined on a non-zero status code", () => {
  assert.equal(parseRemains(fixture("remains-error.json"), NOW), undefined);
});

test("returns undefined for non-object bodies", () => {
  for (const body of [null, [], "oops"]) {
    assert.equal(parseRemains(body, NOW), undefined);
  }
});

test("keeps only the 5h window when weekly fields are missing", () => {
  const bucket = okBucket();
  delete bucket.weekly_remains_time;
  delete bucket.current_weekly_remaining_percent;

  const usage = parseRemains(bodyWith(bucket), NOW);

  assert.deepStrictEqual(usage?.limits, [
    {
      name: "general",
      limitReached: false,
      windows: [{ label: "5h", usedPercent: 55, windowSeconds: 18000, resetAt: NOW + 5100631 }],
    },
  ]);
});

test("marks only the exhausted window's limit as reached", () => {
  const usage = parseRemains(bodyWith({ ...okBucket(), current_weekly_remaining_percent: 0 }), NOW);

  assert.equal(usage?.limits[0]?.limitReached, false);
  assert.equal(usage?.limits[1]?.limitReached, true);
});

test("marks the limit reached when nothing remains", () => {
  const usage = parseRemains(
    bodyWith({ ...okBucket(), current_interval_remaining_percent: 0 }),
    NOW,
  );

  assert.equal(usage?.limits[0]?.windows[0]?.usedPercent, 100);
  assert.equal(usage?.limits[0]?.limitReached, true);
});

test("clamps usedPercent at 0 when remaining exceeds 100", () => {
  const usage = parseRemains(
    bodyWith({ ...okBucket(), current_interval_remaining_percent: 120 }),
    NOW,
  );

  assert.equal(usage?.limits[0]?.windows[0]?.usedPercent, 0);
});

test("clamps a negative remains_time to resetAt = now", () => {
  const usage = parseRemains(bodyWith({ ...okBucket(), remains_time: -5000 }), NOW);

  assert.equal(usage?.limits[0]?.windows[0]?.resetAt, NOW);
});

test("classifies a successful payload with a general bucket as ok", () => {
  const body = fixture("remains-ok.json");
  const state = classifyRemains(body, NOW);

  assert.equal(state.kind, "ok");
  assert.deepStrictEqual(state, { kind: "ok", usage: parseRemains(body, NOW) });
});

test("classifies a valid call without a general bucket as no-plan", () => {
  assert.deepStrictEqual(classifyRemains(fixture("remains-no-general.json"), NOW), {
    kind: "no-plan",
  });
});

test("classifies status code 1004 as a missing credential", () => {
  assert.deepStrictEqual(classifyRemains(bodyWithStatus(1004, "no api key supplied"), NOW), {
    kind: "missing-credential",
  });
});

test("classifies status code 2049 as an invalid credential", () => {
  assert.deepStrictEqual(classifyRemains(fixture("remains-error.json"), NOW), {
    kind: "invalid-credential",
  });
});

test("classifies any other non-zero status code as unknown", () => {
  for (const statusCode of [1001, 1002, 2013, 5000]) {
    assert.deepStrictEqual(classifyRemains(bodyWithStatus(statusCode), NOW), { kind: "unknown" });
  }
});

test("classifies a malformed body as unknown", () => {
  const bodies: unknown[] = [
    null,
    [],
    "oops",
    42,
    {},
    { base_resp: "nope" },
    { base_resp: { status_msg: "success" }, model_remains: [] },
    { base_resp: { status_code: 0, status_msg: "success" }, model_remains: "nope" },
  ];

  for (const body of bodies) {
    assert.deepStrictEqual(classifyRemains(body, NOW), { kind: "unknown" });
  }
});

test("never reads the transport status as success: a zero status code is required", () => {
  assert.deepStrictEqual(
    classifyRemains({ model_remains: [okBucket()], base_resp: { status_msg: "success" } }, NOW),
    { kind: "unknown" },
  );
});

test("classifies a general bucket without usable windows as unknown", () => {
  const bucket = okBucket();
  delete bucket.remains_time;
  delete bucket.current_interval_remaining_percent;
  delete bucket.weekly_remains_time;
  delete bucket.current_weekly_remaining_percent;

  assert.deepStrictEqual(classifyRemains(bodyWith(bucket), NOW), { kind: "unknown" });
});
