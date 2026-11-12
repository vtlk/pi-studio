import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Dot,
  PersonStanding,
  Footprints,
  Zap,
  Hand,
  HandHelping,
  Lightbulb,
  Meh,
  Smile,
  Laugh,
  CircleAlert,
  Frown,
  Angry,
  CircleHelp,
  Brain,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/shared/ui';
import { Tooltip } from '@/shared/ui/Tooltip';
import { Switch } from '@/shared/ui/SelectionControls';
import {
  characterActions,
  characterEmotions,
  type CharacterPreviewOptions,
} from '../model/characterPreview';

const directions = [
  ['Влево-вверх', ArrowUpLeft],
  ['Вверх', ArrowUp],
  ['Вправо-вверх', ArrowUpRight],
  ['Влево', ArrowLeft],
  ['Прямо', Dot],
  ['Вправо', ArrowRight],
  ['Влево-вниз', ArrowDownLeft],
  ['Вниз', ArrowDown],
  ['Вправо-вниз', ArrowDownRight],
] as const;

const choiceIcons: Record<string, LucideIcon> = {
  idle: PersonStanding,
  walk: Footprints,
  run: Zap,
  wave: Hand,
  gesture: HandHelping,
  think: Lightbulb,
  neutral: Meh,
  smile: Smile,
  smirk: Laugh,
  fear: CircleAlert,
  sad: Frown,
  angry: Angry,
  surprised: CircleHelp,
  thinking: Brain,
};

function ChoiceButtons({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="character-choice-group">
      <span>{label}</span>
      <div className="character-choice-grid" role="group" aria-label={label}>
        {options.map((option) => {
          const Icon = choiceIcons[option.value];
          return (
            <button
              key={option.value}
              className="character-choice"
              type="button"
              aria-pressed={value === option.value}
              disabled={disabled}
              onClick={() => onChange(option.value)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CharacterControls({
  value,
  onChange,
  onBlink,
  disabled,
}: {
  value: CharacterPreviewOptions;
  onChange: (update: Partial<CharacterPreviewOptions>) => void;
  onBlink: () => void;
  disabled: boolean;
}) {
  return (
    <div className="character-controls" role="group" aria-label="Анимация персонажа">
      <ChoiceButtons
        label="Действие"
        options={characterActions}
        value={value.action}
        disabled={disabled}
        onChange={(action) => onChange({ action })}
      />
      <ChoiceButtons
        label="Эмоция"
        options={characterEmotions}
        value={value.emotion}
        disabled={disabled}
        onChange={(emotion) => onChange({ emotion })}
      />
      <label className="preview-range">
        Выразительность <output>{Math.round(value.intensity * 100)}%</output>
        <input
          aria-label="Выразительность"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={value.intensity}
          onChange={(event) => onChange({ intensity: Number(event.target.value) })}
          disabled={disabled}
        />
      </label>
      <div className="gaze-controls">
        <span>Направление зрачков</span>
        <div className="gaze-grid" role="group" aria-label="Направление зрачков">
          {directions.map(([label, Icon], index) => {
            const x = (index % 3) - 1,
              y = Math.floor(index / 3) - 1;
            const active =
              value.manualGaze && !value.autoGaze && value.gazeX === x && value.gazeY === y;
            return (
              <Tooltip key={label} label={label}>
                <button
                  className="gaze-direction"
                  aria-label={label}
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() =>
                    onChange({ gazeX: x, gazeY: y, manualGaze: true, autoGaze: false })
                  }
                >
                  <Icon size={19} aria-hidden="true" />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <label className="control-line">
        <span>Живой взгляд</span>
        <Switch
          label="Живой взгляд"
          checked={value.autoGaze}
          disabled={disabled}
          onChange={(autoGaze) => onChange({ autoGaze, manualGaze: !autoGaze })}
        />
      </label>
      <label className="preview-range">
        Наклон головы <output>{value.headTilt}°</output>
        <input
          aria-label="Наклон головы"
          type="range"
          min="-10"
          max="10"
          step="1"
          value={value.headTilt}
          onChange={(event) => onChange({ headTilt: Number(event.target.value) })}
          disabled={disabled}
        />
      </label>
      <div className="preview-actions">
        <Button onClick={onBlink} disabled={disabled}>
          Моргнуть
        </Button>
      </div>
      {disabled && <p className="subtle">Для анимации выберите SVG.</p>}
    </div>
  );
}
