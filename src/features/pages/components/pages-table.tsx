"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Archive, Copy, FileText, Lock, MoreHorizontal, Pencil, Send, Trash2, Undo2 } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { CMS_PAGE_STATUS_META, CMS_PAGE_TEMPLATE_META, type CmsPageStatus } from "@/lib/enums";
import type { ListParams, PageMeta } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/list-controls";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { deletePageAction, duplicatePageAction, setPageStatusAction } from "../actions";
import type { PageListRow } from "../schemas";
import { formatReadingTime, readingMinutes } from "../text";

/**
 * /admin/pages list body. Sorting and paging are URL state (SortableTh,
 * PaginationBar); row actions call Server Actions and refresh. Delete is
 * hidden for system pages (E5) and unpublishing one confirms first (§11.24).
 */
export function PagesTable({
  rows,
  meta,
  params,
  canManage,
  canPublish,
  filtered,
}: {
  rows: PageListRow[];
  meta: PageMeta;
  params: ListParams;
  canManage: boolean;
  canPublish: boolean;
  filtered: boolean;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const { pending, run } = useActionToast();

  async function setStatus(row: PageListRow, status: CmsPageStatus) {
    if (row.isSystem && row.status === "PUBLISHED" && status !== "PUBLISHED") {
      const answer = await confirm({
        title: `Unpublish "${row.title}"?`,
        description: "This is a system page: the storefront footer and checkout link to it. Those links lead nowhere until it is published again.",
        confirmLabel: "Unpublish anyway",
        destructive: true,
      });
      if (!answer.ok) return;
    }
    await run(() => setPageStatusAction(row.id, { status }), { onSuccess: () => router.refresh() });
  }

  async function duplicate(row: PageListRow) {
    await run(() => duplicatePageAction(row.id), { onSuccess: (data) => router.push(`/admin/pages/${data.id}` as Route) });
  }

  async function remove(row: PageListRow) {
    const answer = await confirm({
      title: `Delete "${row.title}"?`,
      description: "The page and its content are removed permanently. Menu items and banners that link to it will point nowhere. Archive it instead if you may need it again.",
      confirmLabel: "Delete page",
      destructive: true,
      requireTypedText: row.slug,
    });
    if (!answer.ok) return;
    await run(() => deletePageAction(row.id), { onSuccess: () => router.refresh() });
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={filtered ? "No pages match these filters" : "No pages yet"}
        description={filtered ? "Clear the search or pick another status." : "System pages (About, Contact, policies) are created by the seed; add your own with New page."}
      />
    );
  }

  const actions = (row: PageListRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.title}`} disabled={pending}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/admin/pages/${row.id}` as Route}>
            <Pencil /> {canManage ? "Edit" : "View"}
          </Link>
        </DropdownMenuItem>
        {canPublish ? (
          <>
            <DropdownMenuSeparator />
            {row.status !== "PUBLISHED" ? (
              <DropdownMenuItem onSelect={() => void setStatus(row, "PUBLISHED")}>
                <Send /> Publish
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => void setStatus(row, "DRAFT")}>
                <Undo2 /> Unpublish
              </DropdownMenuItem>
            )}
            {row.status !== "ARCHIVED" ? (
              <DropdownMenuItem onSelect={() => void setStatus(row, "ARCHIVED")}>
                <Archive /> Archive
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void duplicate(row)}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            {row.isSystem ? (
              <DropdownMenuItem disabled>
                <Lock /> System page — cannot delete
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onSelect={() => void remove(row)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            )}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const statusPill = (row: PageListRow) => {
    const meta = CMS_PAGE_STATUS_META[row.status];
    return <StatusPill label={meta.label} tone={meta.tone} />;
  };

  return (
    <>
      <ResponsiveTable
        table={
          <DataTable>
            <DataTableHead>
              <SortableTh column="title" label="Title" currentSort={params.sort} currentOrder={params.order} defaultOrder="asc" />
              <SortableTh column="template" label="Template" currentSort={params.sort} currentOrder={params.order} defaultOrder="asc" />
              <SortableTh column="status" label="Status" currentSort={params.sort} currentOrder={params.order} defaultOrder="asc" />
              <Th align="center">Footer</Th>
              <Th align="right">Length</Th>
              <Th>Author</Th>
              <SortableTh column="updatedAt" label="Updated" currentSort={params.sort} currentOrder={params.order} />
              <Th align="right" width="3rem">
                <span className="sr-only">Actions</span>
              </Th>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <div className="flex min-w-0 items-center gap-2">
                      <Link href={`/admin/pages/${row.id}` as Route} className="truncate font-medium hover:underline">
                        {row.title}
                      </Link>
                      {row.isSystem ? <StatusPill label="System" tone="brand" dot={false} /> : null}
                      {row.noIndex ? <StatusPill label="noindex" tone="neutral" dot={false} /> : null}
                    </div>
                    <p className="text-muted-foreground truncate font-mono text-[11px]">/pages/{row.slug}</p>
                  </Td>
                  <Td>{CMS_PAGE_TEMPLATE_META[row.template]?.label ?? row.template}</Td>
                  <Td>{statusPill(row)}</Td>
                  <Td align="center">{row.showInFooter ? <span className="text-success">Yes</span> : <span className="text-muted-foreground">—</span>}</Td>
                  <Td align="right" numeric>
                    <span title={`${row.wordCount.toLocaleString("en-IN")} words`}>{formatReadingTime(readingMinutes(row.wordCount))}</span>
                  </Td>
                  <Td className="text-muted-foreground max-w-40 truncate">{row.authorName ?? "—"}</Td>
                  <Td className="text-muted-foreground whitespace-nowrap">{formatIstDateTime(row.updatedAt)}</Td>
                  <Td align="right">{actions(row)}</Td>
                </Tr>
              ))}
            </DataTableBody>
          </DataTable>
        }
        cards={rows.map((row) => (
          <MobileCard key={row.id} title={row.title} subtitle={`/pages/${row.slug}`} meta={statusPill(row)} href={`/admin/pages/${row.id}`}>
            <MobileCardField label="Template">{CMS_PAGE_TEMPLATE_META[row.template]?.label ?? row.template}</MobileCardField>
            <MobileCardField label="Updated">{formatIstDateTime(row.updatedAt)}</MobileCardField>
            <MobileCardField label="Footer">{row.showInFooter ? "Yes" : "No"}</MobileCardField>
            <MobileCardField label="Author">{row.authorName ?? "—"}</MobileCardField>
          </MobileCard>
        ))}
      />
      <PaginationBar meta={meta} itemLabel="pages" />
      {confirmDialog}
    </>
  );
}
