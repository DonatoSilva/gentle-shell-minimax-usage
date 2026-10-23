// The notice of a newer published version.
//
// The extension reads its own version from the package.json that sits next to
// it and asks the npm registry for the latest published one. The check never
// blocks the status and never throws: a registry that is down, a malformed
// answer or a missing file all end in `undefined`, and the answer is cached
// for an hour so a broken registry does not produce a request on every
// refresh.
//
// The module has no dependency of its own: the transport is injected by the
// caller, and the clock comes with it, so the renderer and the notice stay
// pure and deterministic.

import { readFileSync } from "node:fs";

import type { FetchFn } from "./fetch-remains.ts";

/** The registry endpoint that answers with the latest published version. */
export const REGISTRY_LATEST_URL = "https://registry.npmjs.org/gentle-shell-minimax-usage/latest";

/** How long the answer of the registry is kept: one hour. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** The package.json of the installed package, next to this module. */
const PACKAGE_URL = new URL("../package.json", import.meta.url);

/**
 * The version of the installed package, read from its package.json.
 *
 * A missing or unreadable file returns `undefined`, never throws.
 */
export function readPackageVersion(): string | undefined {
  try {
    const raw = readFileSync(PACKAGE_URL, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    const version = parsed?.version;
    return typeof version === "string" && version.trim() ? version.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when `latest` is newer than `current`.
 *
 * The versions are compared segment by segment: `1.10.0` is newer than
 * `1.9.0` and `0.5.0` is newer than `0.4.9`. A segment that is not a number
 * is compared as a string. An empty or unparsable version is never newer.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const currentSegments = parseVersion(current);
  const latestSegments = parseVersion(latest);
  if (!currentSegments || !latestSegments) return false;

  const length = Math.max(currentSegments.length, latestSegments.length);
  for (let index = 0; index < length; index += 1) {
    // A version without a segment is shorter: it is padded with a zero, so
    // `1.2` and `1.2.0` are the same version.
    const currentSegment = currentSegments[index] ?? "0";
    const latestSegment = latestSegments[index] ?? "0";
    const compared = compareSegments(currentSegment, latestSegment);
    if (compared !== 0) return compared < 0;
  }
  return false;
}

/**
 * The latest published version, or `undefined` when the registry cannot be
 * reached.
 *
 * The answer is cached in memory for `CHECK_INTERVAL_MS` (the cache holds
 * both the successful answer and the failure) and the cache is per module, not
 * per caller. When `options.currentVersion` is given and the registry has
 * nothing newer, the result is `undefined`.
 *
 * The check never throws.
 */
export async function fetchLatestVersion(
  fetchFn: FetchFn,
  now: number,
  options?: { url?: string; currentVersion?: string },
): Promise<string | undefined> {
  const url = options?.url ?? REGISTRY_LATEST_URL;
  const cached = cache.get(url);
  // An answer stored in the future (a clock that went backwards) is not
  // trusted: the registry is asked again.
  const age = cached ? now - cached.at : Number.POSITIVE_INFINITY;
  if (cached && age >= 0 && age < CHECK_INTERVAL_MS) {
    return announced(cached.version, options?.currentVersion);
  }

  const version = await requestLatest(url, fetchFn);
  cache.set(url, { at: now, version });
  return announced(version, options?.currentVersion);
}

/** An answer of the registry, with the moment it was stored. */
interface CachedAnswer {
  /** The clock of the call that stored the answer. */
  at: number;
  /** The version of the registry, or `undefined` when it did not answer. */
  version: string | undefined;
}

/** The cache of the registry: per module, and per URL. */
const cache = new Map<string, CachedAnswer>();

/**
 * The version to announce: the one of the registry when it is newer than the
 * installed one, and nothing otherwise.
 */
function announced(
  version: string | undefined,
  currentVersion: string | undefined,
): string | undefined {
  if (!version) return undefined;
  if (currentVersion === undefined) return version;
  return isNewerVersion(currentVersion, version) ? version : undefined;
}

/**
 * Asks the registry for the latest published version.
 *
 * A non-OK response, a network error, a body that is not JSON or a body
 * without a `version` field all yield `undefined`, never an exception.
 */
async function requestLatest(url: string, fetchFn: FetchFn): Promise<string | undefined> {
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response || !response.ok) return undefined;
    const body = (await response.json()) as { version?: unknown } | null;
    const version = body?.version;
    return typeof version === "string" && version.trim() ? version.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The segments of a version, or `undefined` when it is not one.
 *
 * A version is a dotted list of segments whose first one is a number: the
 * rest may carry a pre-release suffix, which is compared as a string.
 */
function parseVersion(version: string): string[] | undefined {
  const trimmed = version.trim();
  if (!trimmed) return undefined;
  const segments = trimmed.split(".").map((segment) => segment.trim());
  if (segments.some((segment) => segment === "")) return undefined;
  if (!isNumeric(segments[0] ?? "")) return undefined;
  return segments;
}

/** Whether a segment is a number. */
function isNumeric(segment: string): boolean {
  return /^\d+$/.test(segment);
}

/**
 * Compares two segments: as numbers when both of them are numbers, and as
 * strings otherwise.
 */
function compareSegments(current: string, latest: string): number {
  if (isNumeric(current) && isNumeric(latest)) {
    const currentValue = Number(current);
    const latestValue = Number(latest);
    if (currentValue === latestValue) return 0;
    return currentValue < latestValue ? -1 : 1;
  }
  if (current === latest) return 0;
  return current < latest ? -1 : 1;
}
