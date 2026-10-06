// Pure usage-mode switch: parsing, shell detection and surface decision.
// No I/O: the caller supplies env, home and an exists probe.

export type UsageMode = "auto" | "status" | "off" | "shell";

export const DEFAULT_USAGE_MODE: UsageMode = "auto";

const MODES: readonly UsageMode[] = ["auto", "status", "off", "shell"];

export function parseUsageMode(raw: string | undefined): UsageMode {
  const value = raw?.trim().toLowerCase();
  return MODES.includes(value as UsageMode) ? (value as UsageMode) : DEFAULT_USAGE_MODE;
}

export interface ShellDetectionInput {
  env: Record<string, string | undefined>;
  home: string;
  exists: (path: string) => boolean;
}

const AGENT_PACKAGE = "npm/node_modules/gentle-pi/package.json";
const PACKAGE_PACKAGE = "node_modules/gentle-pi/package.json";

export function detectGentleShell(input: ShellDetectionInput): boolean {
  const { env, home, exists } = input;
  const agentDir = env.PI_CODING_AGENT_DIR ?? `${home}/.pi/agent`;
  const probes = [`${agentDir}/${AGENT_PACKAGE}`];
  if (env.PI_PACKAGE_DIR) probes.push(`${env.PI_PACKAGE_DIR}/${PACKAGE_PACKAGE}`);
  probes.push(`${home}/.pi/${AGENT_PACKAGE}`);

  for (const probe of probes) {
    try {
      if (exists(probe)) return true;
    } catch {
      // A failing probe path counts as absent; detection never throws.
    }
  }
  return false;
}

export interface UsageSurface {
  registerSource: boolean;
  standaloneStatus: boolean;
}

export function decideSurface(mode: UsageMode, shellPresent: boolean): UsageSurface {
  switch (mode) {
    case "off":
      return { registerSource: false, standaloneStatus: false };
    case "status":
      return { registerSource: true, standaloneStatus: true };
    case "shell":
      return { registerSource: true, standaloneStatus: false };
    case "auto":
      return { registerSource: true, standaloneStatus: !shellPresent };
  }
}
