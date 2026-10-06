"use client";

import * as React from "react";
import { Eye, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FormRow } from "@/components/shared/form-layout";
import { HtmlPreview } from "@/components/shared/html-preview";
import { RichTextEditor } from "@/components/shared/rich-text-editor";

import { previewBasicHtml, type FaqDraft } from "../draft";

/**
 * The four fields of a FAQ, shared by the inline row editor and the "New FAQ"
 * dialog so both validate and look identical.
 *
 * The answer uses the shared RichTextEditor but the service sanitises it with
 * the `basic` profile (§11.21): paragraphs, lists, emphasis and links survive,
 * headings/images/tables do not - an accordion panel is a paragraph, not an
 * article. The hint says so, and the Preview toggle shows the answer the way
 * the storefront renders it, in the same sandboxed iframe the page editor uses.
 *
 * The group is a free-text field backed by a `<datalist>` of the groups that
 * already exist: picking an existing group and inventing a new one are the
 * same gesture, which is the whole model - `Faq.group` is a label, not a table.
 */
export function FaqFields({
  idPrefix,
  values,
  onChange,
  groups,
  errors = {},
  disabled = false,
  autoFocus = false,
}: {
  idPrefix: string;
  values: FaqDraft;
  onChange: (patch: Partial<FaqDraft>) => void;
  /** Existing group names, offered as suggestions. */
  groups: string[];
  errors?: Record<string, string>;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [showPreview, setShowPreview] = React.useState(false);
  const listId = `${idPrefix}-groups`;

  return (
    <div className="space-y-3">
      <FormRow label="Question" htmlFor={`${idPrefix}-question`} required error={errors.question}>
        <Input
          id={`${idPrefix}-question`}
          value={values.question}
          onChange={(event) => onChange({ question: event.target.value })}
          maxLength={300}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={Boolean(errors.question) || undefined}
        />
      </FormRow>

      <FormRow
        label="Group"
        htmlFor={`${idPrefix}-group`}
        error={errors.group}
        hint="The accordion heading on the storefront. Type a new name to start a group; leave it empty for General."
      >
        <Input
          id={`${idPrefix}-group`}
          value={values.group}
          onChange={(event) => onChange({ group: event.target.value })}
          maxLength={60}
          list={listId}
          disabled={disabled}
          placeholder="General"
          aria-invalid={Boolean(errors.group) || undefined}
        />
        <datalist id={listId}>
          {groups.map((group) => (
            <option key={group} value={group} />
          ))}
        </datalist>
      </FormRow>

      <FormRow
        label={
          <span className="flex w-full items-center justify-between gap-2">
            Answer
            <Button type="button" variant="ghost" size="xs" onClick={() => setShowPreview((current) => !current)}>
              {showPreview ? <PenLine /> : <Eye />}
              {showPreview ? "Edit" : "Preview"}
            </Button>
          </span>
        }
        htmlFor={`${idPrefix}-answer`}
        required
        error={errors.answer}
        hint="Paragraphs, lists, bold/italic and links are kept; headings, images and tables are removed when the answer is saved."
      >
        {showPreview ? (
          <HtmlPreview html={previewBasicHtml(values.answer) || "<p></p>"} title="Answer preview" minHeight={140} />
        ) : (
          <RichTextEditor
            id={`${idPrefix}-answer`}
            value={values.answer}
            onChange={(answer) => onChange({ answer })}
            disabled={disabled}
            minHeight={140}
            placeholder="Answer the question in a sentence or two…"
          />
        )}
      </FormRow>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormRow inline label="Shown on the storefront" htmlFor={`${idPrefix}-enabled`} hint="Disabled questions stay here but are not returned publicly.">
          <Switch id={`${idPrefix}-enabled`} checked={values.enabled} onCheckedChange={(enabled) => onChange({ enabled })} disabled={disabled} />
        </FormRow>
        <FormRow inline label="Featured" htmlFor={`${idPrefix}-featured`} hint="Featured questions can be pulled onto other pages.">
          <Switch id={`${idPrefix}-featured`} checked={values.isFeatured} onCheckedChange={(isFeatured) => onChange({ isFeatured })} disabled={disabled} />
        </FormRow>
      </div>
    </div>
  );
}
