import { t } from '../../../shared/i18n/index.ts';
// Shared tool names. Connection state belongs to the connections feature.
export const coreTools = () =>
  [
    { id: 'web-search', name: t('tools.webSearch') },
    { id: 'generate-image', name: t('tools.imageGeneration') },
  ] as const;
