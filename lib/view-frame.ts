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

/**
 * The range of the emoji that occupy two terminal cells.
 *
 * The MiniMax mark (`🐙`) is one of them: a title padded with a one cell
 * count would leave the frame one column short.
 */
const WIDE_FIRST = 0x1f300;
const WIDE_LAST = 0x1faff;

/** Whether a code point occupies two terminal cells. */
function isWide(codePoint: number): boolean {
  return codePoint >= WIDE_FIRST && codePoint <= WIDE_LAST;
}

/** Visible width of a string, ignoring ANSI escape sequences. */
export function visibleWidth(text: string): number {
  const plain = text.replace(ANSI_PATTERN, "");
  let width = 0;
  for (const character of plain) {
    width += isWide(character.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

/**
 * Truncates a painted string to `width` visible characters, keeping the ANSI
 * sequences intact and appending an ellipsis when something was cut.
 *
 * A wide glyph is never cut in half: when it does not fit in the last cell
 * it is dropped whole and the ellipsis takes its place.
 */
export function truncateVisible(text: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;

  // One cell is reserved for the ellipsis.
  const limit = Math.max(0, width - 1);
  let visible = 0;
  let cut = 0;
  let index = 0;
  while (index < text.length) {
    const escape = matchEscapeAt(text, index);
    if (escape) {
      index += escape.length;
      continue;
    }
    const codePoint = text.codePointAt(index) ?? 0;
    const cells = isWide(codePoint) ? 2 : 1;
    // The glyph does not fit: it is dropped whole, never cut in half.
    if (visible + cells > limit) break;
    visible += cells;
    index += codePoint > 0xffff ? 2 : 1;
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
