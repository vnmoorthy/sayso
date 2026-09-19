import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { Toast } from '../lib/store';
import { cx } from '../lib/format';

const TOAST_MS = 5000;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  const Icon =
    toast.level === 'error'
      ? CircleAlert
      : toast.level === 'warn'
        ? TriangleAlert
        : toast.level === 'success'
          ? CircleCheck
          : Info;
  const tone =
    toast.level === 'error'
      ? 'border-danger/40 text-danger'
      : toast.level === 'warn'
        ? 'border-amber/40 text-amber'
        : toast.level === 'success'
          ? 'border-lime/40 text-lime'
          : 'border-line-2 text-violet';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      role="status"
      className={cx(
        'pointer-events-auto flex w-[min(360px,calc(100vw-2rem))] items-start gap-2.5 rounded-xl border bg-surface-2/95 px-3 py-2.5 shadow-soft backdrop-blur',
        tone,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words text-xs leading-relaxed text-text">{toast.text}</div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-mr-1 rounded-md p-1 text-dim transition hover:text-text"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 max-lg:bottom-[calc(4.75rem+env(safe-area-inset-bottom))]">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
