import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { t, type CaptureInput, type PageSummary } from "@nootion/shared";
import { api } from "../lib/api";
import { useRefreshPages } from "../lib/queries";
import { Button, CancelButton, Modal } from "./ui";

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
export const captureShortcutLabel = () => (isMac() ? "⌘⌥N" : "Ctrl Alt N");

/** Opens quick capture with Ctrl+Alt+N (Cmd+Option+N on a Mac). */
export function useCaptureShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

function useCapture() {
  const qc = useQueryClient();
  const refresh = useRefreshPages();
  return async (input: Partial<CaptureInput>) => {
    const { page } = await api<{ page: PageSummary }>("/inbox", { method: "POST", body: input });
    await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["page", page.parentId] })]);
    return page;
  };
}

/** A box to drop a note in the inbox; it stays open for the next one. */
export function QuickCaptureDialog({ onClose }: { onClose: () => void }) {
  const capture = useCapture();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<PageSummary | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      setAdded(await capture({ text }));
      setText("");
      box.current?.focus();
    } catch (e) {
      setError(t("inbox.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t("inbox.capture")} onClose={onClose}>
      <form
        data-quick-capture
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={box}
          autoFocus
          rows={4}
          value={text}
          aria-label={t("inbox.capture")}
          placeholder={t("inbox.placeholder")}
          className="w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <p className="mt-1 text-xs text-neutral-500">{t("inbox.hint")}</p>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="min-w-0 text-sm text-neutral-500" aria-live="polite">
            {added && (
              <span key={added.id} className="nt-pop flex items-center gap-1.5" data-capture-added>
                <Check size={14} className="shrink-0 text-green-600" />
                <span className="truncate">{t("inbox.added")}</span>
                <Link to={`/page/${added.id}`} onClick={onClose} className="shrink-0 underline">
                  {t("inbox.open")}
                </Link>
              </span>
            )}
          </span>
          <span className="flex shrink-0 gap-2">
            <CancelButton onClose={onClose} label={t("common.close")} />
            <Button type="submit" disabled={saving || !text.trim()}>
              {t("inbox.add")}
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Where the installed app lands when something is shared to it from another app: the note goes in the inbox, and
 * the inbox opens.
 */
export function CapturePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const capture = useCapture();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const input = { title: params.get("title") ?? undefined, text: params.get("text") ?? "", url: params.get("url") ?? undefined };
    // Some apps put the link in the text.
    if (!input.url && /^https?:\/\/\S+$/.test(input.text.trim())) Object.assign(input, { url: input.text.trim(), text: "" });
    capture(input)
      .then((page) => navigate(`/page/${page.parentId}`, { replace: true }))
      .catch((e) => setError(t("inbox.failed", { error: e instanceof Error ? e.message : String(e) })));
  }, [params, navigate, capture]);
  return <div className="mx-auto max-w-3xl px-5 py-16 text-sm text-neutral-500">{error ?? t("inbox.adding")}</div>;
}
