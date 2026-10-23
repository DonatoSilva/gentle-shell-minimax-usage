// The keys the views answer to.
//
// Pi asks the terminal for the kitty keyboard protocol (flags 7: disambiguate
// plus event types and alternate keys), so a terminal that answers the query
// sends the keys in the kitty encoding: the arrows as `CSI 1 ; modifiers A`
// and the tab as `CSI 9 u`. Matching raw bytes only would answer to the
// legacy encoding and stay deaf to the kitty one.
//
// The legacy encodings are still accepted: a terminal that does not answer
// the kitty query keeps sending them, and so does a terminal that never
// enabled the protocol.

export type ViewKey = "left" | "right" | "up" | "down" | "tab" | "shift+tab" | "escape";

// Kitty functional keys: the arrows, as `CSI 1 ; modifiers final`.
// Kitty keys with a code point: `CSI code point ; modifiers u`.
/* eslint-disable no-control-regex -- the escape sequence is the pattern */
const KITTY_FUNCTIONAL = /^\x1b\[1(?:;(\d+))?([ABCD])$/;
const KITTY_UNICODE = /^\x1b\[(\d+)(?:;(\d+))?(?::\d+)*u$/;
/* eslint-enable no-control-regex */

const TAB_CODEPOINT = 9;
const ESCAPE_CODEPOINT = 27;

/** The key the data carries, or `undefined` when it is not one of ours. */
export function matchViewKey(data: string): ViewKey | undefined {
  switch (data) {
    case "\x1b[A":
    case "\x1bOA":
      return "up";
    case "\x1b[B":
    case "\x1bOB":
      return "down";
    case "\x1b[C":
    case "\x1bOC":
      return "right";
    case "\x1b[D":
    case "\x1bOD":
      return "left";
    case "\t":
      return "tab";
    case "\x1b[Z":
      return "shift+tab";
    case "\x1b":
      return "escape";
  }

  const functional = KITTY_FUNCTIONAL.exec(data);
  if (functional) {
    switch (functional[2]) {
      case "A":
        return "up";
      case "B":
        return "down";
      case "C":
        return "right";
      case "D":
        return "left";
    }
  }

  const unicode = KITTY_UNICODE.exec(data);
  if (unicode) {
    const code = Number(unicode[1]);
    const modifiers = Number(unicode[2] ?? "1");
    // The modifier value is one plus the bit mask: shift is the low bit.
    const shift = ((modifiers - 1) & 1) === 1;
    if (code === TAB_CODEPOINT) return shift ? "shift+tab" : "tab";
    if (code === ESCAPE_CODEPOINT) return "escape";
  }

  return undefined;
}
