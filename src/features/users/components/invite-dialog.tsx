"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormRow } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";

import { inviteUserAction } from "@/features/users/actions";
import type { RoleOption } from "@/features/users/schemas";

/**
 * "Invite user": name, email, role.
 *
 * There is no password field, and there never will be - D3 says an admin
 * never sets another admin's password. The account is created with an
 * unusable one and the invite email carries the only way in.
 *
 * The role list is filtered by the SERVER to what this actor may assign
 * (subset rule); roles they may not assign are shown disabled with the reason
 * rather than hidden, so the rule is visible instead of mysterious.
 */
export function InviteUserDialog({ roles }: { roles: RoleOption[] }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [roleId, setRoleId] = React.useState<string>(
    () => roles.find((role) => role.assignable && !role.isSystem)?.id ?? roles.find((role) => role.assignable)?.id ?? "",
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await run(
      () => inviteUserAction({ name, email, phone, roleId }),
      {
        onSuccess: () => {
          setOpen(false);
          setName("");
          setEmail("");
          setPhone("");
          setErrors({});
          router.refresh();
        },
      },
    );
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  const selected = roles.find((role) => role.id === roleId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-3.5" />
          Invite user
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Invite an admin user</DialogTitle>
            <DialogDescription>
              They receive a link that expires in 48 hours and choose their own password. You can
              never set it for them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <FormRow label="Name" htmlFor="invite-name" required error={errors.name}>
              <Input
                id="invite-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                required
              />
            </FormRow>

            <FormRow label="Email" htmlFor="invite-email" required error={errors.email}>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="off"
                required
              />
            </FormRow>

            <FormRow
              label="Phone"
              htmlFor="invite-phone"
              hint="Optional. Used only inside the admin."
              error={errors.phone}
            >
              <Input
                id="invite-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                autoComplete="off"
                placeholder="+91…"
              />
            </FormRow>

            <FormRow
              label="Role"
              hint={selected?.reason ?? "Decides everything they can see and do."}
              error={errors.roleId}
            >
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger aria-label="Role" className="w-full">
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id} disabled={!role.assignable}>
                      {role.name}
                      <span className="text-muted-foreground ml-1 text-[10px]">
                        {role.assignable ? `${role.permissionCount} permissions` : "not assignable"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !roleId}>
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
