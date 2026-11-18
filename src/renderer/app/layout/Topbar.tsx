import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
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
  return (
    <header className="topbar">
      <nav aria-label={t('Topbar.mainMenu')}>
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
