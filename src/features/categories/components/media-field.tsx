"use client";

import { ImagePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PickedAsset } from "@/components/shared/media-picker";
import { ProductThumb } from "@/components/shared/product-thumb";

/**
 * One media slot on a form: a thumbnail, the filename and choose / remove
 * buttons. The form stores the asset ID (FK column) and keeps the PickedAsset
 * only for display, which is why `onChange` hands back the whole asset and
 * the caller decides what to persist.
 */
export function MediaField({
  value,
  onChange,
  onPick,
  disabled,
  size = 56,
  emptyLabel = "No file chosen",
}: {
  value: PickedAsset | null;
  onChange: (asset: PickedAsset | null) => void;
  /** Opens the picker; resolves with the chosen asset or null. */
  onPick: () => Promise<PickedAsset | null>;
  disabled?: boolean;
  size?: number;
  emptyLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <ProductThumb src={value?.thumbnailUrl ?? value?.url ?? null} alt={value?.alt ?? ""} size={size} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-xs">{value ? value.filename : <span className="text-muted-foreground">{emptyLabel}</span>}</p>
        {value?.width && value.height ? (
          <p className="text-muted-foreground text-[11px]" data-numeric>
            {value.width} × {value.height}
          </p>
        ) : null}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled}
            onClick={async () => {
              const picked = await onPick();
              if (picked) onChange(picked);
            }}
          >
            <ImagePlus /> {value ? "Replace" : "Choose"}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={() => onChange(null)}>
              <X /> Remove
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
