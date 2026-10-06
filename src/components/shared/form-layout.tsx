import { cn } from "cn";

import { Label } from "@/components/ui/label";

/**
 * Form layout primitives. Server-compatible: nothing here holds state.
 *
 * A long edit form (a product has ~40 fields) is readable only if it is cut
 * into named sections with the explanation beside the fields rather than
 * above them. FormSection puts the title and one paragraph of "why" in a left
 * column on large screens and stacks them on small ones.
 *
 * @example
 *   <FormSection title="Pricing" description="Prices are in rupees; the sale window is IST.">
 *     <FormRow label="Price" htmlFor="price" required error={errors.pricePaise}>
 *       <MoneyInput id="price" name="pricePaise" />
 *     </FormRow>
 *   </FormSection>
 */
export function FormSection({
  title,
  description,
  children,
  actions,
  className,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Small controls that belong to the section header (a toggle, a link). */
  actions?: React.ReactNode;
  className?: string;
  /** Anchor target for SectionNav. */
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "surface grid gap-4 p-4 scroll-mt-20 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8",
        className,
      )}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {actions ? <div className="lg:hidden">{actions}</div> : null}
        </div>
        {description ? (
          <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
        ) : null}
        {actions ? <div className="hidden pt-2 lg:block">{actions}</div> : null}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

/**
 * Label, control, hint and error stacked in that order, with the error
 * replacing the hint so the row never grows when validation fails.
 */
export function FormRow({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  inline = false,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  /** Label and control side by side: for switches and checkboxes. */
  inline?: boolean;
  className?: string;
}) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;

  if (inline) {
    return (
      <div className={cn("flex items-start justify-between gap-4", className)}>
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={htmlFor} className="text-xs">
            {label}
            {required ? <RequiredMark /> : null}
          </Label>
          {error ? (
            <FieldError id={errorId}>{error}</FieldError>
          ) : hint ? (
            <FieldHint id={hintId}>{hint}</FieldHint>
          ) : null}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      {children}
      {error ? (
        <FieldError id={errorId}>{error}</FieldError>
      ) : hint ? (
        <FieldHint id={hintId}>{hint}</FieldHint>
      ) : null}
    </div>
  );
}

/** Two or three FormRows on one line at sm and up. */
export function FormRowGroup({
  children,
  columns = 2,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

function RequiredMark() {
  return (
    <span className="text-destructive -ml-1" aria-hidden>
      *
    </span>
  );
}

export function FieldError({
  children,
  id,
  className,
}: {
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className={cn("text-destructive text-[11px] leading-relaxed", className)}>
      {children}
    </p>
  );
}

export function FieldHint({
  children,
  id,
  className,
}: {
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <p id={id} className={cn("text-muted-foreground text-[11px] leading-relaxed", className)}>
      {children}
    </p>
  );
}
