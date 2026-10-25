"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface HoverCardContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const HoverCardContext = React.createContext<HoverCardContextValue>({
  open: false,
  setOpen: () => {},
});

export function HoverCard({
  children,
  openDelay = 150,
  closeDelay = 200,
}: {
  children: React.ReactNode;
  openDelay?: number;
  closeDelay?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(true), openDelay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(false), closeDelay);
  };

  return (
    <HoverCardContext.Provider value={{ open, setOpen }}>
      <div
        className="relative inline-flex items-center"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
    </HoverCardContext.Provider>
  );
}

export function HoverCardTrigger({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      onClick={onClick}
      className={cn("inline-flex cursor-pointer items-center", className)}
    >
      {children}
    </span>
  );
}

export function HoverCardContent({
  children,
  className,
  align = "center",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "center" | "start" | "end";
}) {
  const { open } = React.useContext(HoverCardContext);

  if (!open) return null;

  return (
    <div
      className={cn(
        "absolute z-50 w-80 rounded-lg border border-slate-800 bg-slate-900/95 p-3 text-xs text-slate-200 shadow-2xl backdrop-blur-md animate-in fade-in-0 zoom-in-95",
        align === "center" && "left-1/2 -translate-x-1/2 bottom-full mb-2",
        align === "start" && "left-0 bottom-full mb-2",
        align === "end" && "right-0 bottom-full mb-2",
        className
      )}
    >
      {children}
    </div>
  );
}
