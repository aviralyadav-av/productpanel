"use client";

import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, type RowSelection } from "@/components/shared/row-selection";
import { StatusPill } from "@/components/shared/status-badge";
import { formatIstDateTime } from "@/lib/dates";
import { MEDIA_KIND_META, MEDIA_VISIBILITY_META } from "@/lib/enums";

import { MediaThumb } from "@/features/media/components/media-preview";
import type { MediaAssetDto } from "@/features/media/dto";
import { formatBytes, formatDimensions } from "@/features/media/format";

/**
 * List view: the same rows as the grid with the metadata the grid hides
 * (type, exact upload time, id). Sorting is in the toolbar, not the header,
 * because the toolbar is shared with the grid view.
 */
export function MediaListTable({
  rows,
  selection,
  onOpen,
}: {
  rows: MediaAssetDto[];
  selection: RowSelection;
  onOpen(asset: MediaAssetDto): void;
}) {
  const table = (
    <DataTable>
      <DataTableHead>
        <Th width="2rem">
          <RowCheckbox {...selection.headerProps} label="Select all on this page" />
        </Th>
        <Th width="3rem">
          <span className="sr-only">Preview</span>
        </Th>
        <Th>File</Th>
        <Th>Type</Th>
        <Th align="right">Size</Th>
        <Th align="right">Dimensions</Th>
        <Th>Visibility</Th>
        <Th>Uploaded</Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((asset) => (
          <Tr key={asset.id} selected={selection.isSelected(asset.id)} onClick={() => onOpen(asset)} className="cursor-pointer">
            <Td>
              <RowCheckbox {...selection.rowProps(asset.id)} label={`Select ${asset.filename}`} />
            </Td>
            <Td>
              <MediaThumb asset={asset} size="row" />
            </Td>
            <Td>
              <p className="max-w-[28rem] truncate font-medium" title={asset.filename}>
                {asset.filename}
              </p>
              {asset.alt ? (
                <p className="text-muted-foreground max-w-[28rem] truncate text-[11px]" title={asset.alt}>
                  {asset.alt}
                </p>
              ) : null}
            </Td>
            <Td>
              <span className="text-muted-foreground">{asset.mimeType ?? MEDIA_KIND_META[asset.kind].label}</span>
            </Td>
            <Td align="right" numeric>
              {formatBytes(asset.sizeBytes)}
            </Td>
            <Td align="right" numeric>
              {formatDimensions(asset.width, asset.height)}
            </Td>
            <Td>
              <StatusPill label={MEDIA_VISIBILITY_META[asset.visibility].label} tone={MEDIA_VISIBILITY_META[asset.visibility].tone} />
            </Td>
            <Td>
              <span className="text-muted-foreground whitespace-nowrap">{formatIstDateTime(new Date(asset.createdAt))}</span>
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((asset) => (
    <div key={asset.id} className="flex items-start gap-3 px-4 py-3">
      <RowCheckbox {...selection.rowProps(asset.id)} label={`Select ${asset.filename}`} />
      <MediaThumb asset={asset} size="row" />
      <button type="button" onClick={() => onOpen(asset)} className="min-w-0 flex-1 text-left">
        <MobileCard
          title={asset.filename}
          subtitle={asset.mimeType ?? MEDIA_KIND_META[asset.kind].label}
          meta={<StatusPill label={MEDIA_VISIBILITY_META[asset.visibility].label} tone={MEDIA_VISIBILITY_META[asset.visibility].tone} />}
          className="px-0 py-0"
        >
          <MobileCardField label="Size" numeric>
            {formatBytes(asset.sizeBytes)}
          </MobileCardField>
          <MobileCardField label="Dimensions" numeric>
            {formatDimensions(asset.width, asset.height)}
          </MobileCardField>
        </MobileCard>
      </button>
    </div>
  ));

  return <ResponsiveTable table={table} cards={cards} />;
}
