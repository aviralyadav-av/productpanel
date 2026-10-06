"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { RichTextEditorProps } from "./rich-text-editor-impl";

export type { RichTextEditorProps } from "./rich-text-editor-impl";

/**
 * Public entry point for the rich text editor (blueprint G6).
 *
 * The implementation is loaded with ssr:false because ProseMirror measures
 * the DOM on mount, and because tiptap plus its extensions is ~150 KB that
 * only the pages that edit HTML should pay for. The placeholder is sized to
 * the editor's default height so the page does not jump when it arrives.
 *
 * @example
 *   const [html, setHtml] = React.useState(page.bodyHtml);
 *   <RichTextEditor value={html} onChange={setHtml} onPickImage={pickFromLibrary} />
 */
const RichTextEditorImpl = dynamic(() => import("./rich-text-editor-impl"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

export function RichTextEditor(props: RichTextEditorProps) {
  return <RichTextEditorImpl {...props} />;
}

function EditorSkeleton() {
  return (
    <div className="border-input rounded-lg border" aria-busy>
      <div className="flex gap-1 border-b p-1">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="size-7" />
        ))}
      </div>
      <div className="space-y-2 p-3" style={{ minHeight: 200 }}>
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}
