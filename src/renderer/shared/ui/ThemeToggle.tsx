import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../model/Theme';
import { IconButton } from './index';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <IconButton
      className="theme-toggle"
      title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
      onClick={toggle}
    >
      <Icon size={19} aria-hidden="true" />
    </IconButton>
  );
}
