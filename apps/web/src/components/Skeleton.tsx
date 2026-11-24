import { t } from "@nootion/shared";

/** A grey bar where content will be, shimmering while it loads (styles in index.css). */
export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`nt-skeleton-bar ${className}`} />;
}

/** Lines of text to come, of varied lengths so they read as a paragraph. */
export function SkeletonLines({ count = 4, className = "" }: { count?: number; className?: string }) {
  const widths = ["w-full", "w-11/12", "w-4/5", "w-2/3", "w-5/6", "w-3/5"];
  return (
    <div className={`nt-skeleton space-y-3 ${className}`} role="status" aria-label={t("common.loading")}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBar key={i} className={`h-4 ${widths[i % widths.length]}`} />
      ))}
    </div>
  );
}

/** A whole page while it loads: its top bar, title and first paragraphs, where they will be. */
export function PageSkeleton() {
  return (
    <div className="nt-skeleton" role="status" aria-label={t("common.loading")}>
      <div className="flex h-10 items-center px-3 md:px-4">
        <SkeletonBar className="h-4 w-40" />
      </div>
      <div className="mx-auto max-w-3xl px-5 pt-8 sm:px-12 sm:pt-16">
        <SkeletonBar className="mb-8 h-10 w-2/3" />
        <div className="space-y-3">
          <SkeletonBar className="h-4 w-full" />
          <SkeletonBar className="h-4 w-11/12" />
          <SkeletonBar className="h-4 w-4/5" />
        </div>
        <div className="mt-8 space-y-3">
          <SkeletonBar className="h-4 w-5/6" />
          <SkeletonBar className="h-4 w-full" />
          <SkeletonBar className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
