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

const URL_RE = /https?:\/\/[^\s<>"'`)}\]]+/i;

type Piece = { text: string; styles: string[] };

function buildPieces(text: string): Piece[] {
  const pieces: Piece[] = [];
  let styles = new Set<string>();
  let buf = "";
  const flush = () => {
    if (buf.length === 0) return;
    pieces.push({ text: buf, styles: Array.from(styles) });
    buf = "";
  };
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 27 && text[i + 1] === "[") {
      flush();
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
  flush();
  return pieces;
}

function wrapSpan(styles: string[], text: string): string {
  if (!text) return "";
  return styles.length
    ? `<span class="${styles.join(" ")}">${text}</span>`
    : text;
}

export function renderAnsi(text: string): string {
  const pieces = buildPieces(text);
  let plain = "";
  for (const p of pieces) plain += p.text;

  const urls: Array<{ start: number; end: number; href: string }> = [];
  let cursor = 0;
  while (cursor < plain.length) {
    const slice = plain.slice(cursor);
    const m = slice.match(URL_RE);
    if (!m || m.index === undefined) break;
    const start = cursor + m.index;
    const end = start + m[0].length;
    urls.push({ start, end, href: m[0] });
    cursor = end;
  }

  let out = "";
  let offset = 0;
  let ui = 0;
  for (const p of pieces) {
    let local = 0;
    while (local < p.text.length) {
      const g = offset + local;
      while (ui < urls.length && urls[ui].end <= g) ui++;
      const cur = urls[ui];
      if (cur && cur.start <= g && g < cur.end) {
        const segLen = Math.min(p.text.length - local, cur.end - g);
        const segEsc = esc(p.text.slice(local, local + segLen));
        out += `<a href="${esc(cur.href)}" target="_blank" rel="noreferrer" class="log-url">${wrapSpan(p.styles, segEsc)}</a>`;
        local += segLen;
      } else if (cur && g < cur.start) {
        const segLen = Math.min(p.text.length - local, cur.start - g);
        out += wrapSpan(p.styles, esc(p.text.slice(local, local + segLen)));
        local += segLen;
      } else {
        const segLen = p.text.length - local;
        out += wrapSpan(p.styles, esc(p.text.slice(local, local + segLen)));
        local += segLen;
      }
    }
    offset += p.text.length;
  }
  return out;
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
