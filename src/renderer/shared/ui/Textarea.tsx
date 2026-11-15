import type { ComponentPropsWithRef } from 'react';

/** Shared multiline field; native vertical resizing preserves keyboard and text editing behavior. */
export function Textarea({ className, ...props }: ComponentPropsWithRef<'textarea'>) {
  return <textarea {...props} className={['ui-textarea', className].filter(Boolean).join(' ')} />;
}
