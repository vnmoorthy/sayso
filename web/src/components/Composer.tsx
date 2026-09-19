import { useState, type FormEvent, type RefObject } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { cx } from '../lib/format';
import { Kbd } from './ui';

export const SUGGESTIONS = [
  'Create a web app called pulse with a live clock and run it on port 8000',
  'Open it in the browser',
  'Run the tests',
  'File a GitHub issue to add dark mode',
];

export function Composer({
  inputRef,
  disabled,
  hint,
  onSend,
  showSuggestions,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  hint?: string;
  onSend: (text: string) => void;
  showSuggestions: boolean;
}) {
  const [value, setValue] = useState('');

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  };

  return (
    <div className="shrink-0 border-t border-line p-3">
      {showSuggestions && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onSend(s)}
              className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 px-3 py-1.5 text-left text-[11px] text-muted transition hover:border-lime/40 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3 shrink-0 text-lime/70 group-hover:text-lime" />
              <span className="truncate">{s}</span>
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={submit}
        className={cx(
          'flex items-center gap-2 rounded-xl border bg-surface-2 py-1.5 pr-1.5 pl-3 transition-colors',
          disabled ? 'border-line' : 'border-line-2 focus-within:border-lime/40',
        )}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          placeholder="Type a command or just talk…"
          aria-label="Message Sayso"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-dim disabled:cursor-not-allowed"
        />
        {!disabled && !value && (
          <span className="hidden items-center gap-1 text-[10px] text-dim sm:inline-flex">
            <Kbd>/</Kbd> to focus
          </span>
        )}
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lime text-black transition hover:brightness-105 disabled:bg-surface-3 disabled:text-dim"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
      {disabled && hint && <div className="mt-1.5 px-1 text-[11px] text-dim">{hint}</div>}
    </div>
  );
}
