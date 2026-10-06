"use client";

import * as React from "react";
import { cn } from "cn";

export type SectionNavItem = { id: string; label: string; count?: number };

/**
 * In-page anchor tabs for long forms and detail pages: "Basics / Pricing /
 * Inventory / SEO". Highlights the section currently in view (IntersectionObserver)
 * and scrolls smoothly on click. Sticks under the page header on desktop.
 *
 * Give each FormSection the matching `id`.
 */
export function SectionNav({
  items,
  className,
  orientation = "horizontal",
  offsetPx = 80,
}: {
  items: SectionNavItem[];
  className?: string;
  orientation?: "horizontal" | "vertical";
  /** Sticky header height, so the active section is the one under it. */
  offsetPx?: number;
}) {
  const [active, setActive] = React.useState(items[0]?.id ?? "");

  React.useEffect(() => {
    const elements = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The topmost visible section wins; falling back to the last one that
        // scrolled past keeps the highlight stable at the bottom of the page.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: `-${offsetPx}px 0px -60% 0px`, threshold: 0 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [items, offsetPx]);

  function go(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    const element = document.getElementById(id);
    if (!element) return;
    event.preventDefault();
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  }

  return (
    <nav
      aria-label="Sections"
      className={cn(
        orientation === "horizontal"
          ? // top-12 sits under the 48px shell header; top-0 slid behind it.
            "bg-background/95 no-scrollbar sticky top-12 z-10 -mx-4 flex gap-1 overflow-x-auto border-b px-4 py-1.5 backdrop-blur sm:mx-0 sm:rounded-lg sm:border"
          : "flex flex-col gap-0.5",
        className,
      )}
    >
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={isActive ? "location" : undefined}
            onClick={(event) => go(event, item.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {typeof item.count === "number" ? (
              <span data-numeric className="text-muted-foreground text-[10px]">
                {item.count}
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}
