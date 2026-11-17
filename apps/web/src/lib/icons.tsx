import type { ReactNode } from "react";
import { Database, FileText, Rows3 } from "lucide-react";
import { customIconId, customIconUrl, t, type PageKind } from "@nootion/shared";

/**
 * A page icon to show: the emoji, or the uploaded image, as big as the text around it. Null without an icon, so that
 * `pageIcon(p.icon) ?? fallback` works.
 */
export function pageIcon(icon: string | null | undefined): ReactNode {
  if (!icon) return null;
  const id = customIconId(icon);
  if (!id) return icon;
  return (
    <img
      src={customIconUrl(id)}
      alt=""
      draggable={false}
      // A deleted icon shows nothing rather than a broken image.
      onError={(e) => (e.currentTarget.style.display = "none")}
      className="inline-block h-[1em] w-[1em] rounded-[3px] object-contain align-[-0.125em]"
    />
  );
}

/**
 * A page's icon in lists (sidebar, breadcrumb, search): its own icon, or a generic one by kind. A database always shows
 * the database mark, in the corner of its own icon when it has one, so that it isn't taken for a page with text.
 * `generic`: show the generic icon of a page without one (off in the breadcrumb, where such pages show no icon).
 */
export function PageGlyph({
  icon,
  kind,
  size = 14,
  generic = true,
  fallback,
}: {
  icon: string | null | undefined;
  kind: PageKind;
  size?: number;
  generic?: boolean;
  /** What a page (not a database) without an icon shows instead of the generic icon. */
  fallback?: ReactNode;
}) {
  const own = pageIcon(icon);
  if (kind === "database") {
    if (!own) return <Database size={size} className="inline shrink-0 text-neutral-400" aria-label={t("database.pageBadge")} data-database-mark />;
    return (
      <span className="relative mr-0.5 inline-block" title={t("database.pageBadge")} data-database-mark>
        {own}
        <span className="absolute -right-1 -bottom-0.5 flex items-center justify-center rounded-[3px] bg-white p-px text-neutral-500 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] dark:bg-neutral-900 dark:text-neutral-400 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
          <Database size={Math.max(8, Math.round(size * 0.6))} strokeWidth={2.5} aria-label={t("database.pageBadge")} />
        </span>
      </span>
    );
  }
  if (own || !generic) return <>{own}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  if (kind === "row") return <Rows3 size={size} className="inline text-neutral-400" />;
  return <FileText size={size} className="inline text-neutral-400" />;
}
