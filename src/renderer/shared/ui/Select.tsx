import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
interface SelectProps {
  label: string;
  options: readonly (string | SelectOption)[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
}

export function Select({
  label,
  options,
  value,
  defaultValue,
  placeholder,
  disabled,
  onValueChange,
}: SelectProps) {
  const items = options.map((item) =>
    typeof item === 'string' ? { value: item, label: item } : item,
  );
  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue ?? (placeholder ? undefined : items[0]?.value)}
      disabled={disabled}
      onValueChange={onValueChange}
    >
      <SelectPrimitive.Trigger className="ui-select-trigger" aria-label={label}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={17} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="ui-select-content" position="popper" sideOffset={4}>
          <SelectPrimitive.ScrollUpButton className="ui-select-scroll">
            <ChevronUp size={16} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="ui-select-viewport">
            {items.map((item) => (
              <SelectPrimitive.Item
                className="ui-select-option"
                key={item.value}
                value={item.value}
                disabled={item.disabled}
              >
                <SelectPrimitive.ItemText>{item.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ui-select-indicator">
                  <Check size={16} aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="ui-select-scroll">
            <ChevronDown size={16} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
