import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

/**
 * The centred card every signed-out screen uses - login, forgot / reset
 * password, the two-factor challenge and the "no access" landing - so they
 * read as one product rather than five hand-laid pages.
 */
export function AuthShell({
  storeName,
  title,
  description,
  icon: Icon,
  children,
  footer,
  className,
}: {
  storeName: string;
  title: string;
  description?: React.ReactNode;
  icon?: LucideIcon;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <main className="bg-background flex min-h-svh items-center justify-center p-6">
      <div className={cn("w-full max-w-sm", className)}>
        <div className="mb-8 flex items-center gap-2.5">
          <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md text-sm font-semibold">
            {storeName.trim().charAt(0).toUpperCase() || "D"}
          </div>
          <div>
            <p className="text-sm leading-tight font-semibold">{storeName}</p>
            <p className="text-muted-foreground text-xs leading-tight">Admin panel</p>
          </div>
        </div>

        <div className="surface p-6">
          <div className="mb-5 space-y-1">
            <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              {Icon ? <Icon className="text-muted-foreground size-4" /> : null}
              {title}
            </h1>
            {description ? (
              <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
            ) : null}
          </div>

          {children}
        </div>

        {footer ? <div className="mt-4">{footer}</div> : null}
      </div>
    </main>
  );
}
