import React, { useEffect, useState } from "react";
import { create } from "zustand";

export type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    set((state) => ({
      toasts: [
        ...state.toasts,
        { ...toast, id, duration: toast.duration ?? 2500 },
      ],
    }));

    if (toast.duration !== 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, toast.duration ?? 2500);
    }
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

const typeClasses = {
  success: {
    bg: "bg-accent-100",
    text: "text-accent-900",
    icon: "text-accent-600",
  },
  error: {
    bg: "bg-red-100",
    text: "text-red-900",
    icon: "text-red-600",
  },
  info: {
    bg: "bg-blue-100",
    text: "text-blue-900",
    icon: "text-blue-600",
  },
  warning: {
    bg: "bg-yellow-100",
    text: "text-yellow-900",
    icon: "text-yellow-600",
  },
};

const icons = {
  success: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  ),
  error: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  ),
  info: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  warning: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
};

const ToastItem: React.FC<Toast & { onClose: () => void }> = ({
  id,
  message,
  type,
  onClose,
}) => {
  const classes = typeClasses[type];

  return (
    <div
      className={`
        flex items-center gap-md px-lg py-md rounded-md border border-border
        ${classes.bg} ${classes.text}
        shadow-lg animate-in slide-in-from-right duration-200
      `}
      role="alert"
    >
      <div className={classes.icon}>{icons[type]}</div>
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        onClick={onClose}
        className="p-1 hover:opacity-70 transition-opacity"
        aria-label="Close toast"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  return (
    <div className="fixed bottom-lg right-lg z-50 flex flex-col gap-md pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem {...toast} onClose={() => removeToast(toast.id)} />
        </div>
      ))}
    </div>
  );
};

// Helper function
export const showToast = (
  message: string,
  type: ToastType = "info",
  duration?: number,
) => {
  useToastStore.getState().addToast({ message, type, duration });
};
