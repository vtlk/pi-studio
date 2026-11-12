import { Settings2 } from 'lucide-react';
import { useNavigation, type Page } from '@/shared/model/Navigation';
import { IconButton } from '@/shared/ui';

const sections: { page: Page; label: string }[] = [
  { page: 'projects', label: 'Проекты' },
  { page: 'library', label: 'Библиотека' },
  { page: 'agents', label: 'Агенты' },
];
export function Topbar() {
  const { page, navigate } = useNavigation();
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
      <span className="prototype-label">Прототип · без сохранения</span>
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
