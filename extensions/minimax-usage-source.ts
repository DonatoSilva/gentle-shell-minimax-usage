// Registers MiniMax as a Gentle Shell usage source and, when the standalone
// surface is active, writes the quota to Pi's own status line. Returns data
// only: meters, thresholds, countdowns and visibility are rendered by the shell.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import {
  createMinimaxCommands,
  DETAILS_COMMAND,
  USAGE_COMMAND,
  type CommandRegistrationOptions,
} from "../lib/commands.ts";
import { fetchRemains, type FetchFn } from "../lib/fetch-remains.ts";
import type { ProviderUsage } from "../lib/parse-remains.ts";
import {
  detectGentleShell,
  decideSurface,
  parseUsageMode,
  type UsageMode,
} from "../lib/usage-mode.ts";
import {
  STATUS_KEY,
  STATUS_NO_DATA,
  STATUS_NO_KEY,
  formatUsageStatus,
  resolveApiKey,
} from "../lib/standalone-status.ts";
import { fetchLatestVersion, readPackageVersion } from "../lib/version-notice.ts";

// Literal contract strings: gentle-pi exposes no `main`/`exports` to import.
const CHANNEL = "gentle-pi:usage-source/v1";
const SCHEMA = "gentle-pi.usage-source/v1";
const PROVIDER = "minimax";

// Standalone bound: the shell applies its own 10 s abort; this path must not
// hang either, or a stalled request leaks a pending status forever.
const STATUS_TIMEOUT_MS = 10_000;

// Minimal structural slice of Pi's extension API this file relies on.
export interface ExtensionCtx {
  mode?: string;
  ui?: { setStatus(key: string, text: string | undefined): void };
}

interface PiExtensionApi {
  events: { emit(channel: string, data: unknown): void };
  on(
    event: "session_start" | "agent_settled",
    handler: (event: unknown, ctx?: ExtensionCtx) => void,
  ): void;
  registerCommand?(name: string, options: CommandRegistrationOptions): void;
}

export interface UsageRuntime {
  env: Record<string, string | undefined>;
  home: string;
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  fetchFn: FetchFn;
  now: () => number;
}

export default function minimaxUsageSource(
  pi: PiExtensionApi,
  runtime?: Partial<UsageRuntime>,
): void {
  const rt: UsageRuntime = {
    env: runtime?.env ?? process.env,
    home: runtime?.home ?? homedir(),
    exists: runtime?.exists ?? ((path: string) => existsSync(path)),
    readFile: runtime?.readFile ?? ((path: string) => readFileSync(path, "utf8")),
    fetchFn: runtime?.fetchFn ?? fetch,
    now: runtime?.now ?? Date.now,
  };

  // Resolve the switch once: env, detection and surface are factory-time facts.
  const mode: UsageMode = parseUsageMode(rt.env.MINIMAX_USAGE_MODE);
  const shellPresent = detectGentleShell({ env: rt.env, home: rt.home, exists: rt.exists });
  const surface = decideSurface(mode, shellPresent);

  const commands = createMinimaxCommands(rt);
  // `off` turns the extension off entirely: no source, no status, no commands.
  if (surface.registerSource && typeof pi.registerCommand === "function") {
    pi.registerCommand(USAGE_COMMAND, commands.usage);
    pi.registerCommand(DETAILS_COMMAND, commands.details);
  }

  const register = (): void => {
    pi.events.emit(CHANNEL, {
      schema: SCHEMA,
      provider: PROVIDER,
      pendingNote: "no usage yet · r to fetch",
      fetch: (apiKey: string | undefined, fetchFn: FetchFn, now: number) =>
        fetchRemains(apiKey, fetchFn, now),
    });
  };

  // The last usage the status was painted with, and the version the notice
  // announces: the check of the registry answers later and the status is
  // written again with the notice.
  let lastUsage: ProviderUsage | undefined;
  let notice: string | undefined;

  const refreshStatus = (_event: unknown, ctx?: ExtensionCtx): void => {
    try {
      if (ctx?.mode === "print" || ctx?.mode === "json") return;

      const apiKey = resolveApiKey({ env: rt.env, home: rt.home, readFile: rt.readFile });
      if (!apiKey) {
        ctx?.ui?.setStatus(STATUS_KEY, STATUS_NO_KEY);
        return;
      }

      const boundFetch: FetchFn = (url, init) =>
        rt.fetchFn(url, { ...init, signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });

      void fetchRemains(apiKey, boundFetch, rt.now())
        .then((usage) => {
          lastUsage = usage;
          ctx?.ui?.setStatus(STATUS_KEY, formatUsageStatus(usage, notice) ?? STATUS_NO_DATA);
          // The check of the registry never blocks the status: the status is
          // already written, and the check answers later.
          void announceNewerVersion(rt, ctx, (version) => {
            notice = version;
            ctx?.ui?.setStatus(STATUS_KEY, formatUsageStatus(lastUsage, notice) ?? STATUS_NO_DATA);
          });
        })
        .catch(() => {
          ctx?.ui?.setStatus(STATUS_KEY, STATUS_NO_DATA);
        });
    } catch {
      // No status write is ever worth crashing the session over.
      ctx?.ui?.setStatus(STATUS_KEY, STATUS_NO_DATA);
    }
  };

  if (surface.registerSource) {
    register();
    pi.on("session_start", register);
  }

  if (surface.standaloneStatus) {
    pi.on("session_start", refreshStatus);
    pi.on("agent_settled", refreshStatus);
  }
}

/**
 * Asks the registry for a newer published version and announces it.
 *
 * The check never blocks the status and never throws: a registry that is
 * down, a missing package.json or an answer that is not newer all end
 * without a notice, and the status stays as it is.
 */
async function announceNewerVersion(
  rt: UsageRuntime,
  ctx: ExtensionCtx | undefined,
  announce: (version: string) => void,
): Promise<void> {
  try {
    const currentVersion = readPackageVersion();
    if (!currentVersion) return;

    const boundFetch: FetchFn = (url, init) =>
      rt.fetchFn(url, { ...init, signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
    const latest = await fetchLatestVersion(boundFetch, rt.now(), { currentVersion });
    if (!latest) return;
    announce(latest);
  } catch {
    // A notice is never worth an exception.
  }
}
