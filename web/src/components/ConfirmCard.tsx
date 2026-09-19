import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ShieldCheck, X } from 'lucide-react';
import type { ConfirmRequest } from '../lib/store';
import { Spinner } from './ui';

export function ConfirmCard({
  request,
  onResolve,
}: {
  request: ConfirmRequest;
  onResolve: (id: string, approved: boolean) => void;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  const act = (approved: boolean) => {
    setPending(approved);
    onResolve(request.id, approved);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className="relative overflow-hidden rounded-2xl border border-amber/50 bg-amber/8 p-4 shadow-[0_0_0_1px_rgba(255,176,32,0.12),0_24px_60px_-30px_rgba(255,176,32,0.55)]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber/15 text-amber">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text">Sayso needs your say-so</h3>
            <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber">
              destructive
            </span>
          </div>
          <pre className="mono mt-2 overflow-x-auto rounded-lg border border-amber/20 bg-black/40 px-3 py-2 text-xs break-all whitespace-pre-wrap text-amber">
            <span className="text-amber/60">$ </span>
            {request.command}
          </pre>
          <p className="mt-2 text-xs text-muted">{request.reason}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-12">
        <button
          type="button"
          onClick={() => act(true)}
          disabled={pending !== null}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-lime px-4 text-sm font-semibold text-black transition hover:brightness-105 disabled:opacity-60"
        >
          {pending === true ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          Approve
        </button>
        <button
          type="button"
          onClick={() => act(false)}
          disabled={pending !== null}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-2 bg-surface-2 px-4 text-sm font-medium text-text transition hover:border-danger/40 hover:text-danger disabled:opacity-60"
        >
          {pending === false ? <Spinner className="h-4 w-4" /> : <X className="h-4 w-4" />}
          Deny
        </button>
        <span className="text-xs text-dim">{pending === null ? '…or just say “yes”' : 'Sending your answer…'}</span>
      </div>
    </motion.div>
  );
}
