import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cx } from '../lib/format';
import type { ToolStatus } from '../lib/store';

export type Tone = 'neutral' | 'lime' | 'violet' | 'amber' | 'danger' | 'ice';

const pillTone: Record<Tone, string> = {
  neutral: 'border-line-2 bg-surface-2 text-muted',
  lime: 'border-lime/25 bg-lime/10 text-lime',
  violet: 'border-violet/30 bg-violet/10 text-violet',
  amber: 'border-amber/35 bg-amber/10 text-amber',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  ice: 'border-ice/30 bg-ice/10 text-ice',
};

export function Pill({
  children,
  tone = 'neutral',
  title,
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none',
        pillTone[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const iconButtonClass =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-muted transition-colors hover:border-line-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40';

export function IconButton({
  label,
  active,
  tone = 'neutral',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  tone?: 'neutral' | 'danger' | 'lime';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        iconButtonClass,
        tone === 'danger' && 'border-danger/30 bg-danger/10 text-danger hover:border-danger/50 hover:bg-danger/20 hover:text-danger',
        tone === 'lime' && 'border-lime/30 bg-lime/10 text-lime hover:border-lime/50 hover:bg-lime/20 hover:text-lime',
        active && tone === 'neutral' && 'border-line-2 bg-surface-3 text-text',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('animate-spin', className)} aria-hidden />;
}

export function StatusDot({ status, className }: { status: ToolStatus; className?: string }) {
  if (status === 'running') return <Spinner className={cx('h-3.5 w-3.5 text-violet', className)} />;
  return (
    <span
      className={cx(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        status === 'ok'
          ? 'bg-lime shadow-[0_0_8px_rgba(200,255,61,0.7)]'
          : 'bg-danger shadow-[0_0_8px_rgba(255,92,92,0.7)]',
        className,
      )}
      aria-label={status}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mono rounded-md border border-line-2 bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">
      {children}
    </kbd>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex h-full flex-col items-center justify-center gap-2 p-6 text-center', className)}>
      {icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-surface-2 text-muted [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </div>
      )}
      <div className="text-sm font-medium text-text">{title}</div>
      {body && <div className="max-w-xs text-xs leading-relaxed text-muted">{body}</div>}
    </div>
  );
}

/**
 * Returns the finished status ('ok' | 'failed') for ~1.4s right after a
 * running→finished transition, so a card can flash once. Null otherwise.
 */
export function useStatusFlash(status: ToolStatus): ToolStatus | null {
  const prev = useRef<ToolStatus>(status);
  const [flash, setFlash] = useState<ToolStatus | null>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (was === 'running' && status !== 'running') {
      setFlash(status);
      const t = window.setTimeout(() => setFlash(null), 1500);
      return () => window.clearTimeout(t);
    }
  }, [status]);
  return flash;
}
