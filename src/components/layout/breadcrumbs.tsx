"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { activeNavItem, findNavGroup, findNavItem, splitHref } from "@/config/nav";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/**
 * Breadcrumbs from the nav registry: Group › Item › Details.
 *
 * The registry supplies the first two crumbs so they match the sidebar
 * exactly. Segments beyond the item's path are labelled by a small table
 * ("new" → "New") or, for ids, "Details" - a cuid in a breadcrumb tells the
 * operator nothing, and the page header underneath carries the real name.
 *
 * Query-string variants ("Pending" under Orders) appear as the last crumb
 * when active so the trail reads Orders › All Orders › Pending.
 */

const SEGMENT_LABELS: Record<string, string> = {
  new: "New",
  invoice: "Invoice",
  categories: "Categories",
  password: "Password",
  security: "Security",
  sessions: "Sessions",
};

const ACCOUNT_ROOT: Record<string, string> = {
  account: "My account",
  search: "Search",
};

function labelFor(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  // Ids (cuid, uuid, numbers) are long and opaque; report names would be
  // short words. Anything over 16 chars with no spaces is treated as an id.
  if (segment.length > 16 && !segment.includes(" ")) return "Details";
  return decodeURIComponent(segment)
    .replace(/[-_]+/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase());
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const item = findNavItem(pathname);
  const group = item ? findNavGroup(item) : undefined;
  const active = activeNavItem(pathname, searchParams);
  const variant = active && active !== item ? active : undefined;

  // Routes outside the registry (/admin/account/*, /admin/search) root at
  // their first segment; registry routes root at the owning item's path.
  const firstSegment = pathname.split("/").filter(Boolean)[1];
  const basePath = item ? splitHref(item.href).path : `/admin/${firstSegment ?? ""}`;
  const rest = pathname
    .slice(basePath.length)
    .split("/")
    .filter(Boolean);

  const crumbs: { label: string; href?: string }[] = [];

  if (item && group) {
    if (!group.standalone) crumbs.push({ label: group.title });
    crumbs.push({ label: item.title, href: splitHref(item.href).path });
  } else if (firstSegment) {
    crumbs.push({ label: ACCOUNT_ROOT[firstSegment] ?? labelFor(firstSegment), href: basePath });
  }

  rest.forEach((segment, index) => {
    crumbs.push({
      label: labelFor(segment),
      href: `${basePath}/${rest.slice(0, index + 1).join("/")}`,
    });
  });

  if (variant) crumbs.push({ label: variant.title, href: variant.href });

  if (crumbs.length === 0) return null;

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          const isGroup = index === 0 && !crumb.href;
          return (
            <span key={`${crumb.label}-${index}`} className="contents">
              {index > 0 ? (
                <BreadcrumbSeparator className={isGroup || index === 1 ? "hidden md:inline-flex" : undefined} />
              ) : null}
              <BreadcrumbItem className={isGroup ? "hidden min-w-0 md:inline-flex" : "min-w-0"}>
                {isLast ? (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                ) : crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href as never} className="truncate">
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <span className="text-muted-foreground truncate">{crumb.label}</span>
                )}
              </BreadcrumbItem>
            </span>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
