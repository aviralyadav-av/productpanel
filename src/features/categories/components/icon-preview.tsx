"use client";

import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { cn } from "cn";

/**
 * `Category.iconName` is either a lucide icon in kebab-case ("shopping-bag")
 * or an emoji. The storefront resolves it the same way, so the operator sees
 * exactly what the website will render - or a dashed placeholder when the
 * name does not resolve, which is the cue to fix the typo.
 *
 * DynamicIcon loads one icon chunk on demand rather than shipping the whole
 * lucide set to the browser.
 */
const NAME_SET = new Set<string>(iconNames);

export function isLucideIconName(value: string | null | undefined): value is IconName {
  return Boolean(value) && NAME_SET.has(value as string);
}

/** Anything that is not a lucide name and has a non-ASCII glyph is treated as an emoji. */
function looksLikeEmoji(value: string): boolean {
  return /\p{Extended_Pictographic}/u.test(value);
}

export function CategoryIconPreview({
  iconName,
  size = 16,
  className,
}: {
  iconName: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const trimmed = iconName?.trim() ?? "";
  if (!trimmed) return null;
  if (isLucideIconName(trimmed)) {
    return <DynamicIcon name={trimmed} size={size} className={cn("shrink-0", className)} aria-hidden />;
  }
  if (looksLikeEmoji(trimmed)) {
    return (
      <span aria-hidden className={cn("shrink-0 leading-none", className)} style={{ fontSize: size }}>
        {trimmed}
      </span>
    );
  }
  return (
    <span
      aria-label={`Unknown icon "${trimmed}"`}
      title={`"${trimmed}" is not a lucide icon name`}
      className={cn("border-muted-foreground/40 text-muted-foreground inline-block shrink-0 rounded border border-dashed", className)}
      style={{ width: size, height: size }}
    />
  );
}
