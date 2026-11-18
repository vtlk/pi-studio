import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useLayoutEffect, useRef } from 'react';
import { Settings2 } from 'lucide-react';
import { useNavigation, type Page } from '@/shared/model/Navigation';
import { useStorage } from '@/shared/storage/Storage';
import { UpdateAction } from '@/features/updates/UpdateAction';
import { LanguageSelect } from '@/shared/ui/LanguageSelect';
import { ThemeToggle } from '@/shared/ui/ThemeToggle';
import { useOnboarding } from '@/features/onboarding/Onboarding';
import { useWorkspace } from '@/features/project/model/Workspace';
import { PiProcesses } from '@/features/chat/PiProcesses';

const sections: { page: Page; label: import('../../../shared/i18n').MessageKey }[] = [
  { page: 'projects', label: 'Topbar.projects' },
  { page: 'agents', label: 'Topbar.agents' },
];
export function Topbar() {
  useTranslation(undefined, { i18n });
  const { page, navigate, openProjects } = useNavigation();
  const { selectedProject } = useWorkspace();
  const onboarding = useOnboarding();
  const { isDesktop, saving, recentlySaved, error } = useStorage();
  const navigation = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const language = i18n.resolvedLanguage;
  useLayoutEffect(() => {
    const nav = navigation.current;
    const backdrop = indicator.current;
    if (!nav || !backdrop) return;
    const measure = () => {
      const active = nav.querySelector<HTMLButtonElement>('button[aria-current="page"]');
      const wasHidden = backdrop.hidden;
      backdrop.hidden = !active;
      if (!active) return;
      // Position the first visible frame without a slide from the edge of the menu.
      if (wasHidden) backdrop.style.transition = 'none';
      backdrop.style.transform = `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`;
      backdrop.style.width = `${active.offsetWidth}px`;
      backdrop.style.height = `${active.offsetHeight}px`;
      if (wasHidden) {
        backdrop.getBoundingClientRect();
        backdrop.style.removeProperty('transition');
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    nav.querySelectorAll('button').forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [page, onboarding.visible, language]);
  return (
    <header className="topbar">
      <nav ref={navigation} aria-label={t('Topbar.mainMenu')}>
        {sections.map((section) => (
          <button
            key={section.page}
            aria-current={
              page === section.page || (page === 'project' && section.page === 'projects')
                ? 'page'
                : undefined
            }
            onClick={() => {
              if (section.page === 'projects' && selectedProject) openProjects();
              else navigate(section.page);
            }}
          >
            {t(section.label)}
          </button>
        ))}
        {onboarding.visible && (
          <button
            aria-current={page === 'onboarding' ? 'page' : undefined}
            onClick={() => navigate('onboarding')}
          >
            {t('Onboarding.title')}
          </button>
        )}
        <span ref={indicator} className="topbar-nav-indicator" aria-hidden="true" hidden />
      </nav>
      <span
        className="prototype-label"
        role="status"
        data-save-state={error ? 'error' : saving ? 'saving' : 'idle'}
      >
        {isDesktop
          ? error
            ? t('Topbar.attentionRequired')
            : saving
              ? t('Topbar.saving')
              : recentlySaved
                ? t('Topbar.saved')
                : ''
          : t('Topbar.webPreviewChangesAreNotSaved')}
      </span>
      <UpdateAction />
      <PiProcesses />
      <LanguageSelect />
      <ThemeToggle />
      <button
        className="button settings-button"
        aria-current={page === 'settings' ? 'page' : undefined}
        onClick={() => navigate('settings')}
      >
        <Settings2 size={17} aria-hidden="true" />
        {t('Topbar.settings')}
      </button>
    </header>
  );
}
