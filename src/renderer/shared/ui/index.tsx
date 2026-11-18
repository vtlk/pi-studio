import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Tooltip } from './Tooltip';
export const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');
export const timecode = (value: number) =>
  `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(value % 60)
    .toString()
    .padStart(2, '0')}`;
export function IconButton({
  children,
  title,
  label,
  onClick,
  disabled,
  busy = false,
  className,
  pressed,
}: {
  children: ReactNode;
  title: string;
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  pressed?: boolean;
}) {
  return (
    <Tooltip label={title}>
      <button
        className={cx('icon-button', className)}
        aria-label={label ?? title}
        aria-pressed={pressed}
        aria-busy={busy || undefined}
        onClick={onClick}
        disabled={disabled || busy}
      >
        {children}
      </button>
    </Tooltip>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Button({
  children,
  onClick,
  kind = 'secondary',
  disabled = false,
  busy = false,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: string;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      className={cx('button', kind, className)}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {children}
    </button>
  );
}
export function EmptyIntegration({ children }: { children: ReactNode }) {
  return (
    <div className="integration-note">
      <CircleHelp size={15} />
      <span>{children}</span>
    </div>
  );
}
