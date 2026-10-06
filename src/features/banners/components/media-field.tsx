"use client";

import { ImagePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PickedAsset } from "@/components/shared/media-picker";
import { ProductThumb } from "@/components/shared/product-thumb";

/**
 * One media slot on a marketing form (banner creative, promotion banner): a
 * thumbnail, the filename and choose / replace / remove buttons. The form
 * persists only the asset ID (FK column) and keeps the PickedAsset for
 * display, so `onChange` hands back the whole asset and the caller decides.
 */
export function MediaField({
  value,
  onChange,
  onPick,
  disabled,
  size = 64,
  emptyLabel = "No image chosen",
  hint,
}: {
  value: PickedAsset | null;
  onChange: (asset: PickedAsset | null) => void;
  onPick: () => Promise<PickedAsset | null>;
  disabled?: boolean;
  size?: number;
  emptyLabel?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <ProductThumb src={value?.thumbnailUrl ?? value?.url ?? null} alt={value?.alt ?? ""} size={size} className="rounded-md" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-xs">{value ? value.filename : <span className="text-muted-foreground">{emptyLabel}</span>}</p>
        {value?.width && value.height ? (
          <p className="text-muted-foreground text-[11px]" data-numeric>
            {value.width} × {value.height}
          </p>
        ) : hint ? (
          <p className="text-muted-foreground text-[11px]">{hint}</p>
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
