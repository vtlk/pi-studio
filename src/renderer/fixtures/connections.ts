import type { Connection } from '../../shared/connections';

export const exampleConnections: Connection[] = [
  {
    id: 'codex-subscription',
    name: 'Codex — подписка',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 2,
  },
  {
    id: 'images-api',
    name: 'OpenAI — изображения API',
    purpose: 'images',
    providerId: 'openai',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
];
