// User preferences, persisted to localStorage (guarded — storage can be
// unavailable in private windows or blocked contexts).

export interface Settings {
  serverUrl: string;
  model: string | null;
  voice: string | null;
  /** Speak completed assistant turns with speechSynthesis when the server has no TTS. */
  browserTts: boolean;
  showHud: boolean;
  /** Small Web Audio cues: connect chime, tool tick/thud, say-so tone. */
  soundCues: boolean;
  /** Keep the mic muted and open it only while Space is held (for loud rooms). */
  pushToTalk: boolean;
}

const KEY = 'sayso.settings.v2';

export const DEFAULT_SERVER_URL: string =
  (import.meta.env.VITE_SAYSO_SERVER_URL as string | undefined) ?? 'http://localhost:7860';

export const defaultSettings: Settings = {
  serverUrl: DEFAULT_SERVER_URL,
  model: null,
  voice: null,
  browserTts: true,
  showHud: true,
  soundCues: true,
  pushToTalk: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...defaultSettings,
      ...parsed,
      serverUrl:
        typeof parsed.serverUrl === 'string' && parsed.serverUrl.trim()
          ? parsed.serverUrl.trim()
          : defaultSettings.serverUrl,
    };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // ignore — storage unavailable
  }
}

/** Normalizes a server URL: trims, adds a scheme if missing, drops trailing slashes. */
export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return DEFAULT_SERVER_URL;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}
