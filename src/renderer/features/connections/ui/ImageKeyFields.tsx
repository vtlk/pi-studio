import { Button } from '@/shared/ui';
import { useConfirm } from '@/shared/model/Confirm';
import { useNotice } from '@/shared/model/Notice';
import { useStorage } from '@/shared/storage/Storage';
import { useConnections } from '../model/Connections';

export function ImageKeyFields({
  id,
  value,
  setValue,
  busy,
  setBusy,
}: {
  id: string;
  value: string;
  setValue: (value: string) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const { bootstrap } = useStorage();
  const { imageStatuses, refreshImageConnection } = useConnections();
  const status = imageStatuses[id];
  const { confirm } = useConfirm(),
    { demo } = useNotice();
  return (
    <>
      <p>
        Images API оплачивается отдельно от подписки. Сохранение ключа и проверка каталога не
        генерируют изображения.
      </p>
      <label className="field-label">
        API-ключ
        <input
          type="password"
          aria-label="API-ключ изображений"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={!window.studio || busy}
          placeholder={
            status?.keyStored ? 'Ключ сохранён · введите новый для замены' : 'Введите API-ключ'
          }
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <p className="subtle">
        Ключ защищён хранилищем macOS, сохраняется на этом Mac и не возвращается в окно приложения.
        Новое значение применяется кнопкой «Сохранить».
      </p>
      {status?.keyStored && (
        <Button
          disabled={busy}
          onClick={() =>
            confirm({
              title: 'Удалить API-ключ?',
              description:
                'Ключ будет удалён с этого Mac. Подключение и ссылки агентов останутся; для генерации понадобится ввести ключ заново.',
              confirmLabel: 'Удалить ключ',
              onConfirm: () => {
                if (!window.studio || !bootstrap) return;
                setBusy(true);
                void window.studio
                  .removeImageKey({ folder: bootstrap.folder, connectionId: id })
                  .then(async () => {
                    setValue('');
                    await refreshImageConnection(id);
                  })
                  .catch((error) =>
                    demo(error instanceof Error ? error.message : 'Не удалось удалить ключ.'),
                  )
                  .finally(() => setBusy(false));
              },
            })
          }
        >
          Удалить сохранённый ключ
        </Button>
      )}
      {status && (
        <p role="status">
          {!status.keyStored
            ? 'Ключ не сохранён.'
            : status.authentication === 'ready'
              ? 'Ключ принят API. Доступ к генерации проверяется только при её вызове.'
              : status.authentication === 'invalid'
                ? 'API не принял ключ.'
                : status.authentication === 'restricted'
                  ? 'API ограничил доступ. Проверьте разрешения ключа и проекта OpenAI.'
                  : 'Ключ сохранён. Авторизация ещё не проверена.'}
        </p>
      )}
    </>
  );
}
