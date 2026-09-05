"use client";

import * as React from "react";
import { FileText, Loader2, Plus, SquarePen, Trash2 } from "lucide-react";

import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatIstDate } from "@/lib/dates";
import { setCmsPageStatus, updateCmsPage } from "../actions";
import type { CmsPageRow } from "../queries";
import { MoveButtons, moveInList, useActionToast } from "./section-editor";

/**
 * The eight footer pages. They all share one shape - eyebrow, title, intro and
 * an ordered list of body blocks - which is why they are one editor rather than
 * eight bespoke screens.
 */
export function PagesTab({ pages }: { pages: CmsPageRow[] }) {
  const [editing, setEditing] = React.useState<CmsPageRow | null>(null);
  const { pending, run } = useActionToast();

  if (pages.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No pages"
        description="CmsPage is empty. Run npm run db:seed to import the eight pages the storefront footer links to."
      />
    );
  }

  return (
    <>
      <p className="text-muted-foreground px-4 pt-3 text-xs leading-relaxed">
        The storefront renders these pages from its own bundled copies today.
        Edits here are stored and served by the admin API, not yet by the shop.
      </p>

      <DataTable>
        <DataTableHead>
          <Th width="160px">Slug</Th>
          <Th>Title</Th>
          <Th align="right" width="70px">
            Blocks
          </Th>
          <Th width="110px">Status</Th>
          <Th width="100px">Updated</Th>
          <Th width="150px">Published</Th>
          <Th width="80px" />
        </DataTableHead>

        <DataTableBody>
          {pages.map((page) => (
            <Tr key={page.id}>
              <Td>
                <span className="font-mono text-[11px]">/{page.slug}</span>
              </Td>
              <Td className="max-w-[320px]">
                <span className="block truncate">{page.title}</span>
                {page.eyebrow ? (
                  <span className="text-muted-foreground block truncate text-[11px]">
                    {page.eyebrow}
                  </span>
                ) : null}
              </Td>
              <Td numeric align="right">
                {page.body.length}
              </Td>
              <Td>
                <StatusPill
                  label={page.status === "PUBLISHED" ? "Published" : "Draft"}
                  tone={page.status === "PUBLISHED" ? "success" : "neutral"}
                />
              </Td>
              <Td className="text-muted-foreground whitespace-nowrap">
                {formatIstDate(page.updatedAt)}
              </Td>
              <Td>
                <Switch
                  size="sm"
                  checked={page.status === "PUBLISHED"}
                  disabled={pending}
                  aria-label={`Publish /${page.slug}`}
                  onCheckedChange={(checked) =>
                    run(() =>
                      setCmsPageStatus({
                        id: page.id,
                        status: checked ? "PUBLISHED" : "DRAFT",
                      }),
                    )
                  }
                />
              </Td>
              <Td align="right">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setEditing(page)}
                >
                  <SquarePen />
                  Edit
                </Button>
              </Td>
            </Tr>
          ))}
        </DataTableBody>
      </DataTable>

      {editing ? (
        <PageEditorSheet
          key={editing.id}
          page={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

type BodyBlock = { id?: string; title: string; content: string };

function PageEditorSheet({
  page,
  onClose,
}: {
  page: CmsPageRow;
  onClose: () => void;
}) {
  const [title, setTitle] = React.useState(page.title);
  const [eyebrow, setEyebrow] = React.useState(page.eyebrow);
  const [intro, setIntro] = React.useState(page.intro);
  const [metaTitle, setMetaTitle] = React.useState(page.metaTitle);
  const [metaDescription, setMetaDescription] = React.useState(
    page.metaDescription,
  );
  const [body, setBody] = React.useState<BodyBlock[]>(page.body);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useActionToast();

  function updateBlock(index: number, patch: Partial<BodyBlock>) {
    setBody((current) =>
      current.map((block, i) => (i === index ? { ...block, ...patch } : block)),
    );
  }

  function handleSave() {
    setErrors({});
    run(async () => {
      const result = await updateCmsPage({
        id: page.id,
        title,
        eyebrow,
        intro,
        body,
        metaTitle,
        metaDescription,
      });
      if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
      if (result.ok) onClose();
      return result;
    });
  }

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="text-sm">/{page.slug}</SheetTitle>
          <SheetDescription className="text-xs">
            Shared page shape: eyebrow, title, intro, then ordered body blocks.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-1">
          <section className="space-y-3">
            <Field
              label="Eyebrow"
              value={eyebrow}
              onChange={setEyebrow}
              error={errors.eyebrow}
              placeholder="CUSTOMER CARE"
            />
            <Field
              label="Title"
              value={title}
              onChange={setTitle}
              error={errors.title}
              required
            />
            <Field
              label="Intro"
              value={intro}
              onChange={setIntro}
              error={errors.intro}
              multiline
              rows={3}
            />
          </section>

          {/* Body blocks -------------------------------------------------- */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold">Body blocks</h3>
              <span className="text-muted-foreground text-[11px]">
                Block ids become the page anchors the footer links to.
              </span>
            </div>

            {body.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-xs">
                This page has no body blocks.
              </p>
            ) : (
              <ul className="space-y-2">
                {body.map((block, index) => (
                  <li
                    key={`${block.id ?? "new"}-${index}`}
                    className="surface space-y-2 p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        data-numeric
                        className="text-muted-foreground text-[11px]"
                      >
                        {index + 1}
                      </span>
                      <Input
                        value={block.title}
                        disabled={pending}
                        placeholder="Block heading"
                        aria-label={`Block ${index + 1} heading`}
                        aria-invalid={
                          errors[`body.${index}.title`] ? true : undefined
                        }
                        onChange={(event) =>
                          updateBlock(index, { title: event.target.value })
                        }
                        className="h-7 flex-1 text-xs"
                      />
                      <MoveButtons
                        label={`block ${index + 1}`}
                        disabled={pending}
                        canMoveUp={index > 0}
                        canMoveDown={index < body.length - 1}
                        onUp={() =>
                          setBody((current) =>
                            moveInList(current, index, index - 1),
                          )
                        }
                        onDown={() =>
                          setBody((current) =>
                            moveInList(current, index, index + 1),
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={pending}
                        aria-label={`Remove block ${index + 1}`}
                        onClick={() =>
                          setBody((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </div>

                    <Textarea
                      rows={4}
                      value={block.content}
                      disabled={pending}
                      placeholder="Block copy"
                      aria-label={`Block ${index + 1} copy`}
                      aria-invalid={
                        errors[`body.${index}.content`] ? true : undefined
                      }
                      onChange={(event) =>
                        updateBlock(index, { content: event.target.value })
                      }
                      className="text-xs"
                    />

                    {block.id ? (
                      <p className="text-muted-foreground text-[11px]">
                        Anchor: <span className="font-mono">#{block.id}</span>
                      </p>
                    ) : null}

                    {errors[`body.${index}.title`] ||
                    errors[`body.${index}.content`] ? (
                      <p className="text-destructive text-[11px]">
                        {errors[`body.${index}.title`] ??
                          errors[`body.${index}.content`]}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={pending}
              onClick={() =>
                setBody((current) => [...current, { title: "", content: "" }])
              }
            >
              <Plus />
              Add block
            </Button>
          </section>

          {/* SEO ---------------------------------------------------------- */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold">Search listing</h3>
            <Field
              label="Meta title"
              value={metaTitle}
              onChange={setMetaTitle}
              error={errors.metaTitle}
            />
            <Field
              label="Meta description"
              value={metaDescription}
              onChange={setMetaDescription}
              error={errors.metaDescription}
              multiline
              rows={2}
            />
          </section>

          {/* Extras ------------------------------------------------------- */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold">Page-specific extras</h3>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {page.extraKeys.length === 0
                ? "This page has no extras."
                : `Read-only here. ${page.extraKeys.join(", ")} ${page.extraKeys.length === 1 ? "is" : "are"} shaped differently per page type and gets its own editor once more than one page uses it.`}
            </p>
            <pre className="bg-muted text-muted-foreground scrollbar-thin max-h-56 overflow-auto rounded-lg border p-2 font-mono text-[11px] leading-relaxed">
              {page.extraJson}
            </pre>
          </section>
        </div>

        <SheetFooter className="border-t">
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={handleSave}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save page
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  onChange,
  error,
  placeholder,
  required,
  multiline,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
}) {
  const id = `page-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
        {required ? (
          <span className="text-destructive ml-0.5" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {multiline ? (
        <Textarea
          id={id}
          rows={rows ?? 3}
          value={value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="text-xs"
        />
      ) : (
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 text-xs"
        />
      )}
      {error ? <p className="text-destructive text-[11px]">{error}</p> : null}
    </div>
  );
}
