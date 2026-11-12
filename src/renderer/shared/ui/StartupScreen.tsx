import type { ReactNode } from 'react';

export function StartupScreen({
  message,
  progress,
  error = false,
  children,
}: {
  message: string;
  progress?: number;
  error?: boolean;
  children?: ReactNode;
}) {
  const value =
    progress === undefined ? undefined : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="startup-screen">
      <div className="startup-center">
        <img
          className="startup-icon"
          src={`${import.meta.env.BASE_URL}branding/pi-studio-icon.png`}
          alt=""
        />
        <h1>Pi Studio</h1>
        {!error && (
          <div
            className={`startup-progress${value === undefined ? ' indeterminate' : ''}`}
            role="progressbar"
            aria-label="Подготовка Pi Studio"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
            aria-valuetext={message}
          >
            <span style={value === undefined ? undefined : { width: `${value}%` }} />
          </div>
        )}
        <p
          className={error ? 'startup-message startup-failure' : 'startup-message'}
          role={error ? 'alert' : 'status'}
        >
          {message}
        </p>
        {children && <div className="startup-actions">{children}</div>}
      </div>
    </div>
  );
}
