import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Languages } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n, t } from '../../../shared/i18n/index.ts';
import { languages } from '../../../shared/i18n/locale';
import { chooseLanguage } from '../model/Language';
import { Tooltip } from './Tooltip';

export function LanguageSelect() {
  useTranslation(undefined, { i18n });
  const [error, setError] = useState(false);
  const language = i18n.resolvedLanguage === 'ru' ? 'ru' : 'en';
  return (
    <>
      <DropdownMenu.Root modal={false}>
        <Tooltip label={t('language.select')}>
          <DropdownMenu.Trigger
            className="icon-button language-select"
            aria-label={t('language.select')}
          >
            <Languages size={19} aria-hidden="true" />
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="ui-action-menu"
            align="end"
            sideOffset={5}
            collisionPadding={8}
          >
            <DropdownMenu.RadioGroup
              value={language}
              onValueChange={(value) => {
                if (value !== 'en' && value !== 'ru') return;
                setError(false);
                void chooseLanguage(value, !!window.studio).then(
                  (error) => setError(!!error),
                  () => setError(true),
                );
              }}
            >
              {languages.map((value) => (
                <DropdownMenu.RadioItem
                  key={value}
                  className="ui-action-menu-item"
                  value={value}
                  lang={value}
                >
                  <span className="language-check">
                    <DropdownMenu.ItemIndicator>
                      <Check size={16} aria-hidden="true" />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  {value.toUpperCase()}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error && <span role="alert">{t('language.writeError')}</span>}
    </>
  );
}
