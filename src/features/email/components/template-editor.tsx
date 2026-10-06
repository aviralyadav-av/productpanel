"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Code, Monitor, Smartphone, Type } from "lucide-react";
import { cn } from "cn";

import { formatIstDateTime } from "@/lib/dates";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormSection } from "@/components/shared/form-layout";
import { HtmlPreview } from "@/components/shared/html-preview";
import { useMediaPicker } from "@/components/shared/media-picker";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { useActionToast } from "@/components/shared/use-action-toast";

import {
  restoreEmailTemplateAction,
  sendTestEmailAction,
  updateEmailTemplateAction,
} from "@/features/email/actions";
import {
  ActivityPanel,
  SendPanel,
  VariablesPanel,
} from "@/features/email/components/template-editor-panels";
import { renderTemplate } from "@/features/email/render";
import {
  documentedVariables,
  previewVarsFor,
  unknownVariablesFor,
  unusedVariablesFor,
} from "@/features/email/templates-samples";
import { sanitiserWarnings, type TemplateEditorData } from "@/features/email/templates-schemas";

/**
 * The template editor (blueprint §1 "Email templates", E3).
 *
 * The preview renders in the BROWSER: `renderTemplate` and the sample-variable
 * builder are pure modules with no server imports, so every keystroke can show
 * the finished email without a round trip - and, crucially, the preview uses
 * exactly the renderer that will build the real send, not an approximation.
 * The server re-renders the stored copy for the test send, so what an operator
 * previews and what a customer receives cannot diverge.
 *
 * Two body editors, not one: the rich editor for people writing copy, a raw
 * HTML textarea for people pasting a designed email (tables, inline styles,
 * conditional blocks). Both edit the same string, so switching is free. The
 * server sanitises with the `email` profile on save either way.
 */
export function TemplateEditor({
  template,
  canManage,
}: {
  template: TemplateEditorData;
  canManage: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const picker = useMediaPicker();

  const [name, setName] = React.useState(template.name);
  const [subject, setSubject] = React.useState(template.subject);
  const [htmlBody, setHtmlBody] = React.useState(template.htmlBody);
  const [textBody, setTextBody] = React.useState(template.textBody ?? "");
  const [isActive, setIsActive] = React.useState(template.isActive);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const [htmlMode, setHtmlMode] = React.useState<"rich" | "source">("source");
  const [previewPane, setPreviewPane] = React.useState<"html" | "text" | "subject">("html");
  const [previewWidth, setPreviewWidth] = React.useState<"desktop" | "mobile">("desktop");

  const subjectRef = React.useRef<HTMLInputElement>(null);
  const htmlRef = React.useRef<HTMLTextAreaElement>(null);
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const lastFocused = React.useRef<"subject" | "html" | "text">("subject");

  const source = React.useMemo(
    () => ({ subject, htmlBody, textBody: textBody.trim() ? textBody : null }),
    [subject, htmlBody, textBody],
  );

  const documented = React.useMemo(
    () => documentedVariables(template.key, template.variables),
    [template.key, template.variables],
  );
  const unknown = React.useMemo(
    () => unknownVariablesFor(source, template.key, template.variables),
    [source, template.key, template.variables],
  );
  const unused = React.useMemo(
    () => unusedVariablesFor(source, template.key, template.variables),
    [source, template.key, template.variables],
  );
  const sanitiserNotes = React.useMemo(() => sanitiserWarnings(htmlBody), [htmlBody]);
  const rendered = React.useMemo(
    () => renderTemplate(source, previewVarsFor(source, template.key, template.variables)),
    [source, template.key, template.variables],
  );

  const dirty =
    name !== template.name ||
    subject !== template.subject ||
    htmlBody !== template.htmlBody ||
    textBody !== (template.textBody ?? "") ||
    isActive !== template.isActive;

  /** Insert `{{name}}` at the caret of whichever field was last focused. */
  function insertVariable(variable: string) {
    const token = `{{${variable}}}`;
    const target = lastFocused.current;

    if (target === "subject") {
      insertIntoInput(subjectRef.current, token, setSubject);
      return;
    }
    if (target === "text") {
      insertIntoInput(textRef.current, token, setTextBody);
      return;
    }
    if (htmlMode === "source") {
      insertIntoInput(htmlRef.current, token, setHtmlBody);
      return;
    }
    // The rich editor exposes no caret API, so a chip appends a paragraph.
    setHtmlBody((current) => `${current}<p>${token}</p>`);
  }

  async function save() {
    setErrors({});
    const result = await run(
      () =>
        updateEmailTemplateAction(template.id, {
          name,
          subject,
          htmlBody,
          textBody: textBody.trim() ? textBody : null,
          isActive,
        }),
      { onSuccess: () => router.refresh() },
    );
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  async function sendTest() {
    if (dirty) {
      const proceed = await confirm({
        title: "Send the SAVED version?",
        description:
          "The test email renders the template as stored, not the unsaved edits on this screen. Save first if you want to test what you are looking at.",
        confirmLabel: "Send anyway",
      });
      if (!proceed.ok) return;
    }
    await run(() => sendTestEmailAction(template.id), { onSuccess: () => router.refresh() });
  }

  async function restore() {
    if (!template.restorePoint) return;
    const point = template.restorePoint;
    const result = await confirm({
      title: "Restore the previous version?",
      description: `This puts ${point.fields.join(", ")} back to what it was before ${point.actorEmail} changed it on ${formatIstDateTime(new Date(point.at))}. The restore is itself recorded, so it can be undone.`,
      confirmLabel: "Restore",
    });
    if (!result.ok) return;
    await run(() => restoreEmailTemplateAction(template.id), { onSuccess: () => router.refresh() });
  }

  return (
    <div className="space-y-4">
      {confirmDialog}
      {picker.element}

      <FormSection
        title="Message"
        description="The subject line and the name operators see in the list. Variables in double braces are replaced when the email is queued."
        actions={
          <div className="flex items-center gap-2">
            <Switch
              id="template-active"
              checked={isActive}
              disabled={!canManage || pending}
              onCheckedChange={setIsActive}
              aria-label="Template is active"
            />
            <label htmlFor="template-active" className="text-xs">
              {isActive ? "Active — the platform sends it" : "Disabled — the platform skips it"}
            </label>
          </div>
        }
      >
        <FormRow label="Name" htmlFor="template-name" error={errors.name} required>
          <Input
            id="template-name"
            value={name}
            disabled={!canManage}
            onChange={(event) => setName(event.target.value)}
          />
        </FormRow>
        <FormRow
          label="Subject"
          htmlFor="template-subject"
          error={errors.subject}
          required
          hint="Rendered as plain text; whitespace is collapsed on send."
        >
          <Input
            id="template-subject"
            ref={subjectRef}
            value={subject}
            disabled={!canManage}
            onFocus={() => (lastFocused.current = "subject")}
            onChange={(event) => setSubject(event.target.value)}
          />
        </FormRow>
      </FormSection>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <FormSection
            title="HTML body"
            description="What most recipients see. Saved through the email sanitiser: scripts, iframes, styles and event handlers are stripped, so paste freely."
            actions={
              <div className="bg-muted inline-flex rounded-lg p-0.5">
                <ModeButton active={htmlMode === "rich"} onClick={() => setHtmlMode("rich")} icon={Type} label="Rich text" />
                <ModeButton active={htmlMode === "source"} onClick={() => setHtmlMode("source")} icon={Code} label="Raw HTML" />
              </div>
            }
          >
            {errors.htmlBody ? <p className="text-destructive text-xs">{errors.htmlBody}</p> : null}
            {sanitiserNotes.length > 0 ? (
              <div className="border-warning/40 bg-warning-muted/40 rounded-md border p-2.5">
                <p className="text-warning flex items-center gap-1.5 text-xs font-medium">
                  <AlertTriangle className="size-3.5" /> Saving will rewrite this markup
                </p>
                <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-4 text-[11px]">
                  {sanitiserNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {htmlMode === "rich" ? (
              <RichTextEditor
                value={htmlBody}
                onChange={setHtmlBody}
                disabled={!canManage}
                onPickImage={picker.pickImage}
                minHeight={320}
              />
            ) : (
              <Textarea
                ref={htmlRef}
                value={htmlBody}
                disabled={!canManage}
                spellCheck={false}
                onFocus={() => (lastFocused.current = "html")}
                onChange={(event) => setHtmlBody(event.target.value)}
                className="min-h-80 font-mono text-xs"
                aria-label="HTML body source"
              />
            )}
          </FormSection>

          <FormSection
            title="Plain-text body"
            description="Optional. Left empty, the text part is derived from the HTML on send — fine for simple emails, worth writing by hand for anything with a table."
          >
            <Textarea
              ref={textRef}
              value={textBody}
              disabled={!canManage}
              onFocus={() => (lastFocused.current = "text")}
              onChange={(event) => setTextBody(event.target.value)}
              className="min-h-40 font-mono text-xs"
              aria-label="Plain text body"
              placeholder="Leave empty to derive it from the HTML."
            />
          </FormSection>
        </div>

        <div className="space-y-4">
          <VariablesPanel
            documented={documented}
            unknown={unknown}
            unused={unused}
            canManage={canManage}
            eventKey={template.eventKey}
            eventDescription={template.eventDescription}
            onInsert={insertVariable}
          />

          <section className="surface overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <h2 className="text-xs font-semibold tracking-tight">Preview</h2>
              <div className="flex items-center gap-1">
                <div className="bg-muted inline-flex rounded-lg p-0.5">
                  <ModeButton active={previewPane === "html"} onClick={() => setPreviewPane("html")} label="HTML" />
                  <ModeButton active={previewPane === "text"} onClick={() => setPreviewPane("text")} label="Text" />
                  <ModeButton active={previewPane === "subject"} onClick={() => setPreviewPane("subject")} label="Subject" />
                </div>
                {previewPane === "html" ? (
                  <div className="bg-muted inline-flex rounded-lg p-0.5">
                    <ModeButton
                      active={previewWidth === "desktop"}
                      onClick={() => setPreviewWidth("desktop")}
                      icon={Monitor}
                      label="Desktop"
                      iconOnly
                    />
                    <ModeButton
                      active={previewWidth === "mobile"}
                      onClick={() => setPreviewWidth("mobile")}
                      icon={Smartphone}
                      label="Mobile"
                      iconOnly
                    />
                  </div>
                ) : null}
              </div>
            </header>

            <div className="space-y-2 p-3">
              <p className="text-muted-foreground text-[11px]">
                Rendered with sample data, by the same renderer the queue uses.
              </p>
              {previewPane === "subject" ? (
                <p className="bg-muted/40 rounded-md border p-3 text-sm">{rendered.subject}</p>
              ) : previewPane === "text" ? (
                <pre className="bg-muted/40 max-h-128 overflow-auto rounded-md border p-3 font-mono text-[11px] whitespace-pre-wrap">
                  {rendered.text}
                </pre>
              ) : (
                <div className={cn("mx-auto transition-all", previewWidth === "mobile" ? "max-w-95" : "w-full")}>
                  <HtmlPreview html={rendered.html} title="Email preview" minHeight={360} />
                </div>
              )}
            </div>
          </section>

          <SendPanel
            template={template}
            pending={pending}
            canManage={canManage}
            onSendTest={sendTest}
            onRestore={restore}
          />
        </div>
      </div>

      <ActivityPanel template={template} />

      {canManage ? (
        <FormActions
          dirty={dirty}
          pending={pending}
          onSubmit={() => void save()}
          submitLabel="Save template"
          onCancel={
            dirty
              ? () => {
                  setName(template.name);
                  setSubject(template.subject);
                  setHtmlBody(template.htmlBody);
                  setTextBody(template.textBody ?? "");
                  setIsActive(template.isActive);
                  setErrors({});
                }
              : undefined
          }
          cancelLabel="Discard changes"
          status={
            dirty
              ? "Unsaved changes"
              : `Last updated ${formatIstDateTime(new Date(template.updatedAt))}${template.updatedByName ? ` by ${template.updatedByName}` : ""}`
          }
        />
      ) : null}
    </div>
  );
}

function insertIntoInput(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  token: string,
  setValue: (updater: (current: string) => string) => void,
) {
  if (!element) {
    setValue((current) => `${current}${token}`);
    return;
  }
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  setValue((current) => `${current.slice(0, start)}${token}${current.slice(end)}`);
  requestAnimationFrame(() => {
    element.focus();
    const caret = start + token.length;
    element.setSelectionRange(caret, caret);
  });
}

function ModeButton({
  active,
  onClick,
  label,
  icon: Icon,
  iconOnly = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={iconOnly ? label : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
        active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {Icon ? <Icon className="size-3.5" /> : null}
      {iconOnly ? null : label}
    </button>
  );
}
