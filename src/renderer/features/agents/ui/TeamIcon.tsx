import { forwardRef } from 'react';
import { UserRound, type LucideProps } from 'lucide-react';

/** Three people, composed entirely from the shared Lucide user glyph. */
export const TeamIcon = forwardRef<SVGSVGElement, LucideProps>(function TeamIcon(
  { className, strokeWidth },
  ref,
) {
  return (
    <span className={`agent-team-icon ${className ?? ''}`} aria-hidden="true">
      <UserRound size={14} strokeWidth={strokeWidth} />
      <UserRound size={14} strokeWidth={strokeWidth} />
      <UserRound ref={ref} size={16} strokeWidth={strokeWidth} />
    </span>
  );
});
