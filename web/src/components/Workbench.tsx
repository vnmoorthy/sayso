import { AnimatePresence, motion } from 'framer-motion';
import { Files, Globe, Terminal, type LucideIcon } from 'lucide-react';
import type { Action, State, WorkbenchTab } from '../lib/store';
import { runningProcesses } from '../lib/store';
import { cx } from '../lib/format';
import { ConfirmCard } from './ConfirmCard';
import { TerminalPane } from './TerminalPane';
import { BrowserPane } from './BrowserPane';
import { FilesPane } from './FilesPane';

const TABS: { id: WorkbenchTab; label: string; icon: LucideIcon }[] = [
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'files', label: 'Files', icon: Files },
];

function WorkbenchEmpty() {
  const items = [
    { icon: Terminal, title: 'Terminal', body: 'Commands stream here live — stdout, stderr, exit codes.' },
    { icon: Globe, title: 'Browser', body: 'Anything Sayso opens renders in this pane.' },
    { icon: Files, title: 'Files', body: 'Every file it writes, with line numbers.' },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div>
        <div className="text-sm font-semibold text-text">Your workbench</div>
        <div className="mt-1 max-w-sm text-xs leading-relaxed text-muted">
          Connect and start talking. Sayso switches to the right pane as it works.
        </div>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="rounded-xl border border-line bg-surface-2/60 p-3.5 text-left">
            <it.icon className="h-4 w-4 text-lime" />
            <div className="mt-2 text-xs font-semibold text-text">{it.title}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-muted">{it.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Workbench({
  state,
  dispatch,
  onConfirm,
  onStopAll,
  className,
}: {
  state: State;
  dispatch: (a: Action) => void;
  onConfirm: (id: string, approved: boolean) => void;
  onStopAll: () => void;
  className?: string;
}) {
  const processes = runningProcesses(state);
  const runningCommands = state.terminal.filter((b) => b.status === 'running').length;
  const idle =
    state.connection !== 'connected' &&
    state.terminal.length === 0 &&
    !state.browserUrl &&
    state.fileOrder.length === 0 &&
    state.confirms.length === 0;

  const badge = (tab: WorkbenchTab) => {
    if (tab === 'terminal' && (runningCommands > 0 || processes.length > 0)) {
      return <span className="relative ml-0.5 h-1.5 w-1.5 rounded-full bg-lime animate-pulse-dot" />;
    }
    if (tab === 'files' && state.fileOrder.length > 0) {
      return <span className="relative ml-0.5 text-[10px] text-dim tabular-nums">{state.fileOrder.length}</span>;
    }
    if (tab === 'browser' && state.browserUrl) {
      return <span className="relative ml-0.5 h-1.5 w-1.5 rounded-full bg-ice" />;
    }
    return null;
  };

  return (
    <div className={cx('panel flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <div className="panel-head">
        <div className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5" role="tablist">
          {TABS.map((t) => {
            const active = state.tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => dispatch({ type: 'set_tab', tab: t.id, manual: true })}
                className={cx(
                  'relative inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-xs font-medium transition-colors',
                  active ? 'text-text' : 'text-muted hover:text-text',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="workbench-tab"
                    className="absolute inset-0 rounded-[10px] border border-line-2 bg-surface-3"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <t.icon className="relative h-3.5 w-3.5" />
                <span className="relative">{t.label}</span>
                {badge(t.id)}
              </button>
            );
          })}
        </div>
        {state.status?.workspace && (
          <span className="mono ml-auto hidden truncate text-[11px] text-dim md:inline" title="Workspace">
            {state.status.workspace}
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {state.confirms.length > 0 && (
          <motion.div
            key="confirms"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 overflow-hidden border-b border-line"
          >
            <div className="space-y-2 p-3">
              {state.confirms.map((c) => (
                <ConfirmCard key={c.id} request={c} onResolve={onConfirm} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative min-h-0 flex-1">
        {idle ? (
          <WorkbenchEmpty />
        ) : (
          <>
            <Pane active={state.tab === 'terminal'}>
              <TerminalPane
                blocks={state.terminal}
                processes={processes}
                onClear={() => dispatch({ type: 'clear_terminal' })}
                onStopAll={onStopAll}
              />
            </Pane>
            <Pane active={state.tab === 'browser'}>
              <BrowserPane
                url={state.browserUrl}
                shot={state.browserShot}
                title={state.browserTitle}
                nonce={state.browserNonce}
                mock={state.mock}
                onNavigate={(url) => dispatch({ type: 'browser_navigate', url })}
                onRefresh={() => dispatch({ type: 'browser_refresh' })}
              />
            </Pane>
            <Pane active={state.tab === 'files'}>
              <FilesPane
                files={state.files}
                fileOrder={state.fileOrder}
                tree={state.workspaceTree}
                selected={state.selectedFile}
                onSelect={(path) => dispatch({ type: 'select_file', path })}
              />
            </Pane>
          </>
        )}
      </div>
    </div>
  );
}

/** Keeps every pane mounted (so the browser iframe survives tab switches) and fades the active one in. */
function Pane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      aria-hidden={!active}
      className={cx(
        'absolute inset-0 transition-opacity duration-150',
        active ? 'opacity-100' : 'pointer-events-none invisible opacity-0',
      )}
    >
      {children}
    </div>
  );
}
