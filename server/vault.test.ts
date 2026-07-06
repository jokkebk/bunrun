import { test, expect } from "bun:test";
import { parseVaultYaml, serializeVaultYaml } from "./vault.js";

test("vault round-trip", () => {
  const entries = [
    {
      id: "abc",
      label: "Corp OpenAI",
      value: "sk-corp-123",
      owner: "corporate",
      provider: "OpenAI",
      defaultVarName: "OPENAI_API_KEY",
    },
    {
      id: "def",
      label: "Personal Anthropic",
      value: "sk-ant-xyz",
      owner: "personal",
      provider: "Anthropic",
      defaultVarName: null,
    },
  ];
  const yaml = serializeVaultYaml(entries);
  const parsed = parseVaultYaml(yaml);
  expect(parsed).toEqual(entries);
});

test("vault filters incomplete entries", () => {
  const yaml = [
    "- id: a",
    "  label: Foo",
    "  value: bar",
    "  owner: null",
    "  provider: null",
    "  defaultVarName: null",
    "- id: b",
    "  label: ''",
    "  value: baz",
    "  owner: null",
    "  provider: null",
    "  defaultVarName: null",
    "- id: c",
    "  label: Only label",
    "  value: ''",
    "  owner: null",
    "  provider: null",
    "  defaultVarName: null",
  ].join("\n");
  const parsed = parseVaultYaml(yaml);
  expect(parsed.length).toBe(1);
  expect(parsed[0].id).toBe("a");
});

test("vault parses empty file", () => {
  expect(parseVaultYaml("")).toEqual([]);
  expect(parseVaultYaml("   \n\n")).toEqual([]);
});

test("vault round-trip special chars in value", () => {
  const entries = [
    {
      id: "x",
      label: "Has spaces",
      value: "a b c #d",
      owner: null,
      provider: null,
      defaultVarName: "VAR",
    },
  ];
  const yaml = serializeVaultYaml(entries);
  const parsed = parseVaultYaml(yaml);
  expect(parsed).toEqual(entries);
});
