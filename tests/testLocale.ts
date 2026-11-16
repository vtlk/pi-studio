// Existing regression fixtures assert Russian diagnostics; language behavior tests select their own locale.
import { changeLanguage } from '../src/shared/i18n/index.ts';
await changeLanguage('ru');
