import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Boxes,
  ExternalLink,
  FileText,
  FolderOpen,
  Github,
  Globe,
  Link2,
  ListTree,
  Play,
  ShieldCheck,
  Square,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ActionEntry, GithubEvent, ToolRecord } from '../lib/store';
import { cx, fmtMs, summarizeArgs, toolLabel } from '../lib/format';
import { EmptyState, StatusDot, useStatusFlash } from './ui';

const ICONS: Record<string, LucideIcon> = {
  run_shell: Terminal,
  start_background: Play,
  stop_background: Square,
  write_file: FileText,
  read_file: FileText,
  list_files: FolderOpen,
  open_url: Globe,
  fetch_url: Link2,
  github_create_issue: Github,
  github_repo_info: Github,
  resolve_confirmation: ShieldCheck,
  reset_workspace: Boxes,
};

function ToolCard({ tool }: { tool: ToolRecord }) {
  const Icon = ICONS[tool.name] ?? Wrench;
  const summary = summarizeArgs(tool.name, tool.args);
  const flash = useStatusFlash(tool.status);
  return (
    <motion.div
      initial={{ opacity: 0, x: 16, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.34, ease: [0.2, 0.7, 0.2, 1] }}
      className={cx(
        'card-arrive rounded-xl border p-2.5',
        flash === 'ok' && 'flash-ok',
        flash === 'failed' && 'flash-fail',
        tool.status === 'failed'
          ? 'border-danger/30 bg-danger/5'
          : tool.status === 'running'
            ? 'border-violet/30 bg-violet/5'
            : 'border-line bg-surface-2',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cx(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            tool.status === 'failed'
              ? 'bg-danger/15 text-danger'
              : tool.status === 'running'
                ? 'bg-violet/15 text-violet'
                : 'bg-lime/10 text-lime',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold text-text">{toolLabel(tool.name)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-dim tabular-nums">
              {tool.duration_ms !== undefined && fmtMs(tool.duration_ms)}
              <StatusDot status={tool.status} />
            </span>
          </div>
          {summary && (
            <div className="mono mt-1 truncate text-[11px] text-muted" title={summary}>
              {summary}
            </div>
          )}
          {tool.summary && tool.status !== 'running' && (
            <div className={cx('mt-1 text-[11px] leading-snug', tool.status === 'failed' ? 'text-danger/90' : 'text-dim')}>
              {tool.summary}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function GithubCard({ ev }: { ev: GithubEvent }) {
  const label = ev.kind === 'issue' ? 'Issue' : ev.kind === 'pr' ? 'Pull request' : 'Repository';
  return (
    <motion.a
      href={ev.url}
      target="_blank"
      rel="noreferrer noopener"
      initial={{ opacity: 0, x: 16, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.34, ease: [0.2, 0.7, 0.2, 1] }}
      className="card-arrive group block rounded-xl border border-line bg-surface-2 p-2.5 transition hover:border-lime/40"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/8 text-text">
          <Github className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-text">{label}</span>
            {ev.number !== undefined && <span className="mono text-lime">#{ev.number}</span>}
            <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-dim group-hover:text-lime" />
          </div>
          <div className="mt-1 truncate text-[11px] text-muted">{ev.title}</div>
          <div className="mono mt-0.5 truncate text-[10px] text-dim">{ev.url.replace(/^https?:\/\//, '')}</div>
        </div>
      </div>
    </motion.a>
  );
}

export function ActionsRail({
  actions,
  tools,
  github,
  className,
}: {
  actions: ActionEntry[];
  tools: Record<string, ToolRecord>;
  github: Record<string, GithubEvent>;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  let ok = 0;
  let failed = 0;
  let running = 0;
  for (const entry of actions) {
    if (entry.kind === 'github') {
      ok += 1;
      continue;
    }
    const t = tools[entry.id];
    if (!t) continue;
    if (t.status === 'ok') ok += 1;
    else if (t.status === 'failed') failed += 1;
    else running += 1;
  }

  useEffect(() => {
    const el = ref.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [actions, tools]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  return (
    <div className={cx('panel flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <div className="panel-head">
        <span className="eyebrow">actions</span>
        <span className="ml-auto truncate text-[11px] text-dim tabular-nums">
          {actions.length} action{actions.length === 1 ? '' : 's'}
          {actions.length > 0 && (
            <>
              {' · '}
              <span className="text-lime">{ok} ok</span>
              {failed > 0 && (
                <>
                  {' · '}
                  <span className="text-danger">{failed} failed</span>
                </>
              )}
              {running > 0 && (
                <>
                  {' · '}
                  <span className="text-violet">{running} running</span>
                </>
              )}
            </>
          )}
        </span>
      </div>
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {actions.length === 0 ? (
          <EmptyState
            icon={<ListTree />}
            title="No actions yet"
            body="Every command, file write, URL and GitHub call Sayso makes is logged here in order."
          />
        ) : (
          actions.map((entry) => {
            if (entry.kind === 'github') {
              const ev = github[entry.id];
              return ev ? <GithubCard key={entry.id} ev={ev} /> : null;
            }
            const tool = tools[entry.id];
            return tool ? <ToolCard key={entry.id} tool={tool} /> : null;
          })
        )}
      </div>
    </div>
  );
}
