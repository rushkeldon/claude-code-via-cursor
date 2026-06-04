import './NoticeCard.less';
import { ComponentChildren } from 'preact';

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

  return (
    <div class={`notice-card notice-card--${variant}`}>
      <div class="notice-card-header">
        <span class="notice-card-icon">{icon || defaultIcons[variant]}</span>
        <span class="notice-card-title">{title}</span>
      </div>
      {children && <div class="notice-card-body">{children}</div>}
    </div>
  );
}
