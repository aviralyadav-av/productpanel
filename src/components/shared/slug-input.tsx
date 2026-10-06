"use client";

import * as React from "react";
import { Link2, Lock, RefreshCw } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidSlug, slugify } from "./slug";

/**
 * Follows the title until the operator edits it, then stops.
 *
 * On a new record the slug should just appear as the title is typed. On a
 * published record it must NOT change when the title does, because the URL is
 * already indexed and linked - so pass `locked` for existing records and the
 * input becomes read-only with an explicit "regenerate" affordance instead.
 *
 * The component is controlled: the parent owns `value`, and this reports
 * both the auto-derived and hand-edited values through `onChange`.
 *
 * @example
 *   <SlugInput sourceValue={title} value={slug} onChange={setSlug} locked={!!product.publishedAt} prefix="/products/" />
 */
export function SlugInput({
  sourceValue,
  value,
  onChange,
  locked = false,
  prefix,
  name,
  id,
  disabled,
  invalid,
  className,
}: {
  sourceValue: string;
  value: string;
  onChange: (slug: string) => void;
  locked?: boolean;
  /** Shown before the slug, e.g. "/products/". */
  prefix?: string;
  name?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const [touched, setTouched] = React.useState(false);
  const [unlocked, setUnlocked] = React.useState(false);
  const readOnly = locked && !unlocked;

  // Derive from the title until edited. Done in an effect rather than during
  // render because the parent owns `value`; the guard makes it idempotent.
  const derived = slugify(sourceValue);
  React.useEffect(() => {
    if (touched || locked) return;
    if (derived !== value) onChange(derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-derive when the source changes
  }, [derived, touched, locked]);

  const showInvalid = invalid || (value.length > 0 && !isValidSlug(value));

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="relative min-w-0 flex-1">
        {prefix ? (
          <span
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-[11px]"
          >
            {prefix}
          </span>
        ) : (
          <Link2
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
        )}
        <Input
          id={id}
          name={name}
          value={value}
          readOnly={readOnly}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={showInvalid || undefined}
          className={cn(
            "h-8 font-mono text-xs",
            readOnly && "text-muted-foreground",
          )}
          style={prefix ? { paddingLeft: `${prefix.length * 0.62 + 1.1}rem` } : { paddingLeft: "1.9rem" }}
          onChange={(event) => {
            setTouched(true);
            // Normalise as they type but keep a trailing hyphen so "my-" can
            // become "my-slug"; strip it on blur.
            const raw = event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-");
            onChange(raw.slice(0, 80));
          }}
          onBlur={() => onChange(slugify(value))}
        />
      </div>
      {locked ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={unlocked ? "Lock slug" : "Edit slug (changes the public URL)"}
          title={unlocked ? "Lock slug" : "Edit slug (changes the public URL)"}
          onClick={() => {
            setUnlocked((current) => !current);
            setTouched(true);
          }}
        >
          <Lock className={cn(unlocked && "text-warning")} />
        </Button>
      ) : touched ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Regenerate slug from title"
          title="Regenerate from title"
          onClick={() => {
            setTouched(false);
            onChange(derived);
          }}
        >
          <RefreshCw />
        </Button>
      ) : null}
    </div>
  );
}
