import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Floating panel anchored under an element. Closes on outside click and Escape. */
export function Popover({ anchor, onClose, children, width: wanted = 260 }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number }) {
  // Never wider than a phone screen.
  const width = Math.min(wanted, window.innerWidth - 16);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const height = ref.current?.offsetHeight ?? 200;
    const top = r.bottom + 4 + height > window.innerHeight ? Math.max(8, r.top - height - 4) : r.bottom + 4;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top });
  }, [anchor, width]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}
      className="fixed z-50 max-h-[calc(100dvh-16px)] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
    >
      {children}
    </div>,
    document.body,
  );
}
