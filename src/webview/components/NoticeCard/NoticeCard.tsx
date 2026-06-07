import './NoticeCard.less';
import { ComponentChildren } from 'preact';
import { useCollapsible } from '../Collapsible/useCollapsible';

export type NoticeVariant = 'warning' | 'info' | 'success';

interface NoticeCardProps {
  variant?: NoticeVariant;
  icon?: string;
  title: string;
  children?: ComponentChildren;
}

export function NoticeCard({ variant = 'warning', icon, title, children }: NoticeCardProps) {
  const defaultIcons: Record<NoticeVariant, string> = {
    warning: '⚠️',
    info: 'ℹ️',
    success: '✅',
  };

  // Only collapsible when there's a body to fold — a title-only notice gets no
  // chevron (no toggle that does nothing).
  const hasBody = !!children;
  const { displayed, toggle, chevron } = useCollapsible(true);

  return (
    <div class={`notice-card notice-card--${variant}`}>
      <div
        class={`notice-card-header${hasBody ? ' notice-card-header--toggle' : ''}`}
        onClick={hasBody ? toggle : undefined}
        role={hasBody ? 'button' : undefined}
        title={hasBody ? (displayed ? 'Collapse' : 'Expand') : undefined}
      >
        {hasBody && chevron}
        <span class="notice-card-icon">{icon || defaultIcons[variant]}</span>
        <span class="notice-card-title">{title}</span>
      </div>
      {hasBody && displayed && <div class="notice-card-body">{children}</div>}
    </div>
  );
}
