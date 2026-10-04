# MiniMax usage source for Gentle Shell

## Objective

Show MiniMax Token Plan quota (5h and weekly windows) inside Gentle Shell's native
usage surfaces (Alt+U panel, sidebar Usage group, footer bar) by registering a
`gentle-pi:usage-source/v1` source for provider `minimax`. Install it locally as
version 0.0.1.

## Problem

Gentle Shell's `/usage` panel knows only openai-codex, anthropic and nan. With
MiniMax active it shows "no subscription usage for this provider".

## Why

The user's plan is the MiniMax Token Plan. Gentle Shell exposes a first-class
extension point for unknown providers, so the meter needs data only, no UI and
no gentle-pi edits.

## Scope

- In: pure parser, HTTP fetcher, Pi extension entry, tests, package manifest,
  local install copy at `~/.pi/agent/extensions/minimax-usage/` (v0.0.1).
- Out: npm publishing, standalone `setStatus` fallback, ack consumption (#1442),
  environment-variable key fallback.

## Constraints

- No imports from gentle-pi; literal channel and schema strings.
- No credential handling: the shell resolves the key via `getApiKeyForProvider`.
- Register only from `session_start` (Pi's event bus has no replay).
- One limit holding both windows (the footer bar draws a single limit).
- Tests run with `node --experimental-strip-types --test tests/*.test.ts` (Node 24).

## Verified contract (gentle-pi 3.7.0, Pi 1.0.0)

- `fetch(apiKey: string | undefined, fetchFn: typeof fetch, now: epochMs)`
  returns `Promise<ProviderUsage | undefined>` (`gentle-pi/lib/shell-usage.ts:154`).
- `parseProviderUsage` rejects the whole snapshot on any bad field: `provider`
  must match exactly, `limitReached` boolean, window `label` string,
  `windowSeconds` finite, `resetAt` epoch ms or null (`shell-usage.ts:204-253`).
- The shell already applies a 10 s abortable timeout and merges signals
  (`gentle-shell.ts:1536-1552`), so the fetcher adds no timeout of its own.
- Pi loads one-level subdirectories with a `package.json` `pi.extensions`
  manifest (`pi-coding-agent/dist/core/extensions/loader.js:588-655`).

## Acceptance criteria

- `/remains` payload `{ remaining 45% (5h), 94% (week) }` maps to used 55% and 6%.
- Invalid, error, or bucket-less payloads yield `undefined`, never a throw.
- Fetcher tries the primary endpoint, then the legacy path; any failure yields `undefined`.
- Extension emits the exact registration payload only on `session_start`.
- Manual: `/model` -> `minimax/MiniMax-M3.1-Flash-Preview` -> Alt+U shows a
  `minimax` meter with 5h and week windows.

## Delivery strategy

`exception-ok`: no pull request is planned; delivery is a local install copy.
Forecast about 450 authored changed lines, mostly tests.

## Tasks

- [x] T1 Parser `lib/parse-remains.ts` + `tests/parse-remains.test.ts` + fixtures (test-first). Route: delegated writer (writer trigger: 2+ non-trivial files).
- [x] T2 Fetcher `lib/fetch-remains.ts` + `tests/fetch-remains.test.ts` (test-first). Route: delegated writer.
- [x] T3 Extension `extensions/minimax-usage-source.ts` + test, `package.json` (v0.0.1), `tsconfig.json`, `README.md`. Route: delegated writer.
- [ ] T4 Copy to `~/.pi/agent/extensions/minimax-usage/` after all checks pass. Route: inline (mechanical copy).

## Applicable checks

- `npm test` (node test runner), `npm run typecheck` (tsc --noEmit).

## Progress

- Contract verification done by read-only explorer (see Verified contract).
- Branch `feat/minimax-usage-source` created (repo had no commits).
- T1 done: RED `ERR_MODULE_NOT_FOUND lib/parse-remains.ts`; GREEN `node --experimental-strip-types --test tests/*.test.ts` 8 pass / 0 fail (npm scripts arrive in T3).
- T2 done: RED `ERR_MODULE_NOT_FOUND lib/fetch-remains.ts` (8 pass / 1 fail); GREEN 15 pass / 0 fail.
- T3 done: RED `ERR_MODULE_NOT_FOUND extensions/minimax-usage-source.ts` (15 pass / 1 fail); GREEN `npm test` 19 pass / 0 fail, `npm run typecheck` exit 0 (tsc 5.9.3, `erasableSyntaxOnly` kept).

## Next step

T4.
