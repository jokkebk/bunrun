import { test, expect } from "bun:test";
import {
  parseEnv,
  serializeEnv,
  setEnvValue,
  toggleEnvComment,
  addEnvKey,
  deleteEnvKey,
  renameEnvKey,
} from "./envFile.js";

function roundTrip(src: string): string {
  return serializeEnv(parseEnv(src));
}

test("round-trip preserves a corpus of .env files", () => {
  const cases = [
    "",
    "FOO=bar\n",
    "FOO=bar\nBAZ=qux\n",
    "# comment\nFOO=bar\n",
    "# disabled key\n#FOO=bar\nACTIVE=ok\n",
    'FOO="quoted value with #hash"\n',
    "FOO='single quoted'\n",
    "FOO=value # trailing note\n",
    "\n\nFOO=bar\n\n",
    "  FOO=bar\n",
    "export FOO=bar\n",
    "FOO=bar\r\nBAZ=qux\r\n",
    "WEIRD=line that is not kv\nFOO=bar\n",
    'KEY="val \\"esc\\""\n',
    "KEY=value with spaces unquoted\n",
  ];
  for (const c of cases) {
    expect(roundTrip(c)).toBe(c);
  }
});

test("setEnvValue modifies only target line", () => {
  const lines = parseEnv("# header\nFOO=bar\nBAZ=qux\n");
  setEnvValue(lines, "FOO", "new");
  expect(serializeEnv(lines)).toBe("# header\nFOO=new\nBAZ=qux\n");
});

test("setEnvValue quotes when needed", () => {
  const lines = parseEnv("FOO=bar\n");
  setEnvValue(lines, "FOO", "has # hash");
  expect(serializeEnv(lines)).toBe('FOO="has # hash"\n');
});

test("toggleEnvComment switches a key on and off", () => {
  const lines = parseEnv("FOO=bar\nBAZ=qux\n");
  toggleEnvComment(lines, "FOO");
  expect(serializeEnv(lines)).toBe("#FOO=bar\nBAZ=qux\n");
  toggleEnvComment(lines, "FOO");
  expect(serializeEnv(lines)).toBe("FOO=bar\nBAZ=qux\n");
});

test("addEnvKey appends with separating blank line", () => {
  const lines = parseEnv("FOO=bar\n");
  addEnvKey(lines, "NEW", "v");
  expect(serializeEnv(lines)).toBe("FOO=bar\n\nNEW=v\n");
});

test("addEnvKey reuses existing line (no duplicate)", () => {
  const lines = parseEnv("FOO=bar\n");
  addEnvKey(lines, "FOO", " updated ");
  expect(serializeEnv(lines)).toBe('FOO=" updated "\n');
});

test("deleteEnvKey removes only target", () => {
  const lines = parseEnv("FOO=bar\nBAZ=qux\n");
  deleteEnvKey(lines, "FOO");
  expect(serializeEnv(lines)).toBe("BAZ=qux\n");
});

test("renameEnvKey marks dirty so serialize emits new key", () => {
  const lines = parseEnv("FOO=bar\n");
  renameEnvKey(lines, "FOO", "BAR");
  expect(serializeEnv(lines)).toBe("BAR=bar\n");
});

test("disabled kv parses key/value", () => {
  const lines = parseEnv("#FOO=bar\n");
  const l = lines[0];
  expect(l.kind).toBe("kv");
  if (l.kind === "kv") {
    expect(l.key).toBe("FOO");
    expect(l.value).toBe("bar");
    expect(l.disabled).toBe(true);
  }
});

test("doc comment vs disabled kv distinguishes", () => {
  const lines = parseEnv("# just a note\n#FOO=bar\n");
  expect(lines[0].kind).toBe("doc-comment");
  expect(lines[1].kind).toBe("kv");
  if (lines[1].kind === "kv") expect(lines[1].disabled).toBe(true);
});

test("inline trailing comment preserved round-trip", () => {
  const src = "FOO=bar # note\n";
  expect(roundTrip(src)).toBe(src);
});

test("value containing equals gets quoted", () => {
  const lines = parseEnv("FOO=bar\n");
  setEnvValue(lines, "FOO", "a=b");
  expect(serializeEnv(lines)).toBe('FOO="a=b"\n');
});
