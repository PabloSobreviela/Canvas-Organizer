import React from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

const NOTICE_STYLES = {
  success: {
    icon: CheckCircle2,
    className: "od-mobile-notice-success",
  },
  warning: {
    icon: AlertTriangle,
    className: "od-mobile-notice-warning",
  },
  error: {
    icon: AlertTriangle,
    className: "od-mobile-notice-error",
  },
  info: {
    icon: Info,
    className: "od-mobile-notice-info",
  },
};

export function MobileNotice({ notice, onDismiss }) {
  if (!notice) return null;

  const tone = NOTICE_STYLES[notice.tone] || NOTICE_STYLES.info;
  const Icon = tone.icon;
  const role = notice.tone === "error" ? "alert" : "status";

  const handleAction = () => {
    const action = notice.onAction;
    onDismiss();
    action?.();
  };

  return (
    <section
      key={notice.id}
      role={role}
      aria-live={notice.tone === "error" ? "assertive" : "polite"}
      className={`od-mobile-notice ${tone.className}`}
    >
      <Icon size={19} className="od-mobile-notice-icon" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">{notice.title}</p>
        {notice.message ? (
          <p className="mt-0.5 text-xs leading-relaxed opacity-80">{notice.message}</p>
        ) : null}
      </div>
      {notice.actionLabel && notice.onAction ? (
        <button type="button" onClick={handleAction} className="od-mobile-notice-action">
          {notice.actionLabel}
        </button>
      ) : null}
      <button type="button" onClick={onDismiss} className="od-mobile-notice-close" aria-label="Dismiss message">
        <X size={16} />
      </button>
    </section>
  );
}
