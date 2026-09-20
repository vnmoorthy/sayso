import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Globe, RefreshCw } from 'lucide-react';
import { cx, hostOf } from '../lib/format';
import { EmptyState, IconButton, iconButtonClass } from './ui';

export function BrowserPane({
  url,
  title,
  nonce,
  mock,
  shot,
  onNavigate,
  onRefresh,
}: {
  url: string | null;
  title?: string;
  nonce: number;
  mock: boolean;
  shot?: { image: string; url: string; title?: string; action?: string; ts: number } | null;
  onNavigate: (url: string) => void;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState(url ?? '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDraft(url ?? '');
  }, [url]);

  useEffect(() => {
    if (!url) return;
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 6000);
    return () => clearTimeout(t);
  }, [url, nonce]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let next = draft.trim();
    if (!next) return;
    if (!/^https?:\/\//i.test(next)) next = `http://${next}`;
    if (next === url) onRefresh();
    else onNavigate(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form onSubmit={submit} className="flex items-center gap-2 border-b border-line px-3 py-2">
        <IconButton label="Refresh" onClick={onRefresh} disabled={!url} className="h-8 w-8 rounded-lg">
          <RefreshCw className={cx('h-3.5 w-3.5', loading && 'animate-spin')} />
        </IconButton>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-2 bg-surface-2 px-2.5 focus-within:border-lime/40">
          <Globe className="h-3.5 w-3.5 shrink-0 text-dim" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="http://localhost:8000"
            aria-label="Address"
            spellCheck={false}
            className="mono min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-dim"
          />
        </div>
        <a
          href={url ?? undefined}
          target="_blank"
          rel="noreferrer noopener"
          aria-disabled={!url}
          title="Open in new tab"
          className={cx(iconButtonClass, 'h-8 w-8 rounded-lg', !url && 'pointer-events-none opacity-40')}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </form>
      {mock && url && (
        <div className="border-b border-line bg-amber/5 px-3 py-1.5 text-[11px] text-amber/90">
          Mock session — nothing is actually serving {hostOf(url)}. In a live session the page renders here.
        </div>
      )}
      <div className="relative min-h-0 flex-1 bg-surface-2">
        {shot ? (
          <div className="relative h-full w-full overflow-auto bg-black">
            <img
              src={shot.image}
              alt={shot.title ?? shot.url}
              className="block w-full select-none"
              draggable={false}
            />
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-lime/30 bg-black/70 px-2.5 py-1 text-[11px] text-lime backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime" />
              Sayso&apos;s Chrome · live{shot.action ? ` · ${shot.action}` : ''}
            </div>
          </div>
        ) : url ? (
          <iframe
            key={`${url}#${nonce}`}
            src={url}
            title={title ?? url}
            sandbox="allow-scripts allow-same-origin allow-forms"
            className="h-full w-full border-0 bg-surface-2"
            onLoad={() => setLoading(false)}
            onError={() => setLoading(false)}
          />
        ) : (
          <EmptyState
            icon={<Globe />}
            title="Ask Sayso to open a URL"
            body="Say “open it in the browser” and the page loads right here."
          />
        )}
      </div>
    </div>
  );
}
