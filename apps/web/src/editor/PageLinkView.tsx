import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Link } from "react-router-dom";
import { usePage } from "../lib/queries";
import { pageTitle } from "../lib/tree";

export function PageLinkView({ node }: NodeViewProps) {
  const pageId = node.attrs.pageId as string | null;
  const page = usePage(pageId ?? "");
  if (!pageId || page.isError) {
    return (
      <NodeViewWrapper as="span" className="page-link page-link-private" contentEditable={false}>
        🔒 Page inaccessible
      </NodeViewWrapper>
    );
  }
  const title = page.data ? pageTitle(page.data.title) : pageTitle(String(node.attrs.title ?? ""));
  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <Link to={`/page/${pageId}`} className="page-link" data-page-link={pageId}>
        {page.data?.icon ?? "📄"} {title}
      </Link>
    </NodeViewWrapper>
  );
}
