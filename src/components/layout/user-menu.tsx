"use client";

import * as React from "react";
import Link from "next/link";
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck, User } from "lucide-react";

import { signOutAction } from "@/features/account/auth-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LINKS = [
  { href: "/admin/account", label: "My account", icon: User },
  { href: "/admin/account/password", label: "Change password", icon: KeyRound },
  { href: "/admin/account/security", label: "Two-factor security", icon: ShieldCheck },
  { href: "/admin/account/sessions", label: "Signed-in devices", icon: MonitorSmartphone },
] as const;

export function UserMenu({
  name,
  email,
  roleName,
  twoFactorEnabled,
}: {
  name: string | null;
  email: string;
  roleName: string | null;
  twoFactorEnabled: boolean;
}) {
  const signOutFormRef = React.useRef<HTMLFormElement>(null);

  const initials = (name ?? email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Account menu"
          className="bg-muted text-foreground rounded-full text-[11px] font-semibold"
        >
          {initials || <User className="size-4" />}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{name ?? "Admin"}</p>
          <p className="text-muted-foreground truncate text-xs">{email}</p>
          <p className="text-muted-foreground mt-1 truncate text-[11px]">
            {roleName ?? "No role"} · 2FA {twoFactorEnabled ? "on" : "off"}
          </p>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          {LINKS.map((link) => (
            <DropdownMenuItem key={link.href} asChild>
              <Link href={link.href} className="gap-2">
                <link.icon className="size-4" />
                {link.label}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/*
          * Sign out submits a form that lives OUTSIDE the menu.
          *
          * Radix closes the menu when an item is selected, which unmounts
          * everything inside DropdownMenuContent. A <form> rendered in here is
          * torn out of the DOM in the same tick as the click, so the submit
          * never reaches the server action and the operator stays signed in.
          * Selecting the item calls requestSubmit() on a form that is not part
          * of the menu, so the closing menu cannot cancel it.
          */}
        <DropdownMenuItem
          className="text-destructive focus:text-destructive gap-2"
          onSelect={(event) => {
            event.preventDefault();
            signOutFormRef.current?.requestSubmit();
          }}
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>

      <form ref={signOutFormRef} action={signOutAction} className="hidden" />
    </DropdownMenu>
  );
}
