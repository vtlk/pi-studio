import test from 'node:test';
import assert from 'node:assert/strict';
import { changeLanguage, t } from '../src/shared/i18n/index.ts';
import { builtinResources, browserMcp } from '../src/shared/builtinResources.ts';
import { createSystemAgents } from '../src/shared/systemAgents.ts';
import {
  agentTabLabel,
  reasoningLabel,
  agentName,
} from '../src/renderer/shared/model/localizedProfiles.ts';
import { resourceLabel, resourceVersion } from '../src/renderer/shared/model/localizedResources.ts';
import { uiText, textOf } from '../src/renderer/shared/model/UiText.ts';
import { openingFailureText } from '../src/shared/openingFailure.ts';

test('all built-in metadata, modal tab labels and reasoning follow live locale without changing saved values', async () => {
  const resources = structuredClone(builtinResources);
  const original = structuredClone(resources);
  const assistant = createSystemAgents(() => 'assistant')[0];
  const assistantName = assistant.name;
  const pending = uiText('AgentList.deleteTeam2', { value1: 'Моя команда' });
  for (const language of ['en', 'ru', 'en'] as const) {
    await changeLanguage(language);
    const labels = resources.map((resource) => resourceLabel(resource, 'name'));
    assert.ok(labels.includes(language === 'en' ? 'Pi Studio · Browser' : 'Pi Studio · Браузер'));
    assert.ok(
      labels.includes(language === 'en' ? 'Pi Studio · Computer' : 'Pi Studio · Компьютер'),
    );
    assert.ok(labels.includes('Pi Studio Team'));
    for (const resource of resources) {
      const description = resourceLabel(resource, 'description');
      assert.ok(description);
      assert.equal(/[А-Яа-яЁё]/.test(description), language === 'ru');
    }
    assert.equal(agentTabLabel('Плагины'), language === 'en' ? 'Plugins' : 'Плагины');
    assert.equal(
      t('CapabilitiesPanel.sharedCatalog', { value1: agentTabLabel('Плагины') }),
      language === 'en' ? 'Shared catalog · Plugins' : 'Общий каталог · Плагины',
    );
    assert.equal(reasoningLabel('По умолчанию'), language === 'en' ? 'Default' : 'По умолчанию');
    assert.equal(reasoningLabel('Высокий'), language === 'en' ? 'High' : 'Высокий');
    assert.equal(agentName(assistant), language === 'en' ? 'Setup assistant' : assistantName);
    assert.ok(textOf(pending).includes('Моя команда'));
    assert.equal(textOf(pending).startsWith('Delete'), language === 'en');
    assert.equal(/[А-Яа-яЁё]/.test(openingFailureText({ kind: 'model' })), language === 'ru');
  }
  assert.deepEqual(resources, original);
  assert.equal(assistant.name, assistantName);
  assert.equal(agentName({ ...assistant, name: 'Мой помощник' }), 'Мой помощник');
  assert.equal(
    resourceLabel({ ...browserMcp, name: 'Старое системное название' }, 'name'),
    'Pi Studio · Browser',
  );
  assert.equal(
    resourceLabel({ ...browserMcp, id: 'custom', source: 'pi:custom', name: 'Мой MCP' }, 'name'),
    'Мой MCP',
  );
  assert.equal(
    resourceVersion({ ...browserMcp, version: 'Текущий локальный файл' }),
    'Current local file',
  );
});
