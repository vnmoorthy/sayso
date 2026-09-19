// Strips ANSI escape sequences (colors, cursor movement, OSC hyperlinks) from
// terminal output so it renders cleanly in the Terminal pane.

const ANSI_PATTERN = [
  '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
  '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
].join('|');

const ANSI_RE = new RegExp(ANSI_PATTERN, 'g');

export function stripAnsi(input: string): string {
  if (!input) return '';
  return input.replace(ANSI_RE, '');
}

/** Resolve carriage-return overwrites: keep only the text after the last \r. */
export function applyCarriageReturns(line: string): string {
  const i = line.lastIndexOf('\r');
  return i >= 0 ? line.slice(i + 1) : line;
}
