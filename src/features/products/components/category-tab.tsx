"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CornerDownRight, Info, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { Panel } from "@/components/shared/panel";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
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
import { formatNumber } from "@/lib/money";
import type { CategoryNode } from "@/features/products/queries";
import { slugify } from "@/features/products/schemas";
import { deleteCategory, upsertCategory } from "@/features/products/actions";

/**
 * The tree is exactly two levels, because that is what the storefront data is:
 * the legacy `category` field ("bags") is the parent and `subcategory`
 * ("handbags", "tote", ...) is the child. Products attach to the child.
 */
const NONE = "none";

export function CategoryTab({ tree }: { tree: CategoryNode[] }) {
  const parents = tree.map((node) => ({ id: node.id, name: node.name }));

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel
        title="Category tree"
        description="Two levels: a top-level group and the sub-categories products attach to"
        bodyClassName="p-0"
      >
        {tree.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="No categories yet"
            description="Products can live without a category, but the storefront navigation is built from this tree."
          />
        ) : (
          <div className="divide-y">
            {tree.map((parent) => (
              <div key={parent.id}>
                <CategoryRow node={parent} parents={parents} />
                {parent.children.map((child) => (
                  <CategoryRow
                    key={child.id}
                    node={child}
                    parents={parents}
                    nested
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <aside className="space-y-4">
        <NewCategoryPanel parents={parents} />

        <Panel title="What these do" bodyClassName="space-y-2 p-4">
          <p className="text-muted-foreground text-xs leading-relaxed">
            The <span className="text-foreground font-medium">product count</span>{" "}
            on a top-level row includes everything in its children. Only child
            categories carry products directly.
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            <span className="text-foreground font-medium">Inactive</span>{" "}
            categories are meant to disappear from storefront navigation, and{" "}
            <span className="text-foreground font-medium">featured</span> ones
            are eligible for the homepage category strip. Neither takes effect
            on the live site yet — it still reads its own static data files.
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Deleting a category never deletes products. The foreign key is
            <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-[11px]">
              onDelete: SetNull
            </code>
            , so its products become uncategorised and drop out of category
            pages until they are reassigned.
          </p>
        </Panel>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CategoryRow({
  node,
  parents,
  nested = false,
}: {
  node: CategoryNode;
  parents: Array<{ id: string; name: string }>;
  nested?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState(node.name);
  const [slug, setSlug] = React.useState(node.slug);
  const [position, setPosition] = React.useState(String(node.position));
  const [isActive, setIsActive] = React.useState(node.isActive);
  const [isFeatured, setIsFeatured] = React.useState(node.isFeatured);
  const [parentId, setParentId] = React.useState(node.parentId ?? NONE);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const changed =
    name !== node.name ||
    slug !== node.slug ||
    position !== String(node.position) ||
    isActive !== node.isActive ||
    isFeatured !== node.isFeatured ||
    parentId !== (node.parentId ?? NONE);

  function save() {
    startTransition(async () => {
      const result = await upsertCategory({
        id: node.id,
        name,
        slug,
        parentId: parentId === NONE ? null : parentId,
        description: node.description ?? undefined,
        position: Number(position) || 0,
        isActive,
        isFeatured,
      });

      if (result.ok) {
        setErrors({});
        toast.success(result.message ?? "Saved.");
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteCategory(node.id);
      if (result.ok) {
        toast.success(result.message ?? "Deleted.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  // Only a category with no children may be reparented; the tree stays two
  // levels deep by construction rather than by hoping nobody nests further.
  const canReparent = node.children.length === 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-2 px-4 py-2.5",
        nested && "bg-muted/20 pl-10",
      )}
    >
      {nested ? (
        <CornerDownRight className="text-muted-foreground/50 mb-2 -ml-6 size-3.5 shrink-0" />
      ) : null}

      <div className="min-w-40 flex-1 space-y-1">
        <Label className="text-muted-foreground text-[11px]">Name</Label>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          className="h-7 text-xs"
          aria-invalid={Boolean(errors.name)}
        />
      </div>

      <div className="min-w-40 flex-1 space-y-1">
        <Label className="text-muted-foreground text-[11px]">Slug</Label>
        <Input
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          maxLength={80}
          className="h-7 font-mono text-xs"
          aria-invalid={Boolean(errors.slug)}
        />
      </div>

      {canReparent ? (
        <div className="w-36 space-y-1">
          <Label className="text-muted-foreground text-[11px]">Parent</Label>
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger size="sm" className="w-full" aria-label="Parent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Top level</SelectItem>
              {parents
                .filter((parent) => parent.id !== node.id)
                .map((parent) => (
                  <SelectItem key={parent.id} value={parent.id}>
                    {parent.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="w-14 space-y-1">
        <Label className="text-muted-foreground text-[11px]">Pos.</Label>
        <Input
          value={position}
          onChange={(event) => setPosition(event.target.value)}
          inputMode="numeric"
          className="tabular h-7 text-xs"
        />
      </div>

      <div className="flex h-7 items-center gap-1.5">
        <Switch
          size="sm"
          checked={isActive}
          onCheckedChange={setIsActive}
          aria-label="Active"
        />
        <span className="text-muted-foreground text-[11px]">Active</span>
      </div>

      <div className="flex h-7 items-center gap-1.5">
        <Switch
          size="sm"
          checked={isFeatured}
          onCheckedChange={setIsFeatured}
          aria-label="Featured"
        />
        <span className="text-muted-foreground text-[11px]">Featured</span>
      </div>

      <div className="flex h-7 items-center">
        {node.totalProductCount === 0 ? (
          <StatusPill label="No products" tone="warning" />
        ) : (
          <Link
            href={`/products?category=${node.id}` as never}
            className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2"
          >
            <span data-numeric>{formatNumber(node.totalProductCount)}</span>{" "}
            product{node.totalProductCount === 1 ? "" : "s"}
          </Link>
        )}
      </div>

      <div className="ml-auto flex h-7 items-center gap-1">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={save}
          disabled={pending || !changed}
          aria-label={`Save ${node.name}`}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete ${node.name}`}
            >
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{node.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {node.directProductCount > 0
                  ? `${node.directProductCount} product${node.directProductCount === 1 ? "" : "s"} will fall back to uncategorised — they are not deleted, but they will vanish from category pages until you reassign them. `
                  : "No products point at this category. "}
                {node.children.length > 0
                  ? `Its ${node.children.length} sub-categor${node.children.length === 1 ? "y" : "ies"} will be promoted to the top level. `
                  : ""}
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
              <AlertDialogAction size="sm" variant="destructive" onClick={remove}>
                Delete category
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewCategoryPanel({
  parents,
}: {
  parents: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [parentId, setParentId] = React.useState(NONE);
  const [position, setPosition] = React.useState("0");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const effectiveSlug = slugTouched ? slug : slugify(name);

  function create() {
    startTransition(async () => {
      const result = await upsertCategory({
        name,
        slug: effectiveSlug,
        parentId: parentId === NONE ? null : parentId,
        position: Number(position) || 0,
        isActive: true,
        isFeatured: false,
      });

      if (result.ok) {
        setErrors({});
        setName("");
        setSlug("");
        setSlugTouched(false);
        toast.success(result.message ?? "Created.");
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  return (
    <Panel title="Add a category" bodyClassName="space-y-3 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="new-category-name" className="text-xs">
          Name
        </Label>
        <Input
          id="new-category-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Sling bags"
          maxLength={80}
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name ? (
          <p className="text-destructive text-[11px]">{errors.name}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-category-slug" className="text-xs">
          Slug
        </Label>
        <Input
          id="new-category-slug"
          value={effectiveSlug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value);
          }}
          className="font-mono text-xs"
          aria-invalid={Boolean(errors.slug)}
        />
        {errors.slug ? (
          <p className="text-destructive text-[11px]">{errors.slug}</p>
        ) : (
          <p className="text-muted-foreground text-[11px]">
            Generated from the name until you edit it.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Parent</Label>
        <Select value={parentId} onValueChange={setParentId}>
          <SelectTrigger className="w-full" aria-label="Parent category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Top level</SelectItem>
            {parents.map((parent) => (
              <SelectItem key={parent.id} value={parent.id}>
                {parent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.parentId ? (
          <p className="text-destructive text-[11px]">{errors.parentId}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-category-position" className="text-xs">
          Position
        </Label>
        <Input
          id="new-category-position"
          value={position}
          onChange={(event) => setPosition(event.target.value)}
          inputMode="numeric"
          className="tabular"
        />
      </div>

      <Button
        type="button"
        size="sm"
        className="w-full"
        onClick={create}
        disabled={pending || name.trim().length < 2}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Plus />}
        Create category
      </Button>

      <p className="text-muted-foreground flex items-start gap-1.5 text-[11px]">
        <Info className="mt-px size-3 shrink-0" />
        New categories start active and unfeatured. Assign products to them from
        each product&rsquo;s editor.
      </p>
    </Panel>
  );
}
