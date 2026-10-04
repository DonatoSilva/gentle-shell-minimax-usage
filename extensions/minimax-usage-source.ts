// Registers MiniMax as a Gentle Shell usage source. Returns data only:
// meters, thresholds, countdowns and visibility are rendered by the shell.

import { fetchRemains, type FetchFn } from "../lib/fetch-remains.ts";

// Literal contract strings: gentle-pi exposes no `main`/`exports` to import.
const CHANNEL = "gentle-pi:usage-source/v1";
const SCHEMA = "gentle-pi.usage-source/v1";
const PROVIDER = "minimax";

// Minimal structural slice of Pi's extension API this file relies on.
interface PiExtensionApi {
  events: { emit(channel: string, data: unknown): void };
  on(event: "session_start", handler: () => void): void;
}

export default function minimaxUsageSource(pi: PiExtensionApi): void {
  const register = (): void => {
    pi.events.emit(CHANNEL, {
      schema: SCHEMA,
      provider: PROVIDER,
      pendingNote: "no usage yet · r to fetch",
      fetch: (apiKey: string | undefined, fetchFn: FetchFn, now: number) =>
        fetchRemains(apiKey, fetchFn, now),
    });
  };

  register();
  pi.on("session_start", register);
}
