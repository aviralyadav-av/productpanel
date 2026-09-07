"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { ProductThumb } from "@/components/shared/product-thumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { ActionResult } from "@/lib/action-result";
import {
  formValuesToPayload,
  payloadToFormValues,
  type FieldDescriptor,
  type FormValues,
} from "../registry";

/**
 * The generic content editor plus the two pieces of plumbing every tab on this
 * page needs.
 *
 * There is deliberately no form library here. The whole page is a set of small
 * server-validated mutations, so the client's job is to collect strings, hand
 * them to a Server Action, and render the field errors that come back. A
 * resolver stack would duplicate the Zod schemas that already exist in
 * registry.ts and schemas.ts.
 */

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

/**
 * Runs a Server Action inside a transition and turns its ActionResult into a
 * toast. Every mutation on this page goes through it, so success and failure
 * are reported the same way everywhere.
 */
export function useActionToast() {
  const [pending, startTransition] = React.useTransition();

  const run = React.useCallback(
    (
      action: () => Promise<ActionResult<unknown>>,
      options?: { onSuccess?: () => void },
    ) => {
      startTransition(async () => {
        const result = await action();
        if (result.ok) {
          if (result.message) toast.success(result.message);
          options?.onSuccess?.();
        } else {
          toast.error(result.error);
        }
      });
    },
    [],
  );

  return { pending, run };
}

/**
 * Move up / move down rather than drag and drop.
 *
 * @dnd-kit is available, but these lists are short, they live inside
 * collapsible rows and sheets, and every reorder is a server round trip.
 * Two buttons are keyboard accessible for free, work on a tablet, and cannot
 * drop a row into the wrong section.
 */
export function MoveButtons({
  onUp,
  onDown,
  canMoveUp,
  canMoveDown,
  disabled,
  label,
}: {
  onUp: () => void;
  onDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled || !canMoveUp}
        onClick={onUp}
        aria-label={`Move ${label} up`}
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled || !canMoveDown}
        onClick={onDown}
        aria-label={`Move ${label} down`}
      >
        <ArrowDown />
      </Button>
    </div>
  );
}

/** Reorders a list of ids by moving one entry one slot up or down. */
export function moveInList<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---------------------------------------------------------------------------
// Field rendering
// ---------------------------------------------------------------------------

function errorFor(
  errors: Record<string, string>,
  name: string,
): string | undefined {
  if (errors[name]) return errors[name];
  // Array fields report as "stats.0.value"; surface that on the parent field.
  const nested = Object.entries(errors).find(([key]) =>
    key.startsWith(`${name}.`),
  );
  return nested?.[1];
}

export function FieldControl({
  field,
  value,
  onChange,
  error,
  disabled,
}: {
  field: FieldDescriptor;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = `field-${field.name}`;
  const stringValue = typeof value === "string" ? value : "";

  if (field.type === "boolean") {
    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={id} className="text-xs">
            {field.label}
          </Label>
          {field.helpText ? (
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {field.helpText}
            </p>
          ) : null}
        </div>
        <Switch
          id={id}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {field.label}
          {field.required ? (
            <span className="text-destructive ml-0.5" aria-hidden>
              *
            </span>
          ) : null}
        </Label>
        {field.type === "number" ? (
          <span className="text-muted-foreground text-[11px]">seconds / count</span>
        ) : null}
      </div>

      {field.options ? (
        <Select
          value={stringValue || field.options[0]}
          disabled={disabled}
          onValueChange={onChange}
        >
          <SelectTrigger id={id} className="w-full" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "textarea" ? (
        <Textarea
          id={id}
          rows={field.rows ?? 3}
          value={stringValue}
          disabled={disabled}
          placeholder={field.placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="text-xs"
        />
      ) : (
        <div className={cn(field.type === "image" && "flex items-start gap-2")}>
          {field.type === "image" ? (
            <ProductThumb src={stringValue} alt={field.label} size={44} />
          ) : null}
          <Input
            id={id}
            type={field.type === "number" ? "number" : "text"}
            inputMode={field.type === "number" ? "numeric" : undefined}
            value={stringValue}
            disabled={disabled}
            placeholder={field.placeholder}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange(event.target.value)}
            className={cn("h-8 text-xs", field.type === "image" && "flex-1")}
          />
        </div>
      )}

      {error ? (
        <p className="text-destructive text-[11px]">{error}</p>
      ) : field.helpText ? (
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          {field.helpText}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The editor sheet
// ---------------------------------------------------------------------------

/**
 * One sheet renders every section and every block in the registry. Adding a
 * section type adds fields to registry.ts and nothing here changes.
 */
export function PayloadEditorSheet({
  open,
  onOpenChange,
  title,
  description,
  fields,
  payload,
  onSave,
  emptyNote,
  footerNote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FieldDescriptor[];
  payload: Record<string, unknown>;
  onSave: (values: Record<string, unknown>) => Promise<ActionResult<unknown>>;
  emptyNote?: string;
  footerNote?: string;
}) {
  const [values, setValues] = React.useState<FormValues>(() =>
    payloadToFormValues(fields, payload),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useActionToast();

  // Re-seeded only when the sheet opens. Reacting to `payload` as well would
  // let a background revalidation wipe what the operator is typing.
  React.useEffect(() => {
    if (!open) return;
    setValues(payloadToFormValues(fields, payload));
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSave() {
    setErrors({});
    const next = formValuesToPayload(fields, values);

    run(async () => {
      const result = await onSave(next);
      if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
      if (result.ok) onOpenChange(false);
      return result;
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="text-sm">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="text-xs">
              {description}
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-1">
          {fields.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs leading-relaxed">
              {emptyNote ?? "This section has no settings of its own."}
            </p>
          ) : (
            fields.map((field) => (
              <FieldControl
                key={field.name}
                field={field}
                value={values[field.name] ?? ""}
                disabled={pending}
                error={errorFor(errors, field.name)}
                onChange={(value) =>
                  setValues((current) => ({ ...current, [field.name]: value }))
                }
              />
            ))
          )}
        </div>

        <SheetFooter className="border-t">
          {footerNote ? (
            <p className="text-muted-foreground mb-1 text-[11px] leading-relaxed">
              {footerNote}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || fields.length === 0}
              onClick={handleSave}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save changes
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
