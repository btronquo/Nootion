import type { PageSummary } from "@nootion/shared";
import { t } from "@nootion/shared";

export interface TreeNode<T extends PageSummary = PageSummary> {
  page: T;
  children: TreeNode<T>[];
}

/** Builds a forest from a flat list. Pages whose parent is not in the list become roots. */
export function buildTree<T extends PageSummary>(pages: T[]): TreeNode<T>[] {
  const nodes = new Map(pages.map((p) => [p.id, { page: p, children: [] as TreeNode<T>[] }]));
  const roots: TreeNode<T>[] = [];
  for (const p of pages) {
    const node = nodes.get(p.id)!;
    const parent = p.parentId ? nodes.get(p.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: TreeNode<T>[]) => {
    list.sort((a, b) => a.page.position - b.page.position);
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export function pageTitle(title: string): string {
  return title.trim() || t("common.untitled");
}
