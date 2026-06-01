/**
 * 自定义确认弹窗与全局 Alert（showAlert）。
 */
import React, { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

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
  type: 'success' | 'error' | 'warning' | 'info';
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
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onCancel}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p className="custom-modal-message">{message}</p>
          {showCustomContent && customContent}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-primary" onClick={onConfirm}>
            确认
          </button>
        </div>
      </div>
    </div>
  );
};

const AlertIcon: React.FC<{ type: AlertConfig['type'] }> = ({ type }) => {
  switch (type) {
    case 'success':
      return <CheckCircle size={24} className="alert-icon success" />;
    case 'error':
      return <AlertCircle size={24} className="alert-icon error" />;
    case 'warning':
      return <AlertTriangle size={24} className="alert-icon warning" />;
    case 'info':
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
        <button type="button" className="btn btn-primary alert-confirm-btn" onClick={handleClose}>
          确定
        </button>
      </div>
    </div>,
    document.body,
  );
};

/**
 * 显示全局 Alert。
 * @returns 用户点击确定后 resolve true
 */
export const showAlert = (title: string, message: string, type: AlertConfig['type'] = 'info'): Promise<boolean> => {
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