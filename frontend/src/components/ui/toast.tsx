"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

interface ToastProps {
  id: string;
  title: string;
  description?: string;
  type?: "success" | "warning" | "error" | "info";
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastProps, "id">) => void;
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastProps[]>([]);

  const showToast = React.useCallback(
    ({ title, description, type = "info" }: Omit<ToastProps, "id">) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, title, description, type }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col space-y-2 pointer-events-none">
        {toasts.map((t) => {
          const icons = {
            success: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
            warning: <AlertTriangle className="h-5 w-5 text-amber-400" />,
            error: <XCircle className="h-5 w-5 text-rose-400" />,
            info: <Info className="h-5 w-5 text-indigo-400" />,
          };

          return (
            <div
              key={t.id}
              className={cn(
                "pointer-events-auto flex items-start space-x-3 rounded-lg border border-slate-700 bg-slate-900/95 p-4 shadow-xl backdrop-blur-md text-white transition-all w-80 animate-in slide-in-from-bottom-5"
              )}
            >
              {icons[t.type || "info"]}
              <div className="flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.description && (
                  <p className="text-xs text-slate-400 mt-0.5">{t.description}</p>
                )}
              </div>
              <button
                onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
