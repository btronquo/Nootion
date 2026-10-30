import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { t, type DatabaseData, type DatabaseRow, type RowTemplate } from "@nootion/shared";
import { api } from "../lib/api";
import { pageTitle } from "../lib/tree";
import { dbKey } from "./hooks";
import { Popover } from "./Popover";

const item = "flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800";
const icon = "rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

const templateName = (tpl: RowTemplate) => tpl.title.trim() || t("template.untitled");

/** Row templates of a database: start a row from one, choose the default, edit or delete them, make a new one. */
export function TemplatesMenu({ data, anchor, onClose }: { data: DatabaseData; anchor: HTMLElement; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: dbKey(data.id) });

  const addRow = async (templateId: string | null) => {
    onClose();
    const { row } = await api<{ row: DatabaseRow }>(`/databases/${data.id}/rows`, { method: "POST", body: { values: {}, templateId } });
    await refresh();
    navigate(`/page/${row.id}`);
  };
  const create = async () => {
    onClose();
    const { template } = await api<{ template: RowTemplate }>(`/databases/${data.id}/templates`, { method: "POST" });
    await refresh();
    navigate(`/page/${template.id}`);
  };
  const setDefault = async (templateId: string | null) => {
    await api(`/databases/${data.id}/default-template`, { method: "PUT", body: { templateId } });
    await refresh();
  };
  const remove = async (tpl: RowTemplate) => {
    if (!confirm(t("template.confirmDelete", { name: templateName(tpl) }))) return;
    await api(`/databases/${data.id}/rows/delete`, { method: "POST", body: { ids: [tpl.id] } });
    await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["trash"] })]);
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={300}>
      <div className="px-2 pb-1 pt-1 text-xs font-medium text-neutral-500">{t("template.button")}</div>
      {!data.templates.length && <p className="px-2 py-1.5 text-xs text-neutral-500">{t("template.none")}</p>}
      {data.templates.map((tpl) => {
        const isDefault = data.defaultTemplateId === tpl.id;
        return (
          <div key={tpl.id} className="flex items-center gap-0.5" data-template={tpl.id}>
            <button className={item} onClick={() => addRow(tpl.id)} title={t("template.useNow")}>
              <span className="w-5 shrink-0 text-center">{tpl.icon ?? "📄"}</span>
              <span className="truncate">{templateName(tpl)}</span>
              {isDefault && (
                <span className="ml-auto shrink-0 rounded bg-blue-100 px-1.5 text-[10px] text-blue-700 dark:bg-blue-900/60 dark:text-blue-200">
                  {t("template.default")}
                </span>
              )}
            </button>
            <button
              className={icon}
              aria-label={isDefault ? t("template.noDefault") : t("template.makeDefault")}
              title={isDefault ? t("template.noDefault") : t("template.makeDefault")}
              aria-pressed={isDefault}
              onClick={() => setDefault(isDefault ? null : tpl.id)}
            >
              <Star size={14} className={isDefault ? "fill-amber-400 text-amber-400" : ""} />
            </button>
            <button
              className={icon}
              aria-label={t("template.edit")}
              title={t("template.edit")}
              onClick={() => {
                onClose();
                navigate(`/page/${tpl.id}`);
              }}
            >
              <Pencil size={14} />
            </button>
            <button className={icon} aria-label={t("template.delete")} title={t("template.delete")} onClick={() => remove(tpl)}>
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
      {data.templates.length > 0 && (
        <button className={`${item} w-full`} onClick={() => addRow(null)}>
          <Plus size={14} /> {t("template.blankRow")}
        </button>
      )}
      <button className={`${item} w-full`} onClick={create}>
        <FilePlus2 size={14} /> {t("template.new")}
      </button>
    </Popover>
  );
}
