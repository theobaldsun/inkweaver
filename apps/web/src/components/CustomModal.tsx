/**
 * 自定义确认弹窗与全局 Alert（showAlert）。
 */
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";
import React, { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

interface CustomModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  showCustomContent?: boolean;
  customContent?: React.ReactNode;
}

interface AlertConfig {
  title: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
}

const CustomModal: React.FC<CustomModalProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  showCustomContent = false,
  customContent = null,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="关闭对话框">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p id={descriptionId} className="custom-modal-message">
            {message}
          </p>
          {showCustomContent && customContent}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            autoFocus
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
};

const AlertIcon: React.FC<{ type: AlertConfig["type"] }> = ({ type }) => {
  switch (type) {
    case "success":
      return <CheckCircle size={24} className="alert-icon success" />;
    case "error":
      return <AlertCircle size={24} className="alert-icon error" />;
    case "warning":
      return <AlertTriangle size={24} className="alert-icon warning" />;
    case "info":
    default:
      return <Info size={24} className="alert-icon info" />;
  }
};

type AlertState = {
  isOpen: boolean;
  config: AlertConfig;
  resolve: (value: boolean) => void;
};

let alertState: AlertState | null = null;
let alertVersion = 0;
const alertListeners = new Set<() => void>();

function notifyAlertListeners(): void {
  alertVersion += 1;
  alertListeners.forEach((listener) => listener());
}

function subscribeAlert(listener: () => void): () => void {
  alertListeners.add(listener);
  return () => alertListeners.delete(listener);
}

function getAlertSnapshot(): number {
  return alertVersion;
}

export const Alert: React.FC = () => {
  useSyncExternalStore(subscribeAlert, getAlertSnapshot, getAlertSnapshot);

  if (!alertState || !alertState.isOpen) return null;

  const handleClose = () => {
    if (alertState) {
      alertState.resolve(true);
      alertState = null;
      notifyAlertListeners();
    }
  };

  const { config } = alertState;

  return createPortal(
    <div className="alert-overlay" onClick={handleClose} role="presentation">
      <div
        className="alert-content"
        role="alertdialog"
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="alert-icon-wrapper">
          <AlertIcon type={config.type} />
        </div>
        <h3 id="alert-dialog-title" className="alert-title">
          {config.title}
        </h3>
        <p id="alert-dialog-desc" className="alert-message">
          {config.message}
        </p>
        <button
          type="button"
          className="btn btn-primary alert-confirm-btn"
          onClick={handleClose}
          autoFocus
        >
          确定
        </button>
      </div>
    </div>,
    document.body,
  );
};

/**
 * 显示全局 Alert。
 *
 * 注意：若已有 Alert 在显示中，新的调用会先 resolve 旧 Promise（以 false），
 * 再展示新 Alert，防止旧 Promise 永远挂起。
 *
 * @returns 用户点击确定后 resolve true；若被新 Alert 抢占则 resolve false
 */
export const showAlert = (
  title: string,
  message: string,
  type: AlertConfig["type"] = "info",
): Promise<boolean> => {
  // 若已有 Alert 正在显示，先 resolve 旧 Promise（避免内存泄漏）
  if (alertState?.isOpen) {
    alertState.resolve(false);
  }
  return new Promise((resolve) => {
    alertState = {
      isOpen: true,
      config: { title, message, type },
      resolve,
    };
    notifyAlertListeners();
  });
};

export default CustomModal;
