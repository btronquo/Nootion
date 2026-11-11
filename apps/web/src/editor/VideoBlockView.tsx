import { useState, type FormEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Film, Upload } from "lucide-react";
import { t, VIDEO_PROVIDER_NAMES, videoSource } from "@nootion/shared";
import { pickFiles, uploadFile } from "./upload";

/** Players get a sandbox: their own scripts and full screen, nothing on this site. */
const SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";
const ALLOW = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";

/** A video: a site's player (YouTube, Vimeo…) or a video file. Empty, it asks for a link or a file. */
export function VideoBlockView({ node, updateAttributes, deleteNode, editor, extension, selected }: NodeViewProps) {
  const pageId = (extension.options as { pageId: string | null }).pageId;
  const editable = editor.isEditable;
  const src = (node.attrs.src as string | null) ?? "";
  const source = videoSource(src, typeof window === "undefined" ? undefined : window.location.hostname);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!videoSource(value, window.location.hostname)) return setError(t("video.unsupported"));
    updateAttributes({ src: value.trim() });
  }

  async function upload() {
    if (!pageId) return;
    const [file] = await pickFiles("video/mp4,video/webm,video/ogg,video/quicktime");
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const up = await uploadFile(pageId, file);
      updateAttributes({ src: up.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  const frame = `video-block my-2 overflow-hidden rounded-lg ${selected ? "ring-2 ring-blue-400" : ""}`;

  if (source?.kind === "player") {
    return (
      <NodeViewWrapper className={frame} contentEditable={false} data-video="">
        <div className="relative w-full bg-black" style={{ aspectRatio: "16 / 9" }}>
          <iframe
            src={source.embedUrl}
            title={VIDEO_PROVIDER_NAMES[source.provider]}
            className="absolute inset-0 h-full w-full border-0"
            allow={ALLOW}
            allowFullScreen
            sandbox={SANDBOX}
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        </div>
      </NodeViewWrapper>
    );
  }
  if (source?.kind === "file") {
    return (
      <NodeViewWrapper className={frame} contentEditable={false} data-video="">
        <video src={source.url} controls preload="metadata" className="block max-h-[70vh] w-full bg-black" />
      </NodeViewWrapper>
    );
  }

  // No video yet, or an address that isn't one.
  return (
    <NodeViewWrapper className="video-block my-2" contentEditable={false} data-video="">
      <div
        className={`rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900 ${selected ? "ring-2 ring-blue-400" : ""}`}
      >
        {src && !editable ? (
          <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-sm underline">
            {src}
          </a>
        ) : !editable ? (
          <span className="flex items-center gap-2 text-sm text-neutral-500">
            <Film size={16} /> {t("video.title")}
          </span>
        ) : (
          <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
            <Film size={16} className="shrink-0 text-neutral-500" />
            <input
              autoFocus={!src}
              value={value || src}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !src && !value) deleteNode();
              }}
              placeholder={t("video.placeholder")}
              aria-label={t("video.placeholder")}
              className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
            >
              {t("video.embed")}
            </button>
            {pageId && (
              <button
                type="button"
                onClick={upload}
                disabled={uploading}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <Upload size={14} /> {uploading ? t("video.uploading") : t("video.upload")}
              </button>
            )}
          </form>
        )}
        {(error || (src && editable)) && <p className="mt-2 text-xs text-red-600">{error ?? t("video.unsupported")}</p>}
        {editable && <p className="mt-2 text-xs text-neutral-500">{t("video.help")}</p>}
      </div>
    </NodeViewWrapper>
  );
}
