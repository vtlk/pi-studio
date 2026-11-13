import { Preview } from '@/features/preview/ui/Preview';
export function ExportStage() {
  return (
    <div className="stage-page">
      <Preview full />
      <p>
        Рендер MP4 выполняет агент через bash по вашему заданию. Готовый файл появляется в его
        output; для правок продолжите тот же диалог Pi.
      </p>
    </div>
  );
}
