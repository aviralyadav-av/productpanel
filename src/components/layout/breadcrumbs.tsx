"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ALL_NAV_ITEMS, NAV_GROUPS } from "@/config/nav";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

function labelFor(segment: string): string {
  return segment
    .replace(/-/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase());
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  const rootHref = `/${segments[0]}`;
  const navItem = ALL_NAV_ITEMS.find((item) => item.href === rootHref);
  const group = NAV_GROUPS.find((candidate) =>
    candidate.items.some((item) => item.href === rootHref),
  );

  const rest = segments.slice(1);

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {group && rest.length > 0 ? (
          <>
            <BreadcrumbItem className="hidden md:inline-flex">
              <span className="text-muted-foreground">{group.title}</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:inline-flex" />
          </>
        ) : null}

        <BreadcrumbItem className="min-w-0">
          {rest.length === 0 ? (
            <BreadcrumbPage className="truncate">
              {navItem?.title ?? labelFor(segments[0])}
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link href={rootHref as never} className="truncate">
                {navItem?.title ?? labelFor(segments[0])}
              </Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {rest.map((segment, index) => {
          const isLast = index === rest.length - 1;
          const href = `/${segments.slice(0, index + 2).join("/")}`;
          // Ids are long and meaningless in a breadcrumb; the page header
          // carries the real name, so show a short marker instead.
          const isId = segment.length > 16 && !segment.includes(" ");
          const label = isId ? "Details" : labelFor(segment);

          return (
            <span key={href} className="contents">
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                {isLast ? (
                  <BreadcrumbPage className="truncate">{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={href as never} className="truncate">
                      {label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
