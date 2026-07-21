import React, { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { X, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  type?: 'default' | 'success' | 'error' | 'warning' | 'info';
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  showCancel?: boolean;
}

const iconMap = {
  default: Info,
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap = {
  default: '#3b82f6',
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

export const CustomModal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  type = 'default',
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
  showCancel = true,
}) => {
  if (!isOpen) return null;

  const Icon = iconMap[type];
  const iconColor = colorMap[type];

  return (
    <div className="custom-modal-overlay" onClick={onClose}>
      <div className="custom-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          <div className="custom-modal-icon" style={{ color: iconColor }}>
            <Icon size={24} />
          </div>
          <h3 className="custom-modal-title">{title}</h3>
          <button className="custom-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="custom-modal-body">
          {children}
        </div>
        {onConfirm && (
          <div className="custom-modal-footer">
            {showCancel && (
              <button className="custom-modal-btn custom-modal-btn-secondary" onClick={onClose}>
                {cancelText}
              </button>
            )}
            <button 
              className="custom-modal-btn custom-modal-btn-primary" 
              onClick={onConfirm}
              style={{ background: type === 'success' ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' : undefined }}
            >
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

type AlertConfig = {
  title: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info' | 'default';
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
  alertListeners.forEach((l) => l());
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
  if (!alertState?.isOpen) return null;

  const handleClose = () => {
    if (alertState) {
      alertState.resolve(true);
      alertState = null;
      notifyAlertListeners();
    }
  };

  const { config } = alertState;
  const modalType = config.type === 'default' ? 'info' : config.type;

  return (
    <CustomModal
      isOpen
      onClose={handleClose}
      title={config.title}
      type={modalType}
      confirmText="确定"
      onConfirm={handleClose}
      showCancel={false}
    >
      <p className="custom-modal-message">{config.message}</p>
    </CustomModal>
  );
};

export const showAlert = (
  title: string,
  message: string,
  type: ModalProps['type'] = 'default',
): Promise<boolean> => {
  const alertType = type === 'default' ? 'info' : type;
  return new Promise((resolve) => {
    alertState = {
      isOpen: true,
      config: { title, message, type: alertType },
      resolve,
    };
    notifyAlertListeners();
  });
};

export const showConfirm = (
  title: string,
  message: string,
  onConfirm: () => void,
  onCancel?: () => void
): { close: () => void } => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  let isMounted = true;
  let root: Root | null = null;

  const close = () => {
    if (isMounted && root) {
      isMounted = false;
      root.unmount();
      container.remove();
    }
  };

  const ConfirmModal: React.FC = () => (
    <CustomModal
      isOpen={true}
      onClose={() => {
        onCancel?.();
        close();
      }}
      title={title}
      type="default"
      confirmText="确定"
      cancelText="取消"
      onConfirm={() => {
        onConfirm();
        close();
      }}
      showCancel={true}
    >
      <p className="custom-modal-message">{message}</p>
    </CustomModal>
  );

  root = createRoot(container);
  root.render(<ConfirmModal />);

  return { close };
};
