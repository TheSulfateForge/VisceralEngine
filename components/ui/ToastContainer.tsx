
import React from 'react';
import { useToast, useToastState } from '../providers/ToastProvider';

export const ToastContainer: React.FC = () => {
  const toasts = useToastState();
  const { removeToast } = useToast();

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          onClick={() => removeToast(toast.id)}
          className={`
            pointer-events-auto min-w-[250px] max-w-sm p-4 rounded-sm border shadow-2xl backdrop-blur-md transform transition-all duration-300 animate-fade-in cursor-pointer
            ${toast.type === 'success' ? 'bg-green-950/80 border-green-800 text-green-200' : 
              toast.type === 'error' ? 'bg-red-950/80 border-red-800 text-red-200 animate-shake' : 
              'bg-gray-900/80 border-gray-700 text-gray-200'}
          `}
        >
          <div className="flex items-center gap-3">
            <span className={`text-lg ${toast.type === 'error' ? 'animate-pulse' : ''}`}>
              {toast.type === 'success' ? '✓' : toast.type === 'error' ? '⚠' : 'ℹ'}
            </span>
            <p className="text-xs font-bold uppercase tracking-widest">{toast.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
};
