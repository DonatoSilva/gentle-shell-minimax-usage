import { test } from "node:test";
import assert from "node:assert/strict";

import { matchViewKey } from "../lib/view-keys.ts";

test("reads the legacy encodings of the arrows", () => {
  assert.equal(matchViewKey("\x1b[A"), "up");
  assert.equal(matchViewKey("\x1b[B"), "down");
  assert.equal(matchViewKey("\x1b[C"), "right");
  assert.equal(matchViewKey("\x1b[D"), "left");
});

test("reads the application cursor encodings of the arrows", () => {
  assert.equal(matchViewKey("\x1bOA"), "up");
  assert.equal(matchViewKey("\x1bOB"), "down");
  assert.equal(matchViewKey("\x1bOC"), "right");
  assert.equal(matchViewKey("\x1bOD"), "left");
});

test("reads the kitty encodings of the arrows", () => {
  // Pi asks for the kitty keyboard protocol: the arrows arrive as
  // `CSI 1 ; modifiers final`.
  assert.equal(matchViewKey("\x1b[1;1A"), "up");
  assert.equal(matchViewKey("\x1b[1;1B"), "down");
  assert.equal(matchViewKey("\x1b[1;1C"), "right");
  assert.equal(matchViewKey("\x1b[1;1D"), "left");
  assert.equal(matchViewKey("\x1b[1;5D"), "left");
  assert.equal(matchViewKey("\x1b[1D"), "left");
});

test("reads the tab in both encodings", () => {
  assert.equal(matchViewKey("\t"), "tab");
  assert.equal(matchViewKey("\x1b[9u"), "tab");
  assert.equal(matchViewKey("\x1b[Z"), "shift+tab");
  assert.equal(matchViewKey("\x1b[9;2u"), "shift+tab");
});

test("reads the escape in both encodings", () => {
  assert.equal(matchViewKey("\x1b"), "escape");
  assert.equal(matchViewKey("\x1b[27u"), "escape");
  assert.equal(matchViewKey("\x1b[27;1u"), "escape");
});

test("ignores the keys that are not ours", () => {
  assert.equal(matchViewKey("a"), undefined);
  assert.equal(matchViewKey("1"), undefined);
  assert.equal(matchViewKey("\r"), undefined);
  assert.equal(matchViewKey("\x1b[200~"), undefined);
  assert.equal(matchViewKey(""), undefined);
});
