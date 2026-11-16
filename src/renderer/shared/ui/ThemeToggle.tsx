import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../model/Theme';
import { IconButton } from './index';

export function ThemeToggle() {
  useTranslation(undefined, { i18n });
  const { theme, toggle } = useTheme();
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <IconButton
      className="theme-toggle"
      title={
        theme === 'dark' ? t('ThemeToggle.switchToLightTheme') : t('ThemeToggle.switchToDarkTheme')
      }
      onClick={toggle}
    >
      <Icon size={19} aria-hidden="true" />
    </IconButton>
  );
}
