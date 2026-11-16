import { Settings2 } from 'lucide-react';
import { useNavigation, type Page } from '@/shared/model/Navigation';
import { Button } from '@/shared/ui';
import { useStorage } from '@/shared/storage/Storage';
import { UpdateAction } from '@/features/updates/UpdateAction';
import { ThemeToggle } from '@/shared/ui/ThemeToggle';

const sections: { page: Page; label: string }[] = [
  { page: 'projects', label: 'Проекты' },
  { page: 'agents', label: 'Агенты' },
];
export function Topbar() {
  const { page, navigate } = useNavigation();
  const { isDesktop, saving, recentlySaved, error } = useStorage();
  return (
    <header className="topbar">
      <nav aria-label="Главное меню">
        {sections.map((section) => (
          <button
            key={section.page}
            aria-current={
              page === section.page || (page === 'project' && section.page === 'projects')
                ? 'page'
                : undefined
            }
            onClick={() => navigate(section.page)}
          >
            {section.label}
          </button>
        ))}
      </nav>
      <span
        className="prototype-label"
        role="status"
        data-save-state={error ? 'error' : saving ? 'saving' : 'idle'}
      >
        {isDesktop
          ? error
            ? 'Требуется внимание'
            : saving
              ? 'Сохраняем…'
              : recentlySaved
                ? 'Сохранено'
                : ''
          : 'Веб-макет · без сохранения'}
      </span>
      <UpdateAction />
      <ThemeToggle />
      <Button kind="primary" className="settings-button" onClick={() => navigate('settings')}>
        <Settings2 size={17} aria-hidden="true" />
        Настройки
      </Button>
    </header>
  );
}
