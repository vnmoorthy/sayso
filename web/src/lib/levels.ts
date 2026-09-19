// High-frequency audio levels live outside React state so the Orb can read
// them in a requestAnimationFrame loop without re-rendering the app.

export const levels = {
  /** 0..1 — local microphone energy */
  local: 0,
  /** 0..1 — remote (bot) audio energy */
  remote: 0,
};

export function resetLevels() {
  levels.local = 0;
  levels.remote = 0;
}
