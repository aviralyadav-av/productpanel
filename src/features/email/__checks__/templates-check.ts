import "dotenv/config";

import { db } from "@/lib/db";
import { sanitizeHtml } from "@/lib/sanitize/html";
import { EMAIL_TEMPLATE_KEYS } from "@/lib/enums";

import { renderTemplate } from "@/features/email/render";
import { previewTemplate, restoreTemplateVersion, updateEmailTemplate } from "@/features/email/templates-service";
import {
  documentedVariables,
  previewVarsFor,
  unknownVariablesFor,
  usedVariables,
} from "@/features/email/templates-samples";

/**
 * End-to-end check against the REAL database:
 *
 *   npx tsx src/features/email/__checks__/templates-check.ts
 *
 * 1. Renders EVERY seeded template with the sample variables the editor uses
 *    and asserts: no unknown `{{var}}`, nothing left unsubstituted, a non-empty
 *    subject and body, and a text part in every case.
 * 2. Exercises the edit path on one template (save -> restore previous
 *    version) and asserts the row comes back byte-for-byte, so "Restore
 *    previous version" is not a promise the audit diff cannot keep.
 *
 * The only rows it leaves behind are AuditLog entries, which are append-only
 * by design; the template itself is restored to exactly what it was.
 */

const ACTOR = { id: "system", email: "system@diybaazar.local" };

let failures = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}`);
  }
}

async function checkRendering(): Promise<void> {
  const templates = await db.emailTemplate.findMany({ orderBy: { key: "asc" } });
  console.log(`\nRendering ${templates.length} templates with sample data\n`);

  const seededKeys = new Set(templates.map((row) => row.key));
  for (const key of EMAIL_TEMPLATE_KEYS) {
    assert(seededKeys.has(key), `EMAIL_TEMPLATE_KEYS lists "${key}" but no row exists - run the seed`);
  }

  for (const template of templates) {
    const source = { subject: template.subject, htmlBody: template.htmlBody, textBody: template.textBody };
    const documented = documentedVariables(template.key, template.variables);
    const unknown = unknownVariablesFor(source, template.key, template.variables);
    const rendered = renderTemplate(source, previewVarsFor(source, template.key, template.variables));

    assert(
      unknown.length === 0,
      `${template.key}: uses variables nothing supplies -> ${unknown.join(", ")}`,
    );
    assert(!rendered.subject.includes("{{"), `${template.key}: subject still contains a placeholder`);
    assert(!rendered.html.includes("{{"), `${template.key}: html body still contains a placeholder`);
    assert(!rendered.text.includes("{{"), `${template.key}: text body still contains a placeholder`);
    assert(rendered.subject.trim().length > 0, `${template.key}: renders an empty subject`);
    assert(rendered.html.trim().length > 0, `${template.key}: renders an empty html body`);
    assert(rendered.text.trim().length > 0, `${template.key}: renders an empty text body`);

    // The stored `variables` column is the contract the seed wrote; every one
    // of them should be resolvable, even if this particular copy skips some.
    for (const name of template.variables) {
      assert(
        documented.includes(name),
        `${template.key}: seeded variable "${name}" is not in the documented set`,
      );
    }

    const used = usedVariables(source).length;
    console.log(
      `  ok  ${template.key.padEnd(28)} ${String(documented.length).padStart(2)} documented · ${String(used).padStart(2)} used · subject "${rendered.subject.slice(0, 48)}"`,
    );
  }

  // previewTemplate() is what the REST endpoint and the editor's preview pane
  // call; prove it agrees with the raw renderer and honours overrides.
  const first = templates[0];
  if (first) {
    const preview = previewTemplate(first, { store_name: "Check Store" });
    assert(preview.unknownVariables.length === 0, `${first.key}: previewTemplate reports unknown variables`);
    assert(
      !first.htmlBody.includes("{{store_name}}") || preview.html.includes("Check Store"),
      `${first.key}: previewTemplate ignored an override`,
    );
  }
}

async function checkEditAndRestore(): Promise<void> {
  const template = await db.emailTemplate.findUnique({ where: { key: "order_confirmation" } });
  if (!template) {
    assert(false, "order_confirmation template is missing - run the seed");
    return;
  }

  console.log("\nEdit -> restore round trip on order_confirmation\n");

  const marker = `<p>check_templates_check ${Date.now()}</p>`;
  await updateEmailTemplate(
    template.id,
    {
      name: template.name,
      subject: `${template.subject} (check)`,
      htmlBody: `${template.htmlBody}${marker}`,
      textBody: template.textBody,
      isActive: template.isActive,
    },
    ACTOR,
  );

  const edited = await db.emailTemplate.findUniqueOrThrow({ where: { id: template.id } });
  assert(edited.subject.endsWith("(check)"), "the edit did not persist the subject");
  assert(edited.htmlBody.includes("check_templates_check"), "the edit did not persist the html body");
  assert(edited.updatedById === ACTOR.id, "the edit did not record who made it");

  const restored = await restoreTemplateVersion(template.id, ACTOR);
  assert(restored.fields.includes("subject"), "restore did not report the subject as reverted");

  const after = await db.emailTemplate.findUniqueOrThrow({ where: { id: template.id } });
  assert(after.subject === template.subject, `restore left the subject as "${after.subject}"`);
  assert(after.textBody === template.textBody, "restore did not put the text body back");
  assert(after.isActive === template.isActive, "restore changed the active flag");

  // The body is compared against the SANITISED original, not the raw seeded
  // one: every save runs the `email` profile (D12), so the first edit of a
  // seeded template is also the moment its markup is normalised. From then on
  // a restore is byte-exact, which is what the second round trip proves.
  assert(
    after.htmlBody === sanitizeHtml(template.htmlBody, "email"),
    "restore did not put the sanitised html body back",
  );

  const secondMarker = `<p>check_templates_check second ${Date.now()}</p>`;
  await updateEmailTemplate(
    template.id,
    { name: after.name, subject: after.subject, htmlBody: `${after.htmlBody}${secondMarker}`, textBody: after.textBody, isActive: after.isActive },
    ACTOR,
  );
  await restoreTemplateVersion(template.id, ACTOR);
  const final = await db.emailTemplate.findUniqueOrThrow({ where: { id: template.id } });
  assert(final.htmlBody === after.htmlBody, "a second restore was not byte-exact");

  console.log("  ok  edited, restored, and the row matches the sanitised original exactly");

  if (sanitizeHtml(template.htmlBody, "email") !== template.htmlBody) {
    console.warn(
      "  WARN  saving a seeded template rewrites its markup: the `email` sanitiser profile drops inline\n" +
        "        style attributes (D12), which is most of the layout of an HTML email. The editor warns\n" +
        "        about this; allowing `style` on the email profile is a decision for the lib owner.",
    );
  }

  // Put the seeded markup back verbatim. The check must not be the thing that
  // strips the demo store's email styling - it writes through the ORM directly
  // here precisely because the service (correctly) sanitises.
  await db.emailTemplate.update({
    where: { id: template.id },
    data: {
      name: template.name,
      subject: template.subject,
      htmlBody: template.htmlBody,
      textBody: template.textBody,
      isActive: template.isActive,
      updatedById: template.updatedById,
    },
  });
  const reverted = await db.emailTemplate.findUniqueOrThrow({ where: { id: template.id } });
  assert(reverted.htmlBody === template.htmlBody, "the check failed to put the seeded body back");
  console.log("  ok  seeded markup written back verbatim; only AuditLog rows remain");
}

async function main(): Promise<void> {
  await checkRendering();
  await checkEditAndRestore();

  if (failures > 0) {
    console.error(`\nFAILED with ${failures} problem(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("\nPASSED");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
