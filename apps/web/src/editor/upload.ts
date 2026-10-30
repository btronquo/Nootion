import type { Editor } from "@tiptap/core";
import { ApiError } from "../lib/api";
import { t } from "@nootion/shared";

export interface UploadedFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

export async function uploadFile(pageId: string, file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(`/api/pages/${pageId}/attachments`, { method: "POST", body: form, credentials: "same-origin" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error", data?.message ?? t("common.errorStatus", { status: res.status }));
  return data.attachment;
}

const DISPLAYABLE_IMAGES = /^image\/(png|jpeg|gif|webp|avif)$/;

/** Inserts an attached file at `pos` (or the cursor): an image inline, anything else as a file block. */
export function insertUploaded(editor: Editor, up: UploadedFile, pos?: number) {
  const node = DISPLAYABLE_IMAGES.test(up.mimeType)
    ? { type: "image", attrs: { src: up.url, alt: up.filename } }
    : { type: "fileAttachment", attrs: { url: up.url, name: up.filename, size: up.size, mimeType: up.mimeType } };
  // A paragraph after the block keeps the cursor out of it, so typing does not replace it.
  const content = [node, { type: "paragraph" }];
  if (pos !== undefined) editor.chain().focus().insertContentAt(pos, content).run();
  else editor.chain().focus().insertContent(content).run();
}

/** Uploads files and inserts them at `pos` (or the cursor). */
export async function insertFiles(editor: Editor, pageId: string, files: File[], pos?: number) {
  for (const file of files) {
    try {
      insertUploaded(editor, await uploadFile(pageId, file), pos);
    } catch (err) {
      alert(t("editor.uploadFailed", { name: file.name, error: err instanceof Error ? err.message : String(err) }));
    }
  }
}

export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}
