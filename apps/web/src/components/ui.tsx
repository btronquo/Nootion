import type React from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { currentLocale, LOCALE_NAMES, LOCALES, t, type Locale } from "@nootion/shared";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
    ghost: "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
    danger: "text-red-600 hover:bg-red-50 dark:hover:bg-red-950",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60 active:scale-[.98] disabled:cursor-not-allowed disabled:active:scale-100 disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
      <input
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:ring-neutral-700"
        {...props}
      />
    </label>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-600">{error instanceof Error ? error.message : String(error)}</p>;
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-6 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-3 h-10 w-10" />
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Plays the closing animation (the element gets data-closing) before calling onClose. */
export function useClosing(onClose: () => void, ms = 140) {
  const [closing, setClosing] = useState(false);
  const started = useRef(false);
  const latest = useRef(onClose);
  latest.current = onClose;
  const close = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setClosing(true);
    setTimeout(() => latest.current(), window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : ms);
  }, [ms]);
  return { closing, close };
}

const ModalCloseContext = createContext<(() => void) | null>(null);

/** Inside a Modal: closes it with its animation. */
export function useModalClose(fallback: () => void) {
  return useContext(ModalCloseContext) ?? fallback;
}

/** A Cancel button that closes the surrounding Modal with its animation. */
export function CancelButton({ onClose, label = t("common.cancel") }: { onClose: () => void; label?: string }) {
  const close = useModalClose(onClose);
  return (
    <Button type="button" variant="ghost" onClick={close}>
      {label}
    </Button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  closeRef,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Filled with the animated close, to close from outside (after a submit). */
  closeRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { closing, close } = useClosing(onClose);
  if (closeRef) closeRef.current = close;
  const dialog = useRef<HTMLDivElement>(null);
  // Ready to type in: the first field gets the focus, and Escape closes from anywhere.
  useEffect(() => {
    const el = dialog.current;
    // Not on touch screens, where it would pop the keyboard up.
    if (el && !el.contains(document.activeElement) && window.matchMedia?.("(hover: hover)").matches) el.querySelector<HTMLElement>("input, textarea, select")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <div
      className="nt-backdrop fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[10vh]"
      data-closing={closing || undefined}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-label={title}
        className={`nt-dialog w-full ${wide ? "max-w-xl" : "max-w-md"} rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900`}
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <ModalCloseContext.Provider value={close}>{children}</ModalCloseContext.Provider>
      </div>
    </div>
  );
}

export function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 ${className}`} {...props} />;
}

/** Choice of the interface language, each one written in its own language. */
export function LanguageSelect({ value = currentLocale(), onChange }: { value?: Locale; onChange: (locale: Locale) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">{t("account.language")}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value as Locale)} className="w-full py-2">
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** A translated text where <b>…</b> marks words to put in bold. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}
    </>
  );
}
