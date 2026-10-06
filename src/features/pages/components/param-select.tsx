"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryNav } from "@/hooks/use-query-nav";

/**
 * A filter select that writes to one URL parameter (§8: list state lives in
 * the URL). Choosing the "all" entry removes the parameter. Used for the
 * template / category / author filters beside the status FilterTabs, where a
 * tab strip would be too wide.
 */
export function ParamSelect({
  paramKey,
  options,
  allLabel,
  ariaLabel,
  className,
}: {
  paramKey: string;
  options: Array<{ value: string; label: string; count?: number }>;
  allLabel: string;
  ariaLabel?: string;
  className?: string;
}) {
  const { navigate, searchParams } = useQueryNav();
  const ALL = "__all__";
  const current = searchParams.get(paramKey) ?? ALL;

  return (
    <Select value={options.some((option) => option.value === current) ? current : ALL} onValueChange={(value) => navigate({ [paramKey]: value === ALL ? null : value })}>
      <SelectTrigger size="sm" aria-label={ariaLabel ?? allLabel} className={className ?? "w-40"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
            {typeof option.count === "number" ? <span className="text-muted-foreground ml-1 text-[10px]">{option.count}</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
