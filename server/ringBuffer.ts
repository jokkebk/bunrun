export type LogLine = {
  ts: number;
  stream: "stdout" | "stderr";
  line: string;
  url?: string;
};

export type RingBuffer = {
  lines: LogLine[];
  bytes: number;
  maxLines: number;
  maxBytes: number;
};

export function createRingBuffer(
  maxLines = 5000,
  maxBytes = 2_000_000,
): RingBuffer {
  return { lines: [], bytes: 0, maxLines, maxBytes };
}

export function pushLine(buf: RingBuffer, line: LogLine): void {
  buf.lines.push(line);
  buf.bytes += Buffer.byteLength(line.line, "utf8");
  while (buf.lines.length > buf.maxLines) {
    const dropped = buf.lines.shift();
    if (dropped) buf.bytes -= Buffer.byteLength(dropped.line, "utf8");
  }
  while (buf.bytes > buf.maxBytes && buf.lines.length > 0) {
    const dropped = buf.lines.shift();
    if (dropped) buf.bytes -= Buffer.byteLength(dropped.line, "utf8");
  }
}

export function snapshot(buf: RingBuffer): LogLine[] {
  return buf.lines.slice();
}
