import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Undo2, X } from "lucide-react";
import { FILE_IMPORT_ACCEPT, t, type FileImportJob, type FileImportStatus, type MessageKey } from "@nootion/shared";
import { api, ApiError } from "../lib/api";
import { useRefreshPages, useWorkspaces } from "../lib/queries";
import { workspaceName } from "../lib/labels";
import { pageTitle } from "../lib/tree";
import { formatSize } from "../editor/nodes";
import { Button, ErrorText, Modal, Select } from "./ui";

const COUNTS = ["pages", "databases", "rows", "files", "links"] as const;

/** Sends the files as a form, following the upload's progress. */
function upload(fields: Record<string, string>, files: File[], onProgress: (percent: number) => void): Promise<{ job: FileImportJob }> {
  const form = new FormData();
  // Fields first: the server checks where the import goes before receiving the files.
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) form.append("files", f, f.name);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/import/files");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: { job?: FileImportJob; error?: string; message?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON: a proxy's page (413 when the files are larger than it allows).
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.job) resolve({ job: data.job });
      else reject(new ApiError(xhr.status, data?.error ?? "error", data?.message ?? t("common.errorStatus", { status: xhr.status })));
    };
    xhr.onerror = () => reject(new ApiError(0, "offline", t("common.errorStatus", { status: 0 })));
    xhr.send(form);
  });
}

/**
 * Import from files: Markdown, HTML, Word, text, CSV, or a zip of them. In "My account" the space is chosen; from a
 * space's header or a page's menu, the import goes there.
 */
export function FileImport({ workspaceId: fixedSpace, parentId, parentTitle }: { workspaceId?: string; parentId?: string; parentTitle?: string }) {
  const workspaces = useWorkspaces();
  const editable = (workspaces.data ?? []).filter((w) => w.role === "owner" || w.role === "editor");
  const [chosen, setChosen] = useState("");
  const workspaceId = fixedSpace ?? (chosen || editable[0]?.id || "");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const refreshPages = useRefreshPages();
  const key = ["file-import", workspaceId];

  const status = useQuery({
    queryKey: key,
    queryFn: () => api<FileImportStatus>(`/import/files?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
    refetchInterval: (q) => (q.state.data?.job?.status === "running" ? 1000 : false),
  });
  const job = status.data?.job ?? null;
  const running = job?.status === "running";

  // The sidebar shows the imported pages once the job is over.
  useEffect(() => {
    if (job && job.status !== "running") void refreshPages();
  }, [job?.status, job?.id, job?.undone]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useMutation({
    mutationFn: () => upload({ workspaceId, ...(parentId ? { parentId } : {}) }, files, setProgress),
    onSuccess: ({ job }) => {
      setFiles([]);
      qc.setQueryData<FileImportStatus>(key, { job });
      return qc.invalidateQueries({ queryKey: key });
    },
    onSettled: () => setProgress(null),
  });
  const undo = useMutation({
    mutationFn: (id: string) => api<{ job: FileImportJob }>(`/import/files/${id}/undo`, { method: "POST" }),
    onSuccess: ({ job }) => qc.setQueryData<FileImportStatus>(key, { job }),
  });

  if (workspaces.isLoading) return null;
  if (!fixedSpace && editable.length === 0) return <p className="text-neutral-500">{t("notion.noSpace")}</p>;

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    const names = new Set(files.map((f) => f.name + f.size));
    setFiles([...files, ...Array.from(list).filter((f) => !names.has(f.name + f.size))]);
  };
  const total = files.reduce((s, f) => s + f.size, 0);
  const [before, after] = t("fileImport.drop", { choose: "\u0000" }).split("\u0000");

  return (
    <div className="space-y-4">
      {!fixedSpace && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("fileImport.space")}</span>
          <Select value={workspaceId} onChange={(e) => setChosen(e.target.value)} disabled={running || start.isPending}>
            {editable.map((w) => (
              <option key={w.id} value={w.id}>
                {workspaceName(w)}
              </option>
            ))}
          </Select>
        </label>
      )}
      {parentTitle !== undefined && <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("fileImport.into", { title: pageTitle(parentTitle) })}</p>}

      <div
        data-file-drop
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${dragging ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40" : "border-neutral-300 dark:border-neutral-700"}`}
      >
        <FileUp size={22} className="text-neutral-400" />
        <p className="text-neutral-600 dark:text-neutral-400">
          {before}
          <button type="button" className="text-blue-600 hover:underline dark:text-blue-400" onClick={() => input.current?.click()}>
            {t("fileImport.choose")}
          </button>
          {after}
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={FILE_IMPORT_ACCEPT + ",image/*,application/pdf"}
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("fileImport.chosen", { count: files.length, size: formatSize(total) })}</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-sm text-neutral-600 dark:text-neutral-400">
            {files.map((f) => (
              <li key={f.name + f.size} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-neutral-500">{formatSize(f.size)}</span>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800"
                  title={t("fileImport.clear")}
                  aria-label={t("fileImport.clear")}
                  onClick={() => setFiles(files.filter((x) => x !== f))}
                  disabled={start.isPending}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => start.mutate()} disabled={!files.length || running || start.isPending || !workspaceId}>
          {t("fileImport.start")}
        </Button>
        {progress !== null && <span className="text-sm text-neutral-500">{t("fileImport.uploading", { percent: progress })}</span>}
      </div>
      <ErrorText error={start.error ?? undo.error ?? status.error} />

      {job && !start.isPending && <JobView job={job} onUndo={() => confirm(t("fileImport.confirmUndo")) && undo.mutate(job.id)} undoing={undo.isPending} />}
    </div>
  );
}

function JobView({ job, onUndo, undoing }: { job: FileImportJob; onUndo: () => void; undoing: boolean }) {
  const r = job.report;
  const counts = COUNTS.filter((k) => r[k] > 0 || k === "pages");
  const notes = Object.entries(r.notes);
  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800" aria-live="polite" data-file-import-job>
      <p className="truncate text-xs text-neutral-500">{job.sources.join(", ")}</p>
      {job.status === "running" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t(`fileImport.phase.${job.phase}` as MessageKey)}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: job.total ? `${Math.round((job.done / job.total) * 100)}%` : "5%" }}
            />
          </div>
          <p className="text-xs text-neutral-500">{t("fileImport.running")}</p>
        </div>
      ) : job.status === "failed" ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t("fileImport.failed", { error: job.error ?? "" })}</p>
      ) : job.undone ? (
        <p className="text-sm font-medium">{t("fileImport.undone")}</p>
      ) : (
        <p className="text-sm font-medium">{r.pages + r.databases === 0 ? t("fileImport.nothing") : t("fileImport.done")}</p>
      )}
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{counts.map((k) => t(`fileImport.count.${k}`, { count: r[k] })).join(" · ")}</p>
      {notes.length > 0 && job.status !== "running" && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">{t("fileImport.notesTitle")}</h3>
          <p className="mb-1 text-xs text-neutral-500">{t("fileImport.details.help")}</p>
          <ul className="space-y-0.5 text-sm text-neutral-600 dark:text-neutral-400">
            {notes.map(([kind, n]) => {
              const details = r.details[kind] ?? [];
              const label = `${t(`fileImport.note.${kind}` as MessageKey)} (${n})`;
              return (
                <li key={kind}>
                  {details.length ? (
                    <details>
                      <summary className="cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100">{label}</summary>
                      <ul className="mb-2 ml-1.5 mt-1 max-h-60 space-y-0.5 overflow-y-auto border-l border-neutral-200 pl-3 dark:border-neutral-800">
                        {details.map((d, i) => (
                          <li key={i} className="break-all">
                            <span className="text-neutral-800 dark:text-neutral-200">{d.where}</span>
                            {d.item && <> › {d.item}</>}
                            {d.info && <span className="ml-2 text-xs text-neutral-500">{d.info}</span>}
                          </li>
                        ))}
                        {n > details.length && <li className="text-xs text-neutral-500">{t("notion.details.more", { count: n - details.length })}</li>}
                      </ul>
                    </details>
                  ) : (
                    <span className="block pl-4">{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {job.status !== "running" && !job.undone && r.pages + r.databases > 0 && (
        <Button variant="ghost" onClick={onUndo} disabled={undoing} className="inline-flex items-center gap-1.5">
          <Undo2 size={14} /> {t("fileImport.undo")}
        </Button>
      )}
    </section>
  );
}

/** Account page section: the import from files, below the import through other tools' APIs. */
export function FileImportSection() {
  return (
    <div id="files" className="space-y-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div>
        <h3 className="mb-1 font-semibold">{t("fileImport.title")}</h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("fileImport.intro")}</p>
      </div>
      <FileImport />
    </div>
  );
}

/** The import from files in a dialog, into a space or under a page. */
export function FileImportDialog({ workspaceId, parent, onClose }: { workspaceId: string; parent?: { id: string; title: string }; onClose: () => void }) {
  return (
    <Modal title={t("fileImport.title")} onClose={onClose} wide>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">{t("fileImport.intro")}</p>
      <FileImport workspaceId={workspaceId} parentId={parent?.id} parentTitle={parent?.title} />
    </Modal>
  );
}
