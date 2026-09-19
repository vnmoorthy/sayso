import { useMemo, type ReactNode } from 'react';
import { FileCode2, FileText, Files } from 'lucide-react';
import type { FileRecord } from '../lib/store';
import { cx } from '../lib/format';
import { EmptyState } from './ui';

// ------------------------------------------------------------ highlighting

const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'class', 'new', 'this', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'def', 'lambda', 'with', 'as', 'in',
  'not', 'and', 'or', 'is', 'None', 'True', 'False', 'null', 'undefined', 'true', 'false', 'pass', 'raise', 'yield',
  'self', 'print', 'type', 'interface', 'extends', 'implements', 'switch', 'case', 'break', 'continue', 'elif',
  'echo', 'exit', 'fi', 'then', 'do', 'done', 'esac', 'local',
]);

const HTML_RULE = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w:-]*|\/?>)|("[^"]*"|'[^']*')|(\b[A-Za-z][\w-]*(?==))/g;
const GENERIC_RULE =
  /(#.*$|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)/g;

type TokenKind = 'com' | 'tag' | 'str' | 'attr' | 'num' | 'kw' | 'plain';

const TOKEN_CLASS: Record<TokenKind, string> = {
  com: 'text-dim italic',
  tag: 'text-ice',
  str: 'text-lime/90',
  attr: 'text-amber/90',
  num: 'text-amber',
  kw: 'text-violet',
  plain: '',
};

function highlightLine(line: string, lang: string): ReactNode[] {
  const isHtml = lang === 'html' || lang === 'xml' || lang === 'svg' || lang === 'vue';
  const rule = isHtml ? HTML_RULE : GENERIC_RULE;
  rule.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = rule.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    let kind: TokenKind = 'plain';
    if (isHtml) {
      kind = m[1] ? 'com' : m[2] ? 'tag' : m[3] ? 'str' : m[4] ? 'attr' : 'plain';
    } else if (m[1]) kind = 'com';
    else if (m[2]) kind = 'str';
    else if (m[3]) kind = 'num';
    else if (m[4]) kind = KEYWORDS.has(m[4]) ? 'kw' : 'plain';
    const text = m[0];
    if (kind === 'plain') out.push(text);
    else
      out.push(
        <span key={k} className={TOKEN_CLASS[kind]}>
          {text}
        </span>,
      );
    k += 1;
    last = m.index + text.length;
    if (m[0].length === 0) rule.lastIndex += 1;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function CodeView({ content, language }: { content: string; language: string }) {
  const rows = useMemo(() => {
    const lang = (language || '').toLowerCase();
    return content.replace(/\n$/, '').split('\n').map((line) => highlightLine(line, lang));
  }, [content, language]);

  return (
    <div className="terminal-surface mono min-h-0 flex-1 overflow-auto text-[12px] leading-[1.6]">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((nodes, i) => (
            <tr key={i} className="hover:bg-white/[0.025]">
              <td className="w-10 pr-3 pl-3 text-right align-top text-dim tabular-nums select-none">{i + 1}</td>
              <td className="pr-4 whitespace-pre text-text/90">{nodes.length ? nodes : ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------ pane

export function FilesPane({
  files,
  fileOrder,
  tree,
  selected,
  onSelect,
}: {
  files: Record<string, FileRecord>;
  fileOrder: string[];
  tree: string[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const seen = new Set(fileOrder);
  const treeFiles = tree.filter((p) => !p.endsWith('/') && !seen.has(p));
  const list = [...fileOrder, ...treeFiles];
  const file = selected ? files[selected] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex max-h-[40%] shrink-0 flex-col border-b border-line md:max-h-none md:w-60 md:border-r md:border-b-0">
        <div className="eyebrow px-3 pt-3 pb-2">
          files · {list.length}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {list.length === 0 && <div className="px-2 py-3 text-xs text-dim">No files yet</div>}
          {list.map((p) => {
            const rec = files[p];
            const active = p === selected;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onSelect(p)}
                disabled={!rec}
                title={p}
                className={cx(
                  'mono flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px] transition',
                  active
                    ? 'bg-lime/10 text-text'
                    : rec
                      ? 'text-muted hover:bg-white/5 hover:text-text'
                      : 'cursor-default text-dim',
                )}
              >
                {rec ? (
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-lime/80" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-dim" />
                )}
                <span className="truncate">{p}</span>
                {rec && (
                  <span className="ml-auto shrink-0 text-[9px] tracking-wider text-dim uppercase">
                    {rec.action === 'write' ? 'wrote' : 'read'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {file ? (
          <>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs">
              <span className="mono truncate text-text">{file.path}</span>
              <span className="text-dim">·</span>
              <span className="shrink-0 text-dim">{file.language}</span>
              <span className="ml-auto shrink-0 text-dim tabular-nums">
                {file.content.replace(/\n$/, '').split('\n').length} lines
              </span>
            </div>
            <CodeView content={file.content} language={file.language} />
          </>
        ) : (
          <EmptyState
            icon={<Files />}
            title="No file selected"
            body="Files Sayso writes or reads show up here with line numbers."
          />
        )}
      </div>
    </div>
  );
}
