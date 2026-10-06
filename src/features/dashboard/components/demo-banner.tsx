import { FlaskConical } from "lucide-react";

/**
 * Shown while the seeded demo catalogue is still in the database.
 *
 * Every seeded demo row's id starts with `demo_` (the seed contract), so the
 * banner is driven by a fact about the data rather than a settings flag
 * someone can edit into a lie. It matters because every number above it -
 * revenue, orders, top sellers - is computed from those rows, and an operator
 * looking at their first real week must be able to tell the two apart.
 */
export function DemoDataBanner() {
  return (
    <div className="border-warning/30 bg-warning-muted/50 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs">
      <FlaskConical className="text-warning size-3.5 shrink-0" />
      <span className="font-medium">Demo data is present.</span>
      <span className="text-muted-foreground">
        Orders, customers, sellers and products whose id starts with{" "}
        <code className="bg-background/60 rounded border px-1 py-0.5 font-mono text-[11px]">demo_</code> were
        created by the seed and are included in every figure on this page. To remove them, set{" "}
        <code className="bg-background/60 rounded border px-1 py-0.5 font-mono text-[11px]">
          SEED_DEMO_DATA=false
        </code>{" "}
        in <code className="font-mono text-[11px]">.env</code> and reseed.
      </span>
      <code className="bg-background/60 ml-auto rounded border px-1.5 py-0.5 font-mono text-[11px]">
        npm run db:reset
      </code>
    </div>
  );
}
