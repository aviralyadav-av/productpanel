"use client";

import * as React from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Code2,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";

export type RichTextEditorProps = {
  /** Sanitised HTML. The server re-sanitises on save; this is not a trust boundary. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  /**
   * Opens the media library and resolves with the chosen image, or null.
   * Wire it to MediaPicker at the call site; without it the image button
   * falls back to a URL prompt. Images should come from the library so they
   * are optimised and survive a storage move (blueprint G6).
   */
  onPickImage?: () => Promise<{ url: string; alt?: string } | null>;
  disabled?: boolean;
  className?: string;
  id?: string;
};

/**
 * The real editor. Loaded through rich-text-editor.tsx with ssr:false because
 * ProseMirror needs the DOM; `immediatelyRender: false` is the belt to that
 * pair of braces and keeps React from complaining during hydration.
 *
 * Controlled with a feedback guard: `onChange` fires on every keystroke with
 * the new HTML, and the parent hands the same string straight back as
 * `value`. Calling setContent on every render would reset the cursor, so the
 * effect only writes when the incoming value differs from what the editor
 * already holds - i.e. when something *other* than typing changed it.
 */
export default function RichTextEditorImpl({
  value,
  onChange,
  placeholder = "Write something",
  minHeight = 200,
  onPickImage,
  disabled = false,
  className,
  id,
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: { rel: "noopener noreferrer nofollow" },
        },
        // Horizontal rules and hard breaks stay; nothing else in the kit is
        // contentious for storefront copy.
      }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": placeholder,
        class: cn(
          "outline-none px-3 py-2 text-sm leading-relaxed",
          "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1.5",
          "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1",
          "[&_p]:my-1.5 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5",
          "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
          "[&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-xs [&_pre]:font-mono",
          "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:text-[0.9em] [&_pre_code]:bg-transparent [&_pre_code]:p-0",
          "[&_a]:text-brand [&_a]:underline [&_img]:max-w-full [&_img]:rounded-md [&_img.ProseMirror-selectednode]:ring-2 [&_img.ProseMirror-selectednode]:ring-ring",
          "[&_hr]:my-4 [&_hr]:border-border",
          "[&_.is-editor-empty:first-child::before]:text-muted-foreground [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:h-0",
        ),
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Push external changes in without clobbering the caret (see doc comment).
  React.useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current && !(value === "" && current === "<p></p>")) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  React.useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div
      className={cn(
        "border-input focus-within:border-ring focus-within:ring-ring/50 rounded-lg border bg-transparent transition-colors focus-within:ring-3 dark:bg-input/30",
        disabled && "opacity-60",
        className,
      )}
    >
      {editor ? <Toolbar editor={editor} disabled={disabled} onPickImage={onPickImage} /> : null}
      <div style={{ minHeight }} className="cursor-text" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({
  editor,
  disabled,
  onPickImage,
}: {
  editor: Editor;
  disabled: boolean;
  onPickImage?: RichTextEditorProps["onPickImage"];
}) {
  // v3 does not re-render on every transaction; select the flags we display.
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      paragraph: editor.isActive("paragraph"),
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      blockquote: editor.isActive("blockquote"),
      codeBlock: editor.isActive("codeBlock"),
      link: editor.isActive("link"),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      linkHref: (editor.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  const [linkOpen, setLinkOpen] = React.useState(false);
  const [imageOpen, setImageOpen] = React.useState(false);

  async function insertImage() {
    if (onPickImage) {
      const picked = await onPickImage();
      if (picked) {
        editor.chain().focus().setImage({ src: picked.url, alt: picked.alt ?? "" }).run();
      }
      return;
    }
    setImageOpen(true);
  }

  function applyLink(href: string) {
    const trimmed = href.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
  }

  const chain = () => editor.chain().focus();

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-disabled={disabled || undefined}
      className={cn(
        "flex flex-wrap items-center gap-0.5 border-b p-1",
        disabled && "pointer-events-none",
      )}
    >
      <ToolToggle icon={Pilcrow} label="Paragraph" pressed={state.paragraph} onClick={() => chain().setParagraph().run()} />
      <ToolToggle icon={Heading2} label="Heading 2" pressed={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()} />
      <ToolToggle icon={Heading3} label="Heading 3" pressed={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()} />
      <Divider />
      <ToolToggle icon={Bold} label="Bold" pressed={state.bold} onClick={() => chain().toggleBold().run()} />
      <ToolToggle icon={Italic} label="Italic" pressed={state.italic} onClick={() => chain().toggleItalic().run()} />
      <ToolToggle icon={Underline} label="Underline" pressed={state.underline} onClick={() => chain().toggleUnderline().run()} />
      <ToolToggle icon={Strikethrough} label="Strikethrough" pressed={state.strike} onClick={() => chain().toggleStrike().run()} />
      <Divider />
      <ToolToggle icon={List} label="Bullet list" pressed={state.bulletList} onClick={() => chain().toggleBulletList().run()} />
      <ToolToggle icon={ListOrdered} label="Numbered list" pressed={state.orderedList} onClick={() => chain().toggleOrderedList().run()} />
      <ToolToggle icon={Quote} label="Quote" pressed={state.blockquote} onClick={() => chain().toggleBlockquote().run()} />
      <ToolToggle icon={Code2} label="Code block" pressed={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()} />
      <Divider />
      <ToolToggle icon={state.link ? Link2Off : Link2} label={state.link ? "Edit link" : "Add link"} pressed={state.link} onClick={() => setLinkOpen(true)} />
      <ToolToggle icon={ImageIcon} label="Insert image" pressed={false} onClick={insertImage} />
      <Divider />
      <ToolToggle icon={Undo2} label="Undo" pressed={false} disabled={!state.canUndo} onClick={() => chain().undo().run()} />
      <ToolToggle icon={Redo2} label="Redo" pressed={false} disabled={!state.canRedo} onClick={() => chain().redo().run()} />
      <ToolToggle icon={RemoveFormatting} label="Clear formatting" pressed={false} onClick={() => chain().clearNodes().unsetAllMarks().run()} />

      <UrlDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        title={state.link ? "Edit link" : "Add link"}
        description="Paste a full URL. Leave it empty to remove the link."
        initial={state.linkHref}
        confirmLabel={state.link ? "Update" : "Add link"}
        onConfirm={({ url }) => applyLink(url)}
      />
      <UrlDialog
        open={imageOpen}
        onOpenChange={setImageOpen}
        title="Insert image by URL"
        description="Prefer the media library so the image is optimised and tracked; use a URL only for external assets."
        withAlt
        confirmLabel="Insert"
        onConfirm={({ url, alt }) => {
          if (url.trim()) chain().setImage({ src: url.trim(), alt: alt?.trim() ?? "" }).run();
        }}
      />
    </div>
  );
}

function ToolToggle({
  icon: Icon,
  label,
  pressed,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Toggle
      type="button"
      size="sm"
      pressed={pressed}
      onPressedChange={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="size-7 min-w-7 p-0"
    >
      <Icon className="size-3.5" />
    </Toggle>
  );
}

function Divider() {
  return <span aria-hidden className="bg-border mx-0.5 h-4 w-px" />;
}

function UrlDialog({
  open,
  onOpenChange,
  title,
  description,
  initial = "",
  withAlt = false,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initial?: string;
  withAlt?: boolean;
  confirmLabel: string;
  onConfirm: (payload: { url: string; alt?: string }) => void;
}) {
  const [url, setUrl] = React.useState(initial);
  const [alt, setAlt] = React.useState("");
  const urlId = React.useId();
  const altId = React.useId();

  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the field from the current selection each time the dialog opens
      setUrl(initial);
      setAlt("");
    }
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm({ url, alt: withAlt ? alt : undefined });
            onOpenChange(false);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={urlId} className="text-xs">
              URL
            </Label>
            <Input
              id={urlId}
              type="url"
              inputMode="url"
              autoFocus
              value={url}
              placeholder="https://"
              onChange={(event) => setUrl(event.target.value)}
              className="h-8 text-xs"
            />
          </div>
          {withAlt ? (
            <div className="space-y-1.5">
              <Label htmlFor={altId} className="text-xs">
                Alt text
              </Label>
              <Input
                id={altId}
                value={alt}
                placeholder="Describe the image for screen readers"
                onChange={(event) => setAlt(event.target.value)}
                className="h-8 text-xs"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
