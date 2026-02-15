
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { TIMING } from '../../constants';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastActions {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastStateContext = createContext<Toast[]>([]);
const ToastActionsContext = createContext<ToastActions | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration?: number) => {
    const id = Math.random().toString(36).substring(7);
    const toast: Toast = { id, message, type };

    setToasts(prev => [...prev, toast]);

    const time = duration || (type === 'error' ? 5000 : TIMING.TOAST_DURATION);

    setTimeout(() => {
      removeToast(id);
    }, time);
  }, [removeToast]);

  const actions = useMemo(() => ({ showToast, removeToast }), [showToast, removeToast]);

  return (
    <ToastActionsContext.Provider value={actions}>
      <ToastStateContext.Provider value={toasts}>
        {children}
      </ToastStateContext.Provider>
    </ToastActionsContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastActionsContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const useToastState = () => {
    return useContext(ToastStateContext);
};
