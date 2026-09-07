"use client";

import * as React from "react";
import { Loader2, PanelBottom, Plus, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateFooterConfig } from "../actions";
import type { FooterRow } from "../queries";
import { MoveButtons, moveInList, useActionToast } from "./section-editor";

/**
 * The single FooterConfig row.
 *
 * Its three link arrays are jsonb, so the whole form saves as one document
 * rather than one action per row. Validation of every path happens server side
 * (schemas.ts) and comes back keyed by path - "sections.1.links.0.path" - which
 * is how an error lands on the exact input that caused it.
 */
export function FooterTab({ footer }: { footer: FooterRow | null }) {
  if (!footer) {
    return (
      <EmptyState
        icon={PanelBottom}
        title="No footer configuration"
        description="FooterConfig has no row. Run npm run db:seed to import the storefront's footer.json."
      />
    );
  }

  return <FooterForm key={footer.updatedAt.toISOString()} footer={footer} />;
}

// ---------------------------------------------------------------------------

type LinkItem = { id: string | number; label: string; path: string };
type SocialItem = { id: string | number; platform: string; url: string };
type SectionItem = { id: string | number; title: string; links: LinkItem[] };

let idCounter = 0;
/** New rows only. Seeded ids are numbers and are never rewritten. */
function makeId(): string {
  idCounter += 1;
  return `n${Date.now().toString(36)}${idCounter}`;
}

function FooterForm({ footer }: { footer: FooterRow }) {
  const [brandName, setBrandName] = React.useState(footer.brandName);
  const [brandDescription, setBrandDescription] = React.useState(
    footer.brandDescription,
  );
  const [copyright, setCopyright] = React.useState(footer.copyright);
  const [socialLinks, setSocialLinks] = React.useState<SocialItem[]>(
    footer.socialLinks,
  );
  const [sections, setSections] = React.useState<SectionItem[]>(
    footer.sections,
  );
  const [legalLinks, setLegalLinks] = React.useState<LinkItem[]>(
    footer.legalLinks,
  );
  const [service, setService] = React.useState(footer.customerService);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useActionToast();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    run(async () => {
      const result = await updateFooterConfig({
        brandName,
        brandDescription,
        copyright,
        socialLinks,
        sections,
        legalLinks,
        customerService: service,
      });
      if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
      return result;
    });
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
          Saved to the admin database. The storefront still renders its own
          bundled footer until its API layer is repointed here.
        </p>
        <Button type="submit" size="xs" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save footer
        </Button>
      </div>

      {hasErrors ? (
        <p className="text-destructive border-destructive/30 bg-destructive/5 border-b px-4 py-2 text-xs">
          Some links are not valid. Each one must be an internal path starting
          with /, a full https:// URL, or a mailto: address.
        </p>
      ) : null}

      <div className="divide-y">
        {/* Brand ---------------------------------------------------------- */}
        <Block title="Brand" description="Shown in the first footer column.">
          <div className="grid gap-3 lg:grid-cols-2">
            <TextField
              name="brandName"
              label="Brand name"
              value={brandName}
              onChange={setBrandName}
              error={errors.brandName}
            />
            <TextField
              name="copyright"
              label="Copyright line"
              value={copyright}
              onChange={setCopyright}
              error={errors.copyright}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brandDescription" className="text-xs">
              Brand description
            </Label>
            <Textarea
              id="brandDescription"
              rows={3}
              value={brandDescription}
              disabled={pending}
              onChange={(event) => setBrandDescription(event.target.value)}
              className="text-xs"
            />
            {errors.brandDescription ? (
              <p className="text-destructive text-[11px]">
                {errors.brandDescription}
              </p>
            ) : null}
          </div>
        </Block>

        {/* Social --------------------------------------------------------- */}
        <Block
          title="Social links"
          description="Use # for a platform the store has not opened an account on yet."
          action={
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={pending || socialLinks.length >= 10}
              onClick={() =>
                setSocialLinks((current) => [
                  ...current,
                  { id: makeId(), platform: "", url: "#" },
                ])
              }
            >
              <Plus />
              Add
            </Button>
          }
        >
          {socialLinks.length === 0 ? (
            <Hint>No social links.</Hint>
          ) : (
            <ul className="space-y-2">
              {socialLinks.map((item, index) => (
                <li key={String(item.id)} className="flex items-end gap-2">
                  <TextField
                    name={`socialLinks.${index}.platform`}
                    label={index === 0 ? "Platform" : undefined}
                    value={item.platform}
                    onChange={(value) =>
                      setSocialLinks((current) =>
                        current.map((row, i) =>
                          i === index ? { ...row, platform: value } : row,
                        ),
                      )
                    }
                    error={errors[`socialLinks.${index}.platform`]}
                    className="w-44"
                  />
                  <TextField
                    name={`socialLinks.${index}.url`}
                    label={index === 0 ? "URL" : undefined}
                    value={item.url}
                    onChange={(value) =>
                      setSocialLinks((current) =>
                        current.map((row, i) =>
                          i === index ? { ...row, url: value } : row,
                        ),
                      )
                    }
                    error={errors[`socialLinks.${index}.url`]}
                    className="flex-1"
                  />
                  <RowControls
                    label={`social link ${index + 1}`}
                    index={index}
                    length={socialLinks.length}
                    disabled={pending}
                    onMove={(to) =>
                      setSocialLinks((current) =>
                        moveInList(current, index, to),
                      )
                    }
                    onRemove={() =>
                      setSocialLinks((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </Block>

        {/* Link columns --------------------------------------------------- */}
        <Block
          title="Link columns"
          description="Each column becomes one heading with its links underneath."
          action={
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={pending || sections.length >= 6}
              onClick={() =>
                setSections((current) => [
                  ...current,
                  { id: makeId(), title: "", links: [] },
                ])
              }
            >
              <Plus />
              Add column
            </Button>
          }
        >
          {sections.length === 0 ? (
            <Hint>No link columns.</Hint>
          ) : (
            <div className="space-y-3">
              {sections.map((section, sectionIndex) => (
                <div key={String(section.id)} className="surface p-3">
                  <div className="flex items-end gap-2">
                    <TextField
                      name={`sections.${sectionIndex}.title`}
                      label="Column heading"
                      value={section.title}
                      onChange={(value) =>
                        setSections((current) =>
                          current.map((row, i) =>
                            i === sectionIndex ? { ...row, title: value } : row,
                          ),
                        )
                      }
                      error={errors[`sections.${sectionIndex}.title`]}
                      className="flex-1"
                    />
                    <RowControls
                      label={`column ${sectionIndex + 1}`}
                      index={sectionIndex}
                      length={sections.length}
                      disabled={pending}
                      onMove={(to) =>
                        setSections((current) =>
                          moveInList(current, sectionIndex, to),
                        )
                      }
                      onRemove={() =>
                        setSections((current) =>
                          current.filter((_, i) => i !== sectionIndex),
                        )
                      }
                    />
                  </div>

                  <ul className="mt-3 space-y-2 border-t pt-3">
                    {section.links.map((link, linkIndex) => (
                      <li key={String(link.id)} className="flex items-end gap-2">
                        <TextField
                          name={`sections.${sectionIndex}.links.${linkIndex}.label`}
                          label={linkIndex === 0 ? "Label" : undefined}
                          value={link.label}
                          onChange={(value) =>
                            setSections((current) =>
                              current.map((row, i) =>
                                i === sectionIndex
                                  ? {
                                      ...row,
                                      links: row.links.map((entry, j) =>
                                        j === linkIndex
                                          ? { ...entry, label: value }
                                          : entry,
                                      ),
                                    }
                                  : row,
                              ),
                            )
                          }
                          error={
                            errors[
                              `sections.${sectionIndex}.links.${linkIndex}.label`
                            ]
                          }
                          className="w-52"
                        />
                        <TextField
                          name={`sections.${sectionIndex}.links.${linkIndex}.path`}
                          label={linkIndex === 0 ? "Path" : undefined}
                          value={link.path}
                          onChange={(value) =>
                            setSections((current) =>
                              current.map((row, i) =>
                                i === sectionIndex
                                  ? {
                                      ...row,
                                      links: row.links.map((entry, j) =>
                                        j === linkIndex
                                          ? { ...entry, path: value }
                                          : entry,
                                      ),
                                    }
                                  : row,
                              ),
                            )
                          }
                          error={
                            errors[
                              `sections.${sectionIndex}.links.${linkIndex}.path`
                            ]
                          }
                          className="flex-1"
                        />
                        <RowControls
                          label={`link ${linkIndex + 1}`}
                          index={linkIndex}
                          length={section.links.length}
                          disabled={pending}
                          onMove={(to) =>
                            setSections((current) =>
                              current.map((row, i) =>
                                i === sectionIndex
                                  ? {
                                      ...row,
                                      links: moveInList(
                                        row.links,
                                        linkIndex,
                                        to,
                                      ),
                                    }
                                  : row,
                              ),
                            )
                          }
                          onRemove={() =>
                            setSections((current) =>
                              current.map((row, i) =>
                                i === sectionIndex
                                  ? {
                                      ...row,
                                      links: row.links.filter(
                                        (_, j) => j !== linkIndex,
                                      ),
                                    }
                                  : row,
                              ),
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>

                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="mt-2"
                    disabled={pending || section.links.length >= 12}
                    onClick={() =>
                      setSections((current) =>
                        current.map((row, i) =>
                          i === sectionIndex
                            ? {
                                ...row,
                                links: [
                                  ...row.links,
                                  { id: makeId(), label: "", path: "/" },
                                ],
                              }
                            : row,
                        ),
                      )
                    }
                  >
                    <Plus />
                    Add link
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Block>

        {/* Customer service ----------------------------------------------- */}
        <Block
          title="Customer service"
          description="The help block on the right of the footer."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <TextField
              name="customerService.heading"
              label="Heading"
              value={service.heading}
              onChange={(value) =>
                setService((current) => ({ ...current, heading: value }))
              }
              error={errors["customerService.heading"]}
            />
            <TextField
              name="customerService.email"
              label="Support email"
              value={service.email}
              onChange={(value) =>
                setService((current) => ({ ...current, email: value }))
              }
              error={errors["customerService.email"]}
            />
          </div>
          <TextField
            name="customerService.description"
            label="Description"
            value={service.description}
            onChange={(value) =>
              setService((current) => ({ ...current, description: value }))
            }
            error={errors["customerService.description"]}
          />
        </Block>

        {/* Legal ---------------------------------------------------------- */}
        <Block
          title="Legal links"
          description="The small print row at the very bottom."
          action={
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={pending || legalLinks.length >= 10}
              onClick={() =>
                setLegalLinks((current) => [
                  ...current,
                  { id: makeId(), label: "", path: "/" },
                ])
              }
            >
              <Plus />
              Add
            </Button>
          }
        >
          {legalLinks.length === 0 ? (
            <Hint>No legal links.</Hint>
          ) : (
            <ul className="space-y-2">
              {legalLinks.map((item, index) => (
                <li key={String(item.id)} className="flex items-end gap-2">
                  <TextField
                    name={`legalLinks.${index}.label`}
                    label={index === 0 ? "Label" : undefined}
                    value={item.label}
                    onChange={(value) =>
                      setLegalLinks((current) =>
                        current.map((row, i) =>
                          i === index ? { ...row, label: value } : row,
                        ),
                      )
                    }
                    error={errors[`legalLinks.${index}.label`]}
                    className="w-52"
                  />
                  <TextField
                    name={`legalLinks.${index}.path`}
                    label={index === 0 ? "Path" : undefined}
                    value={item.path}
                    onChange={(value) =>
                      setLegalLinks((current) =>
                        current.map((row, i) =>
                          i === index ? { ...row, path: value } : row,
                        ),
                      )
                    }
                    error={errors[`legalLinks.${index}.path`]}
                    className="flex-1"
                  />
                  <RowControls
                    label={`legal link ${index + 1}`}
                    index={index}
                    length={legalLinks.length}
                    disabled={pending}
                    onMove={(to) =>
                      setLegalLinks((current) => moveInList(current, index, to))
                    }
                    onRemove={() =>
                      setLegalLinks((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      <div className="flex justify-end border-t px-4 py-2.5">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save footer
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function Block({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold">{title}</h3>
          {description ? (
            <p className="text-muted-foreground text-[11px]">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-xs">
      {children}
    </p>
  );
}

function TextField({
  name,
  label,
  value,
  onChange,
  error,
  className,
}: {
  name: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {label ? (
        <Label htmlFor={name} className="mb-1.5 text-xs">
          {label}
        </Label>
      ) : null}
      <Input
        id={name}
        value={value}
        aria-label={label ?? name}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 text-xs"
      />
      {error ? (
        <p className="text-destructive mt-1 text-[11px]">{error}</p>
      ) : null}
    </div>
  );
}

function RowControls({
  label,
  index,
  length,
  disabled,
  onMove,
  onRemove,
}: {
  label: string;
  index: number;
  length: number;
  disabled?: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center pb-0.5">
      <MoveButtons
        label={label}
        disabled={disabled}
        canMoveUp={index > 0}
        canMoveDown={index < length - 1}
        onUp={() => onMove(index - 1)}
        onDown={() => onMove(index + 1)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <Trash2 className="text-destructive" />
      </Button>
    </div>
  );
}
