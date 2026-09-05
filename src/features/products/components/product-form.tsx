"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  ImageOff,
  Images,
  Info,
  Layers,
  Loader2,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { Panel } from "@/components/shared/panel";
import { EmptyState } from "@/components/shared/empty-state";
import { ProductThumb } from "@/components/shared/product-thumb";
import { StockBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_META,
  stockState,
  type ProductStatus,
} from "@/lib/enums";
import {
  discountPercentage,
  formatPaise,
  paiseToRupees,
  rupeesToPaise,
} from "@/lib/money";
import { formatIstDateTime } from "@/lib/dates";
import { filenameFromUrl } from "@/lib/media";
import type {
  CategoryOption,
  EditorImage,
  EditorVariant,
  MediaOption,
  ProductEditorData,
} from "@/features/products/queries";
import {
  GENDERS,
  GENDER_LABELS,
  slugify,
  toDateInputValue,
  type Gender,
} from "@/features/products/schemas";
import {
  addProductImageByUrl,
  createProduct,
  deleteProduct,
  deleteProductImage,
  deleteVariant,
  setProductStatus,
  updateProduct,
  updateProductImage,
  upsertVariant,
  type ProductFormState,
} from "@/features/products/actions";

/**
 * One editor serves both /products/new and /products/[id].
 *
 * The product's own fields are a single explicit Save (never autosave - an
 * operator editing prices needs to be able to change their mind). Variants and
 * images are separate rows in separate tables, so they save independently and
 * immediately; batching them into the main Save would mean a half-applied form
 * on any failure.
 */

/** Radix Select needs a non-empty value, so this is the shared null sentinel. */
const NONE = "none";

type Draft = {
  title: string;
  slug: string;
  description: string;
  price: string;
  salePrice: string;
  saleStartsAt: string;
  saleEndsAt: string;
  position: string;
  metaTitle: string;
  metaDescription: string;
  status: ProductStatus;
  gender: Gender;
  categoryId: string;
  isFeatured: boolean;
};

function initialDraft(product: ProductEditorData | null): Draft {
  return {
    title: product?.title ?? "",
    slug: product?.slug ?? "",
    description: product?.description ?? "",
    price: product ? String(paiseToRupees(product.pricePaise)) : "",
    salePrice:
      product?.salePricePaise != null
        ? String(paiseToRupees(product.salePricePaise))
        : "",
    saleStartsAt: toDateInputValue(product?.saleStartsAt),
    saleEndsAt: toDateInputValue(product?.saleEndsAt),
    position: String(product?.position ?? 0),
    metaTitle: product?.metaTitle ?? "",
    metaDescription: product?.metaDescription ?? "",
    status: (product?.status as ProductStatus) ?? "DRAFT",
    gender: (product?.gender as Gender) ?? "women",
    categoryId: product?.categoryId ?? NONE,
    isFeatured: product?.isFeatured ?? false,
  };
}

function toPaise(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || !Number.isFinite(Number(trimmed))) return null;
  return rupeesToPaise(Number(trimmed));
}

export function ProductForm({
  mode,
  product,
  categories,
  media,
}: {
  mode: "create" | "edit";
  product: ProductEditorData | null;
  categories: CategoryOption[];
  media: MediaOption[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState<
    ProductFormState,
    FormData
  >(mode === "create" ? createProduct : updateProduct, null);

  const [draft, setDraft] = React.useState<Draft>(() => initialDraft(product));
  // A slug typed by hand is never overwritten again, even if the title changes.
  const [slugTouched, setSlugTouched] = React.useState(mode === "edit");
  const [dirty, setDirty] = React.useState(false);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  }

  const slug = slugTouched ? draft.slug : slugify(draft.title);

  const pricePaise = toPaise(draft.price);
  const salePaise = toPaise(draft.salePrice);
  const discount =
    pricePaise !== null ? discountPercentage(pricePaise, salePaise) : 0;
  const saleTooHigh =
    salePaise !== null && pricePaise !== null && salePaise >= pricePaise;

  const fieldError = (key: string) =>
    state && !state.ok ? state.fieldErrors?.[key] : undefined;

  // useActionState hands back a new object per submission, so comparing
  // identity is enough to run the side effects exactly once.
  const handled = React.useRef<ProductFormState>(null);
  React.useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;

    if (state.ok) {
      setDirty(false);
      toast.success(state.message ?? "Saved.");
      if (mode === "create") {
        router.replace(`/products/${state.data.id}` as never);
      } else {
        router.refresh();
      }
    } else {
      toast.error(state.error);
    }
  }, [state, mode, router]);

  React.useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Chrome still requires returnValue to be set for the prompt to show.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const parents = categories.filter((option) => option.parentId === null);
  const children = categories.filter((option) => option.parentId !== null);

  return (
    <form action={formAction} className="space-y-4">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="status" value={draft.status} />
      <input type="hidden" name="gender" value={draft.gender} />
      <input type="hidden" name="categoryId" value={draft.categoryId} />
      <input
        type="hidden"
        name="isFeatured"
        value={draft.isFeatured ? "true" : "false"}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        {/* ---------------------------------------------------------------- */}
        <div className="min-w-0 space-y-4">
          <Panel
            title="Basics"
            description="What a shopper reads first"
            bodyClassName="space-y-3 p-4"
          >
            <Field
              label="Title"
              htmlFor="title"
              error={fieldError("title")}
              required
            >
              <Input
                id="title"
                name="title"
                value={draft.title}
                onChange={(event) => update("title", event.target.value)}
                placeholder="Elegant Brown Handbag"
                maxLength={140}
                required
                aria-invalid={Boolean(fieldError("title"))}
              />
            </Field>

            <Field
              label="Slug"
              htmlFor="slug-input"
              error={fieldError("slug")}
              hint={
                slugTouched
                  ? "Changing this changes the storefront URL for this product."
                  : "Generated from the title. Edit it to take over."
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground shrink-0 text-xs">
                  /product/
                </span>
                <Input
                  id="slug-input"
                  value={slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    update("slug", event.target.value);
                  }}
                  className="font-mono text-xs"
                  aria-invalid={Boolean(fieldError("slug"))}
                />
                {slugTouched ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setSlugTouched(false);
                      update("slug", slugify(draft.title));
                    }}
                  >
                    Reset
                  </Button>
                ) : null}
              </div>
            </Field>

            <Field
              label="Description"
              htmlFor="description"
              error={fieldError("description")}
              hint="Plain text. There is no rich text editor installed, and the storefront renders this as a single paragraph."
            >
              <Textarea
                id="description"
                name="description"
                value={draft.description}
                onChange={(event) => update("description", event.target.value)}
                rows={5}
                maxLength={8000}
              />
            </Field>
          </Panel>

          <Panel
            title="Media"
            description="Images shown on the product page"
            bodyClassName="p-0"
            action={
              product ? (
                <MediaPicker productId={product.id} media={media} />
              ) : null
            }
          >
            {product ? (
              <MediaSection
                productId={product.id}
                images={product.images}
                variants={product.variants}
              />
            ) : (
              <p className="text-muted-foreground px-4 py-6 text-center text-xs">
                Save the draft first. Images attach to a product row, so there
                is nothing to attach them to yet.
              </p>
            )}
          </Panel>

          <Panel
            title="Pricing"
            description="Entered in rupees, stored in paise"
            bodyClassName="space-y-3 p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Price"
                htmlFor="price"
                error={fieldError("pricePaise")}
                required
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">₹</span>
                  <Input
                    id="price"
                    name="price"
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(event) => update("price", event.target.value)}
                    placeholder="2999"
                    className="tabular"
                    required
                    aria-invalid={Boolean(fieldError("pricePaise"))}
                  />
                </div>
              </Field>

              <Field
                label="Sale price"
                htmlFor="salePrice"
                error={fieldError("salePricePaise")}
                hint="Leave blank for no sale."
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">₹</span>
                  <Input
                    id="salePrice"
                    name="salePrice"
                    inputMode="decimal"
                    value={draft.salePrice}
                    onChange={(event) =>
                      update("salePrice", event.target.value)
                    }
                    placeholder="2499"
                    className="tabular"
                    aria-invalid={Boolean(fieldError("salePricePaise"))}
                  />
                </div>
              </Field>
            </div>

            <div className="bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs">
              {salePaise === null ? (
                <span className="text-muted-foreground">
                  No sale price. Shoppers see{" "}
                  <span data-numeric className="text-foreground font-medium">
                    {pricePaise === null ? "—" : formatPaise(pricePaise)}
                  </span>
                  .
                </span>
              ) : saleTooHigh ? (
                <>
                  <TriangleAlert className="text-warning size-3.5 shrink-0" />
                  <span className="text-warning font-medium">
                    The sale price is at or above the list price.
                  </span>
                  <span className="text-muted-foreground">
                    This saves, but the storefront would show a discount badge
                    with no discount behind it.
                  </span>
                </>
              ) : (
                <>
                  <span data-numeric className="font-medium">
                    {formatPaise(salePaise)}
                  </span>
                  <span className="text-muted-foreground line-through" data-numeric>
                    {pricePaise === null ? "—" : formatPaise(pricePaise)}
                  </span>
                  <span className="bg-success-muted text-success rounded px-1.5 py-0.5 font-medium">
                    {discount}% off
                  </span>
                  <span className="text-muted-foreground">
                    Saves a shopper{" "}
                    {pricePaise === null
                      ? "—"
                      : formatPaise(pricePaise - salePaise)}
                    .
                  </span>
                </>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Sale starts"
                htmlFor="saleStartsAt"
                error={fieldError("saleStartsAt")}
                hint="Optional. Blank means it starts immediately."
              >
                <Input
                  id="saleStartsAt"
                  name="saleStartsAt"
                  type="date"
                  value={draft.saleStartsAt}
                  onChange={(event) =>
                    update("saleStartsAt", event.target.value)
                  }
                />
              </Field>

              <Field
                label="Sale ends"
                htmlFor="saleEndsAt"
                error={fieldError("saleEndsAt")}
                hint="Optional. Both boundaries are IST days."
              >
                <Input
                  id="saleEndsAt"
                  name="saleEndsAt"
                  type="date"
                  value={draft.saleEndsAt}
                  onChange={(event) => update("saleEndsAt", event.target.value)}
                />
              </Field>
            </div>
          </Panel>

          <Panel
            title="Variants"
            description="One row per purchasable colourway"
            bodyClassName="p-0"
          >
            {product ? (
              <VariantSection
                productId={product.id}
                variants={product.variants}
              />
            ) : (
              <div className="space-y-3 p-4">
                <p className="text-muted-foreground text-xs">
                  A product needs at least one colourway before it can be sold,
                  because stock is tracked per variant. Name the first one here
                  and the rest are added after the draft is saved.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="First colourway" htmlFor="firstVariantName">
                    <Input
                      id="firstVariantName"
                      name="firstVariantName"
                      placeholder="Brown"
                      maxLength={80}
                      onChange={() => setDirty(true)}
                    />
                  </Field>
                  <Field label="SKU" htmlFor="firstVariantSku" hint="Optional.">
                    <Input
                      id="firstVariantSku"
                      name="firstVariantSku"
                      placeholder="HANDBAG-001-BROWN"
                      maxLength={64}
                      className="font-mono text-xs"
                      onChange={() => setDirty(true)}
                    />
                  </Field>
                </div>
              </div>
            )}
          </Panel>

          <Panel
            title="Search engine listing"
            description="How this product would appear in results"
            bodyClassName="space-y-3 p-4"
          >
            <Field
              label="Meta title"
              htmlFor="metaTitle"
              error={fieldError("metaTitle")}
              hint={`${draft.metaTitle.length}/60 characters used${
                draft.metaTitle.length > 60 ? " — Google will truncate this" : ""
              }`}
            >
              <Input
                id="metaTitle"
                name="metaTitle"
                value={draft.metaTitle}
                onChange={(event) => update("metaTitle", event.target.value)}
                placeholder={draft.title || "Falls back to the product title"}
                maxLength={160}
              />
            </Field>

            <Field
              label="Meta description"
              htmlFor="metaDescription"
              error={fieldError("metaDescription")}
              hint={`${draft.metaDescription.length}/160 characters used${
                draft.metaDescription.length > 160
                  ? " — Google will truncate this"
                  : ""
              }`}
            >
              <Textarea
                id="metaDescription"
                name="metaDescription"
                value={draft.metaDescription}
                onChange={(event) =>
                  update("metaDescription", event.target.value)
                }
                rows={3}
                maxLength={400}
                placeholder="Falls back to the product description"
              />
            </Field>

            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-wide">
                Preview
              </p>
              <p className="text-muted-foreground truncate text-xs">
                niyabags.com › product › {slug || "your-product"}
              </p>
              <p className="text-info truncate text-sm">
                {truncate(draft.metaTitle || draft.title || "Product title", 60)}
              </p>
              <p className="text-muted-foreground line-clamp-2 text-xs">
                {truncate(
                  draft.metaDescription ||
                    draft.description ||
                    "No description yet.",
                  160,
                )}
              </p>
            </div>
          </Panel>
        </div>

        {/* ---------------------------------------------------------------- */}
        <aside className="space-y-4 xl:sticky xl:top-16">
          <Panel title="Status" bodyClassName="space-y-3 p-4">
            <Select
              value={draft.status}
              onValueChange={(value) =>
                update("status", value as ProductStatus)
              }
            >
              <SelectTrigger className="w-full" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {PRODUCT_STATUS_META[status].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <p className="text-muted-foreground text-xs leading-relaxed">
              {PRODUCT_STATUS_META[draft.status].description}
            </p>

            {product ? (
              <dl className="text-muted-foreground space-y-1 border-t pt-3 text-[11px]">
                <MetaRow
                  label="Created"
                  value={formatIstDateTime(product.createdAt)}
                />
                <MetaRow
                  label="Updated"
                  value={formatIstDateTime(product.updatedAt)}
                />
                <MetaRow
                  label="Published"
                  value={
                    product.publishedAt
                      ? formatIstDateTime(product.publishedAt)
                      : "Never"
                  }
                />
                <MetaRow label="Order lines" value={String(product.orderItemCount)} />
                <MetaRow label="Reviews" value={String(product.reviewCount)} />
              </dl>
            ) : null}
          </Panel>

          <Panel title="Organization" bodyClassName="space-y-3 p-4">
            <Field label="Category" htmlFor="category-select">
              <Select
                value={draft.categoryId}
                onValueChange={(value) => update("categoryId", value)}
              >
                <SelectTrigger
                  id="category-select"
                  className="w-full"
                  aria-label="Category"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Uncategorised</SelectItem>
                  <SelectSeparator />
                  {parents.map((parent) => (
                    <SelectItem key={parent.id} value={parent.id}>
                      {parent.name}
                    </SelectItem>
                  ))}
                  {children.length > 0 ? <SelectSeparator /> : null}
                  {children.map((child) => (
                    <SelectItem key={child.id} value={child.id}>
                      {child.parentName ? `${child.parentName} › ` : ""}
                      {child.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Audience"
              htmlFor="gender-select"
              hint="The storefront filters its shop page on this."
            >
              <Select
                value={draft.gender}
                onValueChange={(value) => update("gender", value as Gender)}
              >
                <SelectTrigger
                  id="gender-select"
                  className="w-full"
                  aria-label="Audience"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENDERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {GENDER_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <div>
                <Label htmlFor="isFeatured" className="text-xs">
                  Featured
                </Label>
                <p className="text-muted-foreground text-[11px]">
                  Eligible for the homepage featured row.
                </p>
              </div>
              <Switch
                id="isFeatured"
                checked={draft.isFeatured}
                onCheckedChange={(checked) => update("isFeatured", checked)}
              />
            </div>

            <Field
              label="Sort position"
              htmlFor="position"
              error={fieldError("position")}
              hint="Lower numbers come first in the storefront grid."
            >
              <Input
                id="position"
                name="position"
                inputMode="numeric"
                value={draft.position}
                onChange={(event) => update("position", event.target.value)}
                className="tabular"
              />
            </Field>
          </Panel>

          {product ? (
            <DangerZone
              productId={product.id}
              title={product.title}
              status={draft.status}
              orderItemCount={product.orderItemCount}
            />
          ) : null}
        </aside>
      </div>

      {/* Sticky so Save is reachable from anywhere in a long editor. */}
      <div className="bg-background/90 sticky bottom-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 backdrop-blur">
        <p className="text-muted-foreground text-xs">
          {dirty
            ? "Unsaved changes."
            : mode === "create"
              ? "New products are created as a draft unless you change the status."
              : "All changes saved."}
        </p>

        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/products">Back to products</Link>
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />}
            {mode === "create" ? "Create product" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Field scaffolding
// ---------------------------------------------------------------------------

function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p className="text-destructive text-[11px]">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-[11px]">{hint}</p>
      ) : null}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt>{label}</dt>
      <dd data-numeric className="text-foreground">
        {value}
      </dd>
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

function VariantSection({
  productId,
  variants,
}: {
  productId: string;
  variants: EditorVariant[];
}) {
  const [adding, setAdding] = React.useState(false);

  return (
    <div>
      {variants.length === 0 ? (
        <EmptyState
          compact
          icon={Layers}
          title="No colourways yet"
          description="Stock is tracked per variant, so this product cannot be sold until it has at least one."
        />
      ) : (
        <div className="divide-y">
          {variants.map((variant) => (
            <VariantRow
              key={variant.id}
              productId={productId}
              variant={variant}
            />
          ))}
        </div>
      )}

      <div className="border-t p-3">
        {adding ? (
          <VariantRow
            productId={productId}
            variant={null}
            nextPosition={variants.length}
            onDone={() => setAdding(false)}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
          >
            <Plus />
            Add colourway
          </Button>
        )}
      </div>
    </div>
  );
}

function VariantRow({
  productId,
  variant,
  nextPosition = 0,
  onDone,
}: {
  productId: string;
  variant: EditorVariant | null;
  nextPosition?: number;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState(variant?.name ?? "");
  const [sku, setSku] = React.useState(variant?.sku ?? "");
  const [position, setPosition] = React.useState(
    String(variant?.position ?? nextPosition),
  );
  const [isActive, setIsActive] = React.useState(variant?.isActive ?? true);

  const changed =
    variant === null ||
    name !== variant.name ||
    sku !== (variant.sku ?? "") ||
    position !== String(variant.position) ||
    isActive !== variant.isActive;

  function save() {
    startTransition(async () => {
      const result = await upsertVariant({
        id: variant?.id,
        productId,
        name,
        sku: sku || undefined,
        position: Number(position) || 0,
        isActive,
      });

      if (result.ok) {
        toast.success(result.message ?? "Saved.");
        if (!variant) {
          setName("");
          setSku("");
        }
        onDone?.();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function remove() {
    if (!variant) return;
    startTransition(async () => {
      const result = await deleteVariant(variant.id);
      if (result.ok) {
        toast.success(result.message ?? "Deleted.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div
      className={cn(
        "grid gap-2 p-3 sm:grid-cols-[1fr_1fr_auto]",
        !variant && "p-0",
      )}
    >
      <div className="space-y-1">
        <Label className="text-muted-foreground text-[11px]">Colourway</Label>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Brown"
          maxLength={80}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-muted-foreground text-[11px]">SKU</Label>
        <Input
          value={sku}
          onChange={(event) => setSku(event.target.value)}
          placeholder="Optional"
          maxLength={64}
          className="font-mono text-xs"
        />
      </div>

      <div className="flex items-end gap-2">
        <div className="w-16 space-y-1">
          <Label className="text-muted-foreground text-[11px]">Pos.</Label>
          <Input
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            inputMode="numeric"
            className="tabular"
          />
        </div>

        <div className="flex h-8 items-center gap-1.5">
          <Switch
            size="sm"
            checked={isActive}
            onCheckedChange={setIsActive}
            aria-label="Active"
          />
          <span className="text-muted-foreground text-[11px]">Active</span>
        </div>

        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={save}
          disabled={pending || !changed || name.trim().length === 0}
          aria-label={variant ? "Save colourway" : "Add colourway"}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
        </Button>

        {variant ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Delete colourway"
              >
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{variant.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the colourway, its inventory row and its entire
                  stock movement history. There is no undo. If it has ever been
                  ordered, deactivate it instead.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  size="sm"
                  variant="destructive"
                  onClick={remove}
                >
                  Delete colourway
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onDone}
            aria-label="Cancel"
          >
            <Trash2 />
          </Button>
        )}
      </div>

      {variant ? (
        <div className="text-muted-foreground flex items-center gap-2 text-[11px] sm:col-span-3">
          <StockBadge
            state={stockState(variant.available, variant.lowStockThreshold)}
          />
          <span data-numeric>
            {variant.available} available · {variant.onHand} on hand ·{" "}
            {variant.reserved} reserved
          </span>
          <Link
            href={"/inventory" as never}
            className="hover:text-foreground inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            Adjust stock
            <ExternalLink className="size-3" />
          </Link>
          {!variant.hasInventory ? (
            <span className="text-warning">No inventory row</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

function MediaSection({
  productId,
  images,
  variants,
}: {
  productId: string;
  images: EditorImage[];
  variants: EditorVariant[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [url, setUrl] = React.useState("");
  const [variantId, setVariantId] = React.useState<string>(NONE);

  function add() {
    startTransition(async () => {
      const result = await addProductImageByUrl({
        productId,
        url,
        variantId: variantId === NONE ? null : variantId,
      });
      if (result.ok) {
        toast.success(result.message ?? "Image added.");
        setUrl("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  /**
   * Position is a plain integer column with no swap helper in the schema, so
   * reordering is two writes: this image takes its neighbour's position and
   * the neighbour takes this one's.
   */
  function move(index: number, direction: -1 | 1) {
    const current = images[index];
    const neighbour = images[index + direction];
    if (!current || !neighbour) return;

    startTransition(async () => {
      const first = await updateProductImage({
        id: current.id,
        alt: current.alt ?? undefined,
        position: neighbour.position,
      });
      if (!first.ok) {
        toast.error(first.error);
        return;
      }
      const second = await updateProductImage({
        id: neighbour.id,
        alt: neighbour.alt ?? undefined,
        position: current.position,
      });
      if (!second.ok) {
        toast.error(second.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      {images.length === 0 ? (
        <EmptyState
          compact
          icon={ImageOff}
          title="No images"
          description="Published products with no image render as blank cards on the storefront."
        />
      ) : (
        <ul className="divide-y">
          {images.map((image, index) => (
            <ImageRow
              key={image.id}
              image={image}
              canMoveUp={index > 0}
              canMoveDown={index < images.length - 1}
              onMove={(direction) => move(index, direction)}
              busy={pending}
            />
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="image-url" className="text-muted-foreground text-[11px]">
              Add by URL
            </Label>
            <Input
              id="image-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="/products/bags/tote-brown-1.jpg or https://…"
              className="font-mono text-xs"
            />
          </div>

          {variants.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-muted-foreground text-[11px]">
                Colourway
              </Label>
              <Select value={variantId} onValueChange={setVariantId}>
                <SelectTrigger size="sm" className="w-40" aria-label="Colourway">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>All colourways</SelectItem>
                  {variants.map((variant) => (
                    <SelectItem key={variant.id} value={variant.id}>
                      {variant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={add}
            disabled={pending || url.trim().length === 0}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Plus />}
            Add
          </Button>
        </div>

        <p className="text-muted-foreground flex items-start gap-1.5 text-[11px]">
          <Info className="mt-px size-3 shrink-0" />
          There is no upload storage provider configured yet, so images are
          added by URL or picked from what the importer already brought in. A
          real uploader appears here once one is wired up.
        </p>
      </div>
    </div>
  );
}

function ImageRow({
  image,
  canMoveUp,
  canMoveDown,
  onMove,
  busy,
}: {
  image: EditorImage;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  busy: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [alt, setAlt] = React.useState(image.alt ?? "");

  const changed = alt !== (image.alt ?? "");

  function save() {
    startTransition(async () => {
      const result = await updateProductImage({
        id: image.id,
        alt: alt || undefined,
        position: image.position,
      });
      if (result.ok) {
        toast.success("Alt text saved.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteProductImage(image.id);
      if (result.ok) {
        toast.success(result.message ?? "Removed.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <li className="flex items-center gap-3 p-3">
      <ProductThumb src={image.url} alt={alt || image.filename} size={44} />

      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-muted-foreground truncate font-mono text-[11px]">
          {image.filename || filenameFromUrl(image.url)}
          {image.variantName ? (
            <span className="text-foreground ml-1.5 font-sans">
              · {image.variantName}
            </span>
          ) : null}
        </p>
        <Input
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          placeholder="Alt text — describe the bag for screen readers"
          maxLength={300}
          className="h-7 text-xs"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={!canMoveUp || busy || pending}
          onClick={() => onMove(-1)}
          aria-label="Move up"
        >
          <ArrowUp />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={!canMoveDown || busy || pending}
          onClick={() => onMove(1)}
          aria-label="Move down"
        >
          <ArrowDown />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={save}
          disabled={!changed || pending}
          aria-label="Save alt text"
        >
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Remove image"
            >
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this image?</AlertDialogTitle>
              <AlertDialogDescription>
                Only the link between this product and the file is removed. The
                file stays in the media library and any other product using it
                is unaffected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
              <AlertDialogAction size="sm" variant="destructive" onClick={remove}>
                Remove image
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function MediaPicker({
  productId,
  media,
}: {
  productId: string;
  media: MediaOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function attach(asset: MediaOption) {
    startTransition(async () => {
      const result = await addProductImageByUrl({
        productId,
        url: asset.url,
        alt: asset.alt ?? undefined,
      });
      if (result.ok) {
        toast.success(result.message ?? "Image added.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="xs">
          <Images />
          Pick from library
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Media library</DialogTitle>
          <DialogDescription>
            The {media.length} most recent assets already in this database.
            Picking one links it to this product; it does not copy the file.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-80">
          <div className="grid grid-cols-3 gap-2 pr-3 sm:grid-cols-5">
            {media.map((asset) => (
              <button
                key={asset.id}
                type="button"
                disabled={pending}
                onClick={() => attach(asset)}
                title={asset.filename}
                className="hover:border-brand focus-visible:border-brand flex flex-col items-center gap-1 rounded-lg border p-1.5 text-left transition-colors disabled:opacity-50"
              >
                <ProductThumb src={asset.url} alt={asset.filename} size={72} />
                <span className="text-muted-foreground w-full truncate text-[10px]">
                  {asset.filename}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

function DangerZone({
  productId,
  title,
  status,
  orderItemCount,
}: {
  productId: string;
  title: string;
  status: ProductStatus;
  orderItemCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function archive() {
    startTransition(async () => {
      const result = await setProductStatus(productId, "ARCHIVED");
      if (result.ok) {
        toast.success(result.message ?? "Archived.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function destroy() {
    startTransition(async () => {
      const result = await deleteProduct(productId);
      if (result.ok) {
        toast.success(result.message ?? "Deleted.");
        router.push("/products");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Panel
      title="Danger zone"
      description="Archiving is almost always the right choice"
      bodyClassName="space-y-3 p-4"
      className="border-destructive/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">Archive</p>
          <p className="text-muted-foreground text-[11px]">
            Hides it from the storefront. Orders, reviews and stock history stay.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={archive}
          disabled={pending || status === "ARCHIVED"}
        >
          {status === "ARCHIVED" ? "Archived" : "Archive"}
        </Button>
      </div>

      <div className="flex items-start justify-between gap-3 border-t pt-3">
        <div className="min-w-0">
          <p className="text-destructive text-xs font-medium">Delete</p>
          <p className="text-muted-foreground text-[11px]">
            Permanently removes the product, its variants and their stock
            ledger.
          </p>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" size="xs" disabled={pending}>
              <Trash2 />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{title}” for good?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the product, every colourway, their inventory rows
                and their entire stock movement history. There is no undo.
                {orderItemCount > 0
                  ? ` ${orderItemCount} existing order line${orderItemCount === 1 ? "" : "s"} will keep their own price and title snapshot, but will no longer link back to a catalogue product.`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel size="sm">Keep it</AlertDialogCancel>
              <AlertDialogAction
                size="sm"
                variant="destructive"
                onClick={destroy}
              >
                Delete permanently
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Panel>
  );
}
