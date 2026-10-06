"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FormRow } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";

import { importCategoryTreeAction } from "../actions";
import { NAV_MAX_LEVELS } from "../schemas";

/**
 * "Import category tree": the fastest path from a seeded catalogue to a real
 * main menu. Picking roots and a depth creates nested CATEGORY items in one
 * transaction; categories already linked in this menu are skipped, so running
 * it twice is safe and only adds what is new.
 */

export type CategoryRootOption = { id: string; name: string; path: string; depth: number; childCount: number };

export function ImportCategoriesDialog({
  open,
  onOpenChange,
  menuId,
  menuName,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menuId: string;
  menuName: string;
  categories: CategoryRootOption[];
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [levels, setLevels] = React.useState("2");
  const [includeInactive, setIncludeInactive] = React.useState(false);

  const roots = categories.filter((category) => category.depth === 0);

  async function submit() {
    const result = await run(() =>
      importCategoryTreeAction({ menuId, parentId: null, categoryIds: selected, levels: Number(levels), includeInactive }),
    );
    if (result.ok) {
      setSelected([]);
      onOpenChange(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import categories into {menuName}</DialogTitle>
          <DialogDescription>
            Each chosen category becomes a link, with its children nested underneath. Categories already linked in this menu are skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormRow label="Top-level categories" hint={`Up to 20 at a time. ${selected.length} selected.`}>
            {roots.length === 0 ? (
              <p className="text-muted-foreground text-xs">No categories exist yet.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                {roots.map((category) => {
                  const checked = selected.includes(category.id);
                  return (
                    <li key={category.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`import-${category.id}`}
                        checked={checked}
                        disabled={pending || (!checked && selected.length >= 20)}
                        onCheckedChange={(value) =>
                          setSelected((current) => (value === true ? [...current, category.id] : current.filter((id) => id !== category.id)))
                        }
                      />
                      <label htmlFor={`import-${category.id}`} className="min-w-0 flex-1 cursor-pointer truncate text-sm">
                        {category.name}
                        <span className="text-muted-foreground ml-2 text-[11px]">
                          {category.childCount > 0 ? `${category.childCount} sub-categories` : "no sub-categories"}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </FormRow>

          <FormRow label="Levels to import" htmlFor="import-levels" hint={`1 = only the chosen categories. Menus go ${NAV_MAX_LEVELS} levels deep.`}>
            <Select value={levels} onValueChange={setLevels} disabled={pending}>
              <SelectTrigger id="import-levels" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: NAV_MAX_LEVELS }, (_, index) => String(index + 1)).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value} level{value === "1" ? "" : "s"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow label="Include disabled categories" htmlFor="import-inactive" inline hint="They arrive as hidden links you can switch on later.">
            <Switch id="import-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} disabled={pending} />
          </FormRow>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || selected.length === 0}>
            Import {selected.length > 0 ? `${selected.length} categor${selected.length === 1 ? "y" : "ies"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
