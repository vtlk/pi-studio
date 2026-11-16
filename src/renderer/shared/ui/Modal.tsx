import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useControlScope } from './ControlScope.context';
import { useContext, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './index';
import { ModalSizeContext, type ModalSize } from './ModalSize.context';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  alert?: boolean;
  inert?: boolean;
  dismissible?: boolean;
  size?: ModalSize;
}
export function Modal({
  title,
  onClose,
  children,
  footer,
  alert = false,
  inert = false,
  dismissible = true,
  size,
}: ModalProps) {
  useTranslation(undefined, { i18n });
  const controlsScope = useControlScope();
  const inheritedSize = useContext(ModalSizeContext);
  const currentSize = size ?? inheritedSize;
  const ref = useRef<HTMLElement>(null);
  const returnFocus = useRef(document.activeElement);
  useEffect(() => {
    const previous = returnFocus.current;
    const panel = ref.current;
    if (panel && !panel.contains(document.activeElement))
      (
        panel.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled)') ??
        panel.querySelector<HTMLElement>('button:not(:disabled)')
      )?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (dismissible) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ),
    ].filter((element) => element.getClientRects().length > 0);
    const first = items[0],
      last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return (
    <ModalSizeContext.Provider value={currentSize}>
      <div
        inert={inert || undefined}
        className={`modal-backdrop dialog-backdrop${alert ? ' confirmation-backdrop' : ''}`}
        onMouseDown={(event) => {
          if (dismissible && event.target === event.currentTarget) onClose();
        }}
      >
        <section
          ref={ref}
          className="dialog"
          data-controls-scope={controlsScope}
          data-size={currentSize}
          role={alert ? 'alertdialog' : 'dialog'}
          aria-modal="true"
          aria-label={title}
          onKeyDown={onKeyDown}
        >
          <header className="dialog-header">
            <h2>{title}</h2>
            {dismissible && (
              <IconButton title={t('Modal.closeWindow')} onClick={onClose}>
                <X size={20} />
              </IconButton>
            )}
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-footer">{footer}</footer>}
        </section>
      </div>
    </ModalSizeContext.Provider>
  );
}
