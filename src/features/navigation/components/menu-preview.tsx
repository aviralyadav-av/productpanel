import { AlertTriangle } from "lucide-react";

import type { PublicMenu, PublicNavItem } from "@/lib/serializers/public";

/**
 * "What the website receives": the exact payload of
 * `GET /api/v1/navigation/<slug>`, produced by the same query the public route
 * uses. Hidden items are already gone here, which is the point - an operator
 * who switched something off can see it disappear from the contract instead of
 * trusting that it did.
 */

function ItemRow({ item, depth }: { item: PublicNavItem; depth: number }) {
  return (
    <li>
      <div className="flex items-start gap-2 py-0.5" style={{ paddingLeft: depth * 12 }}>
        <span className="min-w-0 flex-1 truncate text-xs">
          {item.label}
          {item.badgeText ? <span className="text-brand ml-1 text-[10px]">{item.badgeText}</span> : null}
          {item.isMegaMenu ? <span className="text-muted-foreground ml-1 text-[10px]">mega</span> : null}
        </span>
        <code className="text-muted-foreground max-w-[10rem] truncate font-mono text-[10px]">{item.url ?? "—"}</code>
        {!item.isAvailable ? <AlertTriangle className="text-warning size-3 shrink-0" /> : null}
      </div>
      {item.children.length > 0 ? (
        <ul>
          {item.children.map((child) => (
            <ItemRow key={child.id} item={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function countItems(items: readonly PublicNavItem[]): number {
  return items.reduce((total, item) => total + 1 + countItems(item.children), 0);
}

export function MenuPreview({ menu, slug }: { menu: PublicMenu | null; slug: string }) {
  return (
    <div className="surface space-y-2 p-3">
      <div>
        <p className="text-sm font-medium">Public payload</p>
        <p className="text-muted-foreground text-[11px]">
          <code className="font-mono">GET /api/v1/navigation/{slug}</code> — visible items only, in this order.
        </p>
      </div>
      {!menu ? (
        <p className="text-muted-foreground text-xs">No menu exists at that slug yet.</p>
      ) : menu.items.length === 0 ? (
        <p className="text-muted-foreground text-xs">The website would receive an empty menu.</p>
      ) : (
        <>
          <ul className="rounded-md border p-2">
            {menu.items.map((item) => (
              <ItemRow key={item.id} item={item} depth={0} />
            ))}
          </ul>
          <p className="text-muted-foreground text-[11px]" data-numeric>
            {countItems(menu.items)} item{countItems(menu.items) === 1 ? "" : "s"} · changes appear after the public cache refreshes (about a minute).
          </p>
        </>
      )}
    </div>
  );
}
