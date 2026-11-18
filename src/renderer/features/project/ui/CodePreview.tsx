import { lazy, Suspense } from 'react';
import type { OutputFile } from '../model/workspace.types';
const MonacoPreview = lazy(() => import('./MonacoPreview'));
export function CodePreview({ file }: { file: OutputFile }) {
  // Raw fallback remains selectable while the local engine loads.
  return (
    <Suspense fallback={<pre className="output-text">{file.content}</pre>}>
      <MonacoPreview file={file} />
    </Suspense>
  );
}
