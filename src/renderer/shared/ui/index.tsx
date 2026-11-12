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
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip label={title}>
      <button
        className={cx('icon-button', className)}
        aria-label={title}
        onClick={onClick}
        disabled={disabled}
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
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: string;
  disabled?: boolean;
}) {
  return (
    <button className={`button ${kind}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
export function SectionTitle({
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  children?: ReactNode;
}) {
  return children ? <div className="stage-actions">{children}</div> : null;
}
export function EmptyIntegration({ children }: { children: ReactNode }) {
  return (
    <div className="integration-note">
      <CircleHelp size={15} />
      <span>{children}</span>
    </div>
  );
}
