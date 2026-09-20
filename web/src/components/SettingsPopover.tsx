import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { StatusMessage } from '../lib/protocol';
import { normalizeServerUrl, type Settings } from '../lib/settings';
import { cx } from '../lib/format';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-dim">{hint}</span>}
    </label>
  );
}

const inputClass =
  'h-9 w-full rounded-lg border border-line-2 bg-surface-3 px-2.5 text-xs text-text outline-none transition focus:border-lime/50 disabled:cursor-not-allowed disabled:opacity-50';

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left text-xs text-text hover:bg-white/[0.03]"
    >
      <span className="leading-snug">{label}</span>
      <span
        className={cx(
          'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
          checked ? 'border-lime/50 bg-lime/30' : 'border-line-2 bg-surface-3',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all',
            checked ? 'left-[18px] bg-lime' : 'left-0.5 bg-muted',
          )}
        />
      </span>
    </button>
  );
}

export function SettingsPopover({
  open,
  onClose,
  settings,
  onChange,
  status,
  connected,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  status: StatusMessage | null;
  connected: boolean;
}) {
  const [draftUrl, setDraftUrl] = useState(settings.serverUrl);

  useEffect(() => {
    if (open) setDraftUrl(settings.serverUrl);
  }, [open, settings.serverUrl]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const commitUrl = () => {
    const next = normalizeServerUrl(draftUrl);
    setDraftUrl(next);
    if (next !== settings.serverUrl) onChange({ serverUrl: next });
  };

  const models = status?.llm.models?.length ? status.llm.models : status?.llm.model ? [status.llm.model] : [];
  const modelValue = settings.model && models.includes(settings.model) ? settings.model : status?.llm.model ?? '';
  const voices = status?.voices ?? [];
  const voiceValue =
    settings.voice && voices.some((v) => v.id === settings.voice) ? settings.voice : status?.voice ?? '';

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
          <motion.div
            role="dialog"
            aria-label="Settings"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="fixed top-[60px] right-3 z-50 w-[min(360px,calc(100vw-1.5rem))] rounded-2xl border border-line-2 bg-surface-2/95 p-4 shadow-soft backdrop-blur"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Settings</div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close settings"
                className="rounded-md p-1 text-dim transition hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <Field
                label="Server URL"
                hint={connected ? 'Applies on the next connect.' : 'Pipecat dev runner, e.g. http://localhost:7860'}
              >
                <input
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  onBlur={commitUrl}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitUrl();
                    }
                  }}
                  spellCheck={false}
                  className={cx(inputClass, 'mono')}
                />
              </Field>

              <Field label="Model" hint={models.length ? undefined : 'Connect to load models from the server.'}>
                <select
                  value={modelValue}
                  disabled={models.length === 0}
                  onChange={(e) => onChange({ model: e.target.value })}
                  className={inputClass}
                >
                  {models.length === 0 && <option value="">—</option>}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Voice" hint={voices.length ? undefined : 'Connect to load voices from the server.'}>
                <select
                  value={voiceValue}
                  disabled={voices.length === 0}
                  onChange={(e) => onChange({ voice: e.target.value })}
                  className={inputClass}
                >
                  {voices.length === 0 && <option value="">—</option>}
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="space-y-0.5 border-t border-line pt-2">
                <Toggle
                  label="Speak replies in browser when server has no TTS"
                  checked={settings.browserTts}
                  onChange={(v) => onChange({ browserTts: v })}
                />
                <Toggle label="Show latency HUD" checked={settings.showHud} onChange={(v) => onChange({ showHud: v })} />
                <Toggle
                  label="Push-to-talk only (mic stays muted; hold Space to talk)"
                  checked={settings.pushToTalk}
                  onChange={(v) => onChange({ pushToTalk: v })}
                />
                <Toggle
                  label="Sound cues — connect chime, tool tick, say-so tone"
                  checked={settings.soundCues}
                  onChange={(v) => onChange({ soundCues: v })}
                />
              </div>
            </div>

            <div className="mono mt-3 truncate border-t border-line pt-2.5 text-[10px] text-dim">
              {status
                ? `${status.mode} · ${status.llm.provider} · ${status.stt} stt · ${status.tts} tts · emotion ${status.emotion ? 'on' : 'off'} · v${status.version}`
                : 'Not connected'}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
