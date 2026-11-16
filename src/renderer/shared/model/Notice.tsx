import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { NoticeContext } from './Notice.context';
import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { CircleHelp, X } from 'lucide-react';
import { IconButton } from '../ui';

interface NoticeAction {
  label: string;
  onClick: () => void;
}
interface Notice {
  message: string;
  action?: NoticeAction;
}
export type NoticeContextValue = {
  demo: (message?: string, action?: NoticeAction) => void;
} | null;
export function NoticeProvider({ children }: { children: ReactNode }) {
  useTranslation(undefined, { i18n });
  const [toast, setToast] = useState<Notice | null>(null);
  const demo = useCallback(
    (message = t('Notice.thisIsAnInterfacePrototypeWorkingIntegration'), action?: NoticeAction) =>
      setToast({ message, action }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.action ? 10000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <NoticeContext.Provider value={{ demo }}>
      {children}
      {toast && (
        <div className="toast" role="status">
          <CircleHelp size={18} />
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action?.onClick();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <IconButton title={t('Notice.dismissNotification')} onClick={() => setToast(null)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </NoticeContext.Provider>
  );
}
export function useNotice() {
  useTranslation(undefined, { i18n });
  const value = useContext(NoticeContext);
  if (!value) throw new Error('NoticeProvider is missing');
  return value;
}
