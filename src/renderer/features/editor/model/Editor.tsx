import { useContext, useState, type ReactNode } from 'react';
import { EditorContext } from './Editor.context';
import { createDocument, type DemoTimeline, type EditorDocument } from './timeline';
function useEditorState() {
  const [documents, setDocuments] = useState<Record<string, EditorDocument>>({});
  return {
    documents,
    update: (
      key: string,
      initial: DemoTimeline,
      update: (document: EditorDocument) => EditorDocument,
    ) =>
      setDocuments((previous) => ({
        ...previous,
        [key]: update(previous[key] ?? createDocument(initial)),
      })),
  };
}
export type EditorValue = ReturnType<typeof useEditorState>;
export function EditorProvider({ children }: { children: ReactNode }) {
  return <EditorContext.Provider value={useEditorState()}>{children}</EditorContext.Provider>;
}
export function useEditorDocument(key: string, initial: DemoTimeline) {
  const value = useContext(EditorContext);
  if (!value) throw new Error('EditorProvider is missing');
  const document = value.documents[key] ?? createDocument(initial);
  return {
    document,
    update: (change: (document: EditorDocument) => EditorDocument) =>
      value.update(key, initial, change),
  };
}
