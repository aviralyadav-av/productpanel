"use client";

import * as React from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ImagePlus, Star, Trash2, Video, X } from "lucide-react";
import { cn } from "cn";

import { FormRow, FormSection } from "@/components/shared/form-layout";
import { ProductThumb } from "@/components/shared/product-thumb";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";

import { addImagesAction, removeImageAction, reorderImagesAction, updateImageAction } from "@/features/products/editor-actions";
import type { EditorImage, EditorProduct } from "@/features/products/queries";

import type { Picker, SectionProps } from "./basics-section";

/**
 * Gallery (blueprint §11.5, §11.22). Images are media-library references;
 * order is dragged (dnd-kit grid), the primary is starred, alt text saves on
 * blur. The video is part of the main form: either an external URL or a
 * library video, never both.
 */
export function ImagesSection({ product, state, set, errors, disabled, picker }: SectionProps & { product: EditorProduct; picker: Picker }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [order, setOrder] = React.useState(product.images.map((image) => image.id));
  // Re-seed the local order whenever the server payload changes (previous
  // prop in state), so an optimistic drag never fights a refresh.
  const serverOrder = product.images.map((image) => image.id).join("|");
  const [seenOrder, setSeenOrder] = React.useState(serverOrder);
  if (seenOrder !== serverOrder) {
    setSeenOrder(serverOrder);
    setOrder(product.images.map((image) => image.id));
  }
  const byId = new Map(product.images.map((image) => [image.id, image]));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setOrder(next);
    await run(() => reorderImagesAction(product.id, next), { silent: true, onSuccess: () => router.refresh() });
  };

  const add = async () => {
    const picked = await picker.open({ accept: "image", multiple: true, title: "Add images to the gallery" });
    if (!picked || picked.length === 0) return;
    await run(() => addImagesAction(product.id, picked.map((asset) => asset.id)), { onSuccess: () => router.refresh() });
  };

  const pickVideo = async () => {
    const picked = await picker.open({ accept: "video", multiple: false, title: "Choose a video" });
    const asset = picked?.[0];
    if (asset) set({ videoMedia: { id: asset.id, url: asset.url, thumbnailUrl: asset.thumbnailUrl, filename: asset.filename }, videoUrl: "" });
  };

  return (
    <FormSection
      id="images"
      title="Images & video"
      description="Drag to reorder; the starred image is the primary one shown in listings. At least one image is required to publish. Variant-specific photos are set on each variant."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => void add()} disabled={disabled || pending}>
          <ImagePlus /> Add images
        </Button>
      }
    >
      {order.length === 0 ? (
        <button type="button" onClick={() => void add()} disabled={disabled} className="text-muted-foreground hover:bg-accent/40 flex w-full flex-col items-center gap-1 rounded-lg border border-dashed p-8 text-xs">
          <ImagePlus className="size-5" />
          No images yet - add from the media library.
        </button>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onDragEnd(event)}>
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {order.map((id) => {
                const image = byId.get(id);
                return image ? <GalleryTile key={id} image={image} productId={product.id} disabled={disabled} /> : null;
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <FormRow label="Video URL" htmlFor="videoUrl" error={errors.videoUrl} hint="YouTube/Vimeo/MP4 link, or pick a library video.">
          <Input id="videoUrl" value={state.videoUrl} onChange={(event) => set({ videoUrl: event.target.value, videoMedia: event.target.value ? null : state.videoMedia })} placeholder="https://" disabled={disabled || !!state.videoMedia} />
        </FormRow>
        <div className="flex items-center gap-2 pb-5">
          {state.videoMedia ? (
            <span className="bg-muted inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs">
              <Video className="size-3.5" /> {state.videoMedia.filename}
              <button type="button" aria-label="Remove video" onClick={() => set({ videoMedia: null })} disabled={disabled}>
                <X className="size-3" />
              </button>
            </span>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => void pickVideo()} disabled={disabled || !!state.videoUrl}>
              <Video /> Library video
            </Button>
          )}
        </div>
      </div>
    </FormSection>
  );
}

function GalleryTile({ image, productId, disabled }: { image: EditorImage; productId: string; disabled: boolean }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [alt, setAlt] = React.useState(image.alt ?? "");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id, disabled });

  const saveAlt = () => {
    if (alt === (image.alt ?? "")) return;
    void run(() => updateImageAction(productId, image.id, { alt }), { silent: true, onSuccess: () => router.refresh() });
  };

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("bg-background relative flex flex-col gap-1.5 rounded-lg border p-2", isDragging && "z-10 shadow-md", image.isPrimary && "ring-brand ring-2")}>
      <div className="relative">
        <ProductThumb src={image.thumbnailUrl ?? image.url} alt={image.alt ?? image.filename} size={160} className="aspect-square h-auto w-full" />
        <button type="button" className="bg-background/80 absolute top-1 left-1 rounded p-0.5" aria-label="Drag to reorder" {...attributes} {...listeners} disabled={disabled}>
          <GripVertical className="size-3.5" />
        </button>
        <div className="absolute top-1 right-1 flex gap-1">
          <Button type="button" size="icon-xs" variant={image.isPrimary ? "default" : "secondary"} aria-label={image.isPrimary ? "Primary image" : "Make primary"} disabled={disabled || pending || image.isPrimary} onClick={() => void run(() => updateImageAction(productId, image.id, { isPrimary: true }), { onSuccess: () => router.refresh() })}>
            <Star />
          </Button>
          <Button type="button" size="icon-xs" variant="secondary" aria-label="Remove image" disabled={disabled || pending} onClick={() => void run(() => removeImageAction(productId, image.id), { onSuccess: () => router.refresh() })}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <Input value={alt} onChange={(event) => setAlt(event.target.value)} onBlur={saveAlt} onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), saveAlt())} placeholder="Alt text" className="h-7 text-xs" disabled={disabled} aria-label={`Alt text for ${image.filename}`} />
    </li>
  );
}
