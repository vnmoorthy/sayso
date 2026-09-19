// URL flags, read once at startup.
//   ?mock=1            — scripted session, no server needed (timed replay)
//   ?mock=1&instant=1  — same script applied synchronously, for headless screenshots

function param(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

export const MOCK: boolean = param('mock') === '1';
export const INSTANT: boolean = MOCK && param('instant') === '1';
