// Small formatting helpers shared across components.

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function fmtMs(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function pct(score: number): string {
  const v = score > 1 ? score : score * 100;
  return `${Math.round(v)}%`;
}

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}

function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Humanized one-line summary of a tool call's arguments. */
export function summarizeArgs(name: string, args: Record<string, unknown> | undefined): string {
  const a = args ?? {};
  switch (name) {
    case 'run_shell':
    case 'start_background':
      return str(a.command ?? a.cmd);
    case 'stop_background':
      return str(a.name ?? a.pid);
    case 'write_file':
    case 'read_file':
      return str(a.path ?? a.file);
    case 'list_files':
      return str(a.path ?? a.dir) || '.';
    case 'open_url':
    case 'fetch_url':
      return str(a.url);
    case 'github_create_issue':
      return str(a.title);
    case 'github_repo_info':
      return str(a.repo ?? a.url) || 'current repo';
    case 'resolve_confirmation':
      return a.approved === true ? 'approved' : a.approved === false ? 'denied' : str(a.id);
    case 'reset_workspace':
      return 'clean slate';
    default: {
      const keys = Object.keys(a);
      if (keys.length === 0) return '';
      return keys.map((k) => `${k}=${str(a[k])}`).join(' · ');
    }
  }
}

export function toolLabel(name: string): string {
  return name.replace(/_/g, ' ');
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : '';
}
