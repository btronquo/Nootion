import { useState } from "react";
import { createPortal } from "react-dom";
import { t, type PageSummary, type WorkspaceSummary } from "@nootion/shared";
import { api } from "../lib/api";
import { workspaceName } from "../lib/labels";
import { pageTitle } from "../lib/tree";
import { useRefreshPages, useWorkspaces } from "../lib/queries";
import { Button, CancelButton, Modal, Rich } from "./ui";

/** Spaces a page can be taken out of, or put into: those where one can add pages. */
export const canOrganise = (ws: WorkspaceSummary | undefined) => ws?.role === "owner" || ws?.role === "editor";

/** Drag data of a page of the sidebar: the space it comes from. */
export const DRAG_SPACE_TYPE = "application/x-nootion-page-space";

/** Moves a page, with its subpages, to another space (under `parentId`, or at its top). */
export function moveToSpace(pageId: string, workspaceId: string, parentId: string | null, index?: number) {
  return api(`/pages/${pageId}/move`, { method: "POST", body: { workspaceId, parentId, ...(index === undefined ? {} : { index }) } });
}

/** What changes for whom when a page goes to another space, said before it goes. */
function consequences(from: WorkspaceSummary | undefined, to: WorkspaceSummary): string[] {
  const lines: string[] = [];
  if (to.kind === "personal") lines.push(t("page.moveSpacePrivate"));
  if (from?.kind === "shared") lines.push(t("page.moveSpaceLeaves", { space: from.name }));
  if (to.kind === "shared") lines.push(t("page.moveSpaceJoins", { space: to.name }));
  lines.push(t("page.moveSpaceKeeps"));
  return lines;
}

/** Asks before a page changes space, since it changes who can see it. */
export function SpaceMoveConfirm({
  title,
  from,
  to,
  onConfirm,
  onClose,
}: {
  title: string;
  from: WorkspaceSummary | undefined;
  to: WorkspaceSummary;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const space = workspaceName(to);
  return (
    <Modal title={t("page.moveSpaceTitle", { space })} onClose={onClose}>
      <div className="space-y-2 text-sm text-neutral-700 dark:text-neutral-300" data-space-move>
        <p>
          <Rich text={t("page.moveSpaceWhat", { title: pageTitle(title), space })} />
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {consequences(from, to).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <CancelButton onClose={onClose} />
        <Button
          type="button"
          disabled={busy}
          autoFocus
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              setBusy(false);
            }
          }}
        >
          {t("page.moveSpaceButton")}
        </Button>
      </div>
    </Modal>
  );
}

/** A page dropped on another space's tree, waiting for the confirmation. */
export type PendingSpaceMove = { page: Pick<PageSummary, "id" | "title" | "workspaceId">; to: string; parentId: string | null; index?: number };

/** Confirms, then makes, a move dropped on another space's tree. Out of the sidebar, whose drawer would hold it. */
export function PendingSpaceMoveDialog({ move, onClose }: { move: PendingSpaceMove; onClose: () => void }) {
  const spaces = useWorkspaces().data;
  const refresh = useRefreshPages();
  const to = spaces?.find((w) => w.id === move.to);
  if (!to) return null;
  return createPortal(
    <SpaceMoveConfirm
      title={move.page.title}
      from={spaces?.find((w) => w.id === move.page.workspaceId)}
      to={to}
      onConfirm={async () => {
        await moveToSpace(move.page.id, move.to, move.parentId, move.index);
        await refresh();
      }}
      onClose={onClose}
    />,
    document.body,
  );
}

/** What a page of the sidebar carries when dragged, besides its id. */
export function readDraggedSpace(data: DataTransfer): { workspaceId: string; title: string } | null {
  try {
    const v = JSON.parse(data.getData(DRAG_SPACE_TYPE) || "null") as { workspaceId?: unknown; title?: unknown } | null;
    return v && typeof v.workspaceId === "string" ? { workspaceId: v.workspaceId, title: typeof v.title === "string" ? v.title : "" } : null;
  } catch {
    return null;
  }
}
