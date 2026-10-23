// Framed box for the Pi views, mirroring the Gentle Shell usage panel.
//
// The frame is drawn from already painted lines, so the width helpers below
// are ANSI aware: escape sequences are copied verbatim and only the visible
// characters count. A naive `string.length` would count the escapes and clip
// the content too early.

import type { ViewTheme } from "./view-theme.ts";

export interface FrameOptions {
  title: string;
  hints?: string;
}

// eslint-disable-next-line no-control-regex -- the escape sequence is the pattern
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Visible width of a string, ignoring ANSI escape sequences. */
export function visibleWidth(text: string): number {
  return text.replace(ANSI_PATTERN, "").length;
}

/**
 * Truncates a painted string to `width` visible characters, keeping the ANSI
 * sequences intact and appending an ellipsis when something was cut.
 */
export function truncateVisible(text: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;

  let visible = 0;
  let cut = 0;
  let index = 0;
  while (index < text.length) {
    const escape = matchEscapeAt(text, index);
    if (escape) {
      index += escape.length;
      continue;
    }
    if (visible === width - 1) break;
    visible += 1;
    index += 1;
    cut = index;
  }

  const kept = text.slice(0, cut);
  const suffix = visibleWidth(text) > width ? "…" : "";
  // The reset closes the escape sequences the cut may have left open. A text
  // without escapes stays plain: appending a reset to it would leak ANSI into
  // a plain rendering.
  const reset = text.includes("\x1b") ? "\x1b[0m" : "";
  return `${kept}${suffix}${reset}`;
}

/**
 * Cuts a line to `width` visible characters, adding an ellipsis when it was
 * cut. A painted line keeps its escape sequences and is closed with a reset;
 * a plain line is cut as it is.
 */
export function fitVisible(text: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;
  if (!text.includes("\x1b")) {
    const characters = Array.from(text);
    return `${characters.slice(0, Math.max(0, width - 1)).join("")}…`;
  }
  return truncateVisible(text, width);
}

/** Pads a painted string to `width` visible characters. */
export function padVisible(text: string, width: number): string {
  const missing = width - visibleWidth(text);
  return missing > 0 ? text + " ".repeat(missing) : text;
}

/**
 * Draws the framed box the Gentle Shell usage panel uses:
 * `╭─ title ─╮`, `│ body │`, `│ hints │`, `╰──╯`.
 */
export function frameLines(
  body: readonly string[],
  theme: ViewTheme,
  width: number,
  options: FrameOptions,
): string[] {
  if (width <= 2) return [];

  const inner = width - 2;
  const content = inner - 2;
  const titleWidth = visibleWidth(options.title);
  const fill = Math.max(0, content - titleWidth - 1);

  const top = `${theme.border("╭─ ")}${theme.title(options.title)}${theme.border(` ${"─".repeat(fill)}╮`)}`;
  const rows = body.map((line) => `│ ${padVisible(truncateVisible(line, content), content)} │`);

  const lines = [top, ...rows];
  if (options.hints) {
    lines.push(`│ ${padVisible(truncateVisible(options.hints, content), content)} │`);
  }
  lines.push(theme.border(`╰${"─".repeat(inner)}╯`));

  return lines;
}

function matchEscapeAt(text: string, index: number): string | undefined {
  if (text[index] !== "\x1b") return undefined;
  // eslint-disable-next-line no-control-regex -- the escape sequence is the pattern
  const match = text.slice(index).match(/^\x1b\[[0-9;]*m/);
  return match?.[0];
}
