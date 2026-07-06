// Surgical .env parser/writer.
//
// Parses a .env file into an ordered list of lines that preserves the original
// source verbatim where untouched. Edits mutate line objects in place; serialize
// regenerates text only where the line was marked dirty (rawValue === null).
//
// Line types:
//   - blank        (empty / whitespace-only line)
//   - doc-comment  (# freeform text, NOT a disabled KEY=...)
//   - other        (any line we don't understand, e.g. `export X=1` shell — preserved)
//   - kv           (KEY=value or #KEY=value, with optional trailing comment + quoting)

export type EnvLine =
  | { kind: "blank"; raw: string }
  | { kind: "doc-comment"; raw: string }
  | { kind: "other"; raw: string }
  | {
      kind: "kv";
      key: string;
      value: string;
      // Verbatim bytes after `=` (incl. quotes + trailing comment). When null,
      // serialize regenerates from `value`.
      rawValue: string | null;
      disabled: boolean;
      exportPrefix: boolean;
      inlineComment: string | null;
      prefix: string;
    };

export function parseEnv(text: string): EnvLine[] {
  const lines = text.split("\n");
  // Last empty element when file ends with \n — handle by preserving but not adding.
  const result: EnvLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (i === lines.length - 1 && raw === "" && text.endsWith("\n")) {
      // represented as final blank line that serialize will reconstruct
      result.push({ kind: "blank", raw: "" });
      continue;
    }
    result.push(parseLine(raw));
  }
  return result;
}

function parseLine(raw: string): EnvLine {
  if (raw.trim() === "") return { kind: "blank", raw };
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("#")) {
    const m = trimmed.match(/^#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (m) {
      const prefix = raw.slice(0, raw.length - trimmed.length);
      const { value, rawValue, inlineComment } = parseValue(m[2]);
      return {
        kind: "kv",
        key: m[1],
        value,
        rawValue,
        disabled: true,
        exportPrefix: false,
        inlineComment,
        prefix,
      };
    }
    return { kind: "doc-comment", raw };
  }
  const m = raw.match(/^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) {
    const prefix = m[1];
    const exportPrefix = Boolean(m[2]);
    const { value, rawValue, inlineComment } = parseValue(m[4]);
    return {
      kind: "kv",
      key: m[3],
      value,
      rawValue,
      disabled: false,
      exportPrefix,
      inlineComment,
      prefix,
    };
  }
  return { kind: "other", raw };
}

// Parses the bytes after `=` into { value, rawValue, inlineComment }.
// rawValue preserves the original (incl. quotes + trailing comment) so untouched
// lines round-trip verbatim. When the UI edits `value`, it sets rawValue=null and
// serialize regenerates.
function parseValue(rest: string): {
  value: string;
  rawValue: string;
  inlineComment: string | null;
} {
  const rawValue = rest;
  const trimmed = rest.trimStart();
  let value: string;
  let inlineComment: string | null = null;
  if (trimmed.startsWith('"')) {
    const end = findQuotedEnd(trimmed, '"');
    if (end >= 0) {
      value = unescapeDq(trimmed.slice(1, end));
      const after = trimmed.slice(end + 1);
      const cm = after.match(/^\s+(#.*)$/);
      if (cm) inlineComment = cm[1];
      return { value, rawValue, inlineComment };
    }
  } else if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1);
    if (end >= 0) {
      value = trimmed.slice(1, end);
      const after = trimmed.slice(end + 1);
      const cm = after.match(/^\s+(#.*)$/);
      if (cm) inlineComment = cm[1];
      return { value, rawValue, inlineComment };
    }
  }
  // unquoted: split on ` #` (whitespace then #) for trailing comment
  const cm = rest.match(/\s+#.*$/);
  if (cm && cm.index !== undefined) {
    value = rest.slice(0, cm.index);
    inlineComment = rest.slice(cm.index).trim();
    return { value, rawValue, inlineComment };
  }
  value = rest;
  return { value, rawValue, inlineComment: null };
}

function findQuotedEnd(s: string, q: string): number {
  let i = 1;
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === q) return i;
    i++;
  }
  return -1;
}

function unescapeDq(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

export function serializeEnv(lines: EnvLine[]): string {
  const out: string[] = [];
  for (const line of lines) {
    out.push(serializeLine(line));
  }
  // Original split adds "" for trailing \n; we want result to end with \n only
  // once for a final blank line that came from trailing newline. Rejoin and trim
  // trailing empty if it was artificial — simplest: join with \n.
  return lines.map(serializeLine).join("\n");
}

function serializeLine(line: EnvLine): string {
  switch (line.kind) {
    case "blank":
      return line.raw;
    case "doc-comment":
      return line.raw;
    case "other":
      return line.raw;
    case "kv": {
      const lead = line.prefix;
      const disabled = line.disabled ? "#" : "";
      const exportKw = line.exportPrefix ? "export " : "";
      const valuePart =
        line.rawValue === null
          ? regenerateValue(line.value, line.inlineComment)
          : line.rawValue;
      return `${lead}${disabled}${exportKw}${line.key}=${valuePart}`;
    }
  }
}

// Regenerate raw bytes from a logical value, quoting when needed, and re-appending
// any preserved inline comment.
function regenerateValue(value: string, inlineComment: string | null): string {
  const needsQuoting =
    value === "" ||
    /[\s#"']/.test(value) ||
    value.startsWith("=") ||
    value.includes("=");
  let body: string;
  if (needsQuoting) {
    body = `"${value.replace(/[\\"]/g, "\\$&")}"`;
  } else {
    body = value;
  }
  if (inlineComment) return `${body} ${inlineComment}`;
  return body;
}

// Helpers for the UI: apply edits to a parsed line list.

export function setEnvValue(
  lines: EnvLine[],
  key: string,
  newValue: string,
): void {
  for (const l of lines) {
    if (l.kind === "kv" && l.key === key && !l.disabled) {
      if (l.value !== newValue) {
        l.value = newValue;
        l.rawValue = null;
      }
      return;
    }
  }
}

export function toggleEnvComment(lines: EnvLine[], key: string): void {
  let target: (EnvLine & { kind: "kv" }) | null = null;
  for (const l of lines) {
    if (l.kind === "kv" && l.key === key) {
      target = l as EnvLine & { kind: "kv" };
      break;
    }
  }
  if (!target) return;
  target.disabled = !target.disabled;
  // Keep rawValue; toggle just adds/removes leading #.
}

export function addEnvKey(lines: EnvLine[], key: string, value: string): void {
  // If a disabled key with same name exists, overwrite it (activate) instead of dup.
  for (const l of lines) {
    if (l.kind === "kv" && l.key === key) {
      l.value = value;
      l.rawValue = null;
      l.disabled = false;
      return;
    }
  }
  // Pop trailing blank lines so the new key lands before the file's trailing
  // newline, then re-append them. This preserves the original trailing-newline
  // behaviour.
  const trailingBlanks: EnvLine[] = [];
  while (lines.length > 0 && lines[lines.length - 1].kind === "blank") {
    trailingBlanks.unshift(lines.pop()!);
  }
  const nonBlankOverall = lines.some((l) => l.kind !== "blank");
  if (nonBlankOverall) lines.push({ kind: "blank", raw: "" });
  lines.push({
    kind: "kv",
    key,
    value,
    rawValue: null,
    disabled: false,
    exportPrefix: false,
    inlineComment: null,
    prefix: "",
  });
  lines.push(...trailingBlanks);
}

export function deleteEnvKey(lines: EnvLine[], key: string): void {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === "kv" && l.key === key) {
      lines.splice(i, 1);
      return;
    }
  }
}

export function renameEnvKey(
  lines: EnvLine[],
  oldKey: string,
  newKey: string,
): void {
  for (const l of lines) {
    if (l.kind === "kv" && l.key === oldKey) {
      l.key = newKey;
      l.rawValue = null;
      return;
    }
  }
}
