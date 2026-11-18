import { useActiveCodePreview } from '../model/CodePreviewOptions';
import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/base/browser/ui/codicons/codicon/codicon.css';
import 'monaco-editor/editor/standalone/browser/standalone-tokens.css';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/languages/definitions/register.all.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { useTheme } from '@/shared/model/Theme';
import { isFindShortcut } from '@/shared/ui/literalSearch';
import type { OutputFile } from '../model/workspace.types';
import { codeLanguage } from '../../../../shared/codeLanguage';
import { t } from '../../../../shared/i18n';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
// JSON tokenization only: no schema fetching, language servers or execution.
monaco.languages.register({ id: 'json' });
monaco.languages.setMonarchTokensProvider('json', {
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'key'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
    ],
  },
});
for (const dark of [false, true])
  monaco.editor.defineTheme(`pistudio-${dark ? 'dark' : 'light'}`, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': dark ? '#222221' : '#ffffff',
      'editor.foreground': dark ? '#f0eeea' : '#242530',
      'editorLineNumber.foreground': dark ? '#b6b3ad' : '#71717a',
      'editorGutter.background': dark ? '#222221' : '#ffffff',
    },
  });

export default function MonacoPreview({ file }: { file: OutputFile }) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { theme } = useTheme();
  const wrap = useActiveCodePreview();
  useEffect(() => {
    const model = monaco.editor.createModel(
      file.content ?? '',
      codeLanguage(file.name) ?? 'plaintext',
    );
    const view = monaco.editor.create(container.current!, {
      model,
      theme: `pistudio-${theme}`,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      scrollBeyondLastLine: false,
      wordWrap: wrap ? 'on' : 'off',
      lineNumbersMinChars: 3,
      padding: { top: 12, bottom: 12 },
      contextmenu: false,
      links: false,
      hover: { enabled: 'off' },
      renderLineHighlight: 'none',
      stickyScroll: { enabled: false },
      unicodeHighlight: { ambiguousCharacters: false },
      ariaLabel: t('SearchablePreview.filePreview'),
      find: { addExtraSpaceOnTop: false },
    });
    editor.current = view;
    const find = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"],[role="alertdialog"]'))
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest('textarea,input,[contenteditable="true"]') &&
        !container.current?.contains(target)
      )
        return;
      if (!isFindShortcut(event, navigator.platform.toLowerCase().includes('mac'))) return;
      // The editor handles its own focused shortcuts. Elsewhere, search the visible file.
      if (container.current?.closest('[inert]')) return;
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      void view.getAction('actions.find')?.run();
    };
    window.addEventListener('keydown', find);
    return () => {
      window.removeEventListener('keydown', find);
      editor.current = null;
      view.dispose();
      model.dispose();
    };
    // Parent identity remounts on file/fingerprint changes; theme changes retain selection/search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    editor.current?.updateOptions({ theme: `pistudio-${theme}` });
  }, [theme]);
  useEffect(() => {
    editor.current?.updateOptions({ wordWrap: wrap ? 'on' : 'off' });
  }, [wrap]);
  return <div className="monaco-file-preview" ref={container} />;
}
