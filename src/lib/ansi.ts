const COLORS: Record<number, string> = {
  30: "black",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "white",
  90: "bright-black",
  91: "bright-red",
  92: "bright-green",
  93: "bright-yellow",
  94: "bright-blue",
  95: "bright-magenta",
  96: "bright-cyan",
  97: "bright-white",
};

const BGCOLORS: Record<number, string> = {
  40: "black",
  41: "red",
  42: "green",
  43: "yellow",
  44: "blue",
  45: "magenta",
  46: "cyan",
  47: "white",
};

const escapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += escapeMap[c] ?? c;
  }
  return out;
}

export function renderAnsi(text: string): string {
  const parts: string[] = [];
  let styles = new Set<string>();
  let buf = "";
  const flush = () => {
    parts.push(
      styles.size > 0
        ? `<span class="${Array.from(styles).join(" ")}">${buf}</span>`
        : buf,
    );
    buf = "";
  };
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 27 && text[i + 1] === "[") {
      if (buf) flush();
      const m = text.slice(i).match(/^\x1b\[([\d;]*)m/);
      if (m) {
        styles = applyCodes(m[1], styles);
        i += m[0].length;
        continue;
      }
      const m2 = text.slice(i).match(/^\x1b\[[\d;]*[A-Za-z]/);
      if (m2) {
        i += m2[0].length;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) flush();
  return parts.join("");
}

function applyCodes(codes: string, styles: Set<string>): Set<string> {
  const next = new Set(styles);
  const parts = codes ? codes.split(";").map(Number) : [0];
  for (const c of parts) {
    if (c === 0) next.clear();
    else if (c === 1) next.add("ansi-bold");
    else if (c === 2) next.add("ansi-dim");
    else if (c === 3) next.add("ansi-italic");
    else if (c === 4) next.add("ansi-underline");
    else if (c === 22) {
      next.delete("ansi-bold");
      next.delete("ansi-dim");
    } else if (c === 23) next.delete("ansi-italic");
    else if (c === 24) next.delete("ansi-underline");
    else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) {
      removeByPrefix(next, "ansi-fg-");
      const name = COLORS[c];
      if (name) next.add("ansi-fg-" + name);
    } else if (c === 39) {
      removeByPrefix(next, "ansi-fg-");
    } else if (c >= 40 && c <= 47) {
      removeByPrefix(next, "ansi-bg-");
      const name = BGCOLORS[c];
      if (name) next.add("ansi-bg-" + name);
    } else if (c === 49) {
      removeByPrefix(next, "ansi-bg-");
    }
  }
  return next;
}

function removeByPrefix(set: Set<string>, prefix: string): void {
  for (const s of Array.from(set)) {
    if (s.startsWith(prefix)) set.delete(s);
  }
}
