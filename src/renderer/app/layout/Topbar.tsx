import { Settings2 } from 'lucide-react';
import { useNavigation, type Page } from '@/shared/model/Navigation';
import { IconButton } from '@/shared/ui';
import { useStorage } from '@/shared/storage/Storage';
import { UpdateAction } from '@/features/updates/UpdateAction';

const sections: { page: Page; label: string }[] = [
  { page: 'projects', label: 'Проекты' },
  { page: 'library', label: 'Библиотека' },
  { page: 'agents', label: 'Агенты' },
];
export function Topbar() {
  const { page, navigate } = useNavigation();
  const { isDesktop, saving, error } = useStorage();
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
      <span className="prototype-label" role="status">
        {isDesktop
          ? error
            ? 'Требуется внимание'
            : saving
              ? 'Сохраняем…'
              : 'Сохранено'
          : 'Веб-макет · без сохранения'}
      </span>
      <UpdateAction />
      <IconButton
        title="Настройки"
        className="settings-button"
        onClick={() => navigate('settings')}
      >
        <Settings2 size={17} />
      </IconButton>
    </header>
  );
}
