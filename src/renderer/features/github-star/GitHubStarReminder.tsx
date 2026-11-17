import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n, t } from '../../../shared/i18n/index.ts';
import {
  githubRepositoryUrl,
  type GitHubStarChoice,
  type GitHubStarState,
} from '../../../shared/githubStar';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';
import { uiText } from '@/shared/model/UiText';

export function GitHubStarReminder() {
  useTranslation(undefined, { i18n });
  const [state, setState] = useState<GitHubStarState>();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const choosing = useRef(false);
  const { demo: notify } = useNotice();
  useEffect(() => {
    const api = window.studio;
    if (!api) return;
    let active = true,
      received = false;
    const unsubscribe = api.onGitHubStarChanged((next) => {
      received = true;
      if (active) setState(next);
    });
    void api
      .getGitHubStar()
      .then((initial) => {
        if (active && !received) setState(initial);
      })
      .catch(() => {
        /* An optional reminder cannot block Studio startup. */
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const due = state?.due === true;
  const eligible = state?.canPresent === true;
  useEffect(() => {
    if (!due) {
      const frame = requestAnimationFrame(() => setVisible(false));
      return () => cancelAnimationFrame(frame);
    }
    if (visible || !eligible || busy) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (
          !choosing.current &&
          document.visibilityState === 'visible' &&
          document.hasFocus() &&
          !document.querySelector('[aria-modal="true"]')
        )
          setVisible(true);
      });
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal'],
    });
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    check();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [due, eligible, visible, busy]);
  const choose = async (choice: GitHubStarChoice) => {
    if (choosing.current || !window.studio) return;
    choosing.current = true;
    setBusy(true);
    setVisible(false);
    try {
      const next = await window.studio.chooseGitHubStar(choice);
      setState(next);
      if (next.error === 'write') notify(uiText('githubStar.writeError'));
      if (next.error === 'open') notify(uiText('githubStar.openError'));
    } catch {
      notify(uiText('githubStar.writeError'));
    } finally {
      choosing.current = false;
      setBusy(false);
    }
  };
  if (!visible || !due) return null;
  return (
    <Modal
      title={t('githubStar.title')}
      showCloseButton={false}
      onClose={() => {
        void choose('later');
      }}
      footer={
        <>
          <Button
            onClick={() => {
              void choose('later');
            }}
          >
            {t('githubStar.later')}
          </Button>
          <Button
            kind="primary"
            onClick={() => {
              void choose('open');
            }}
          >
            {t('githubStar.open')}
          </Button>
        </>
      }
    >
      <p>{githubRepositoryUrl}</p>
    </Modal>
  );
}
