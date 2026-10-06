import { db } from "@/lib/db";
import { asObject } from "@/lib/json";
import { isSectionType, scheduleState, sectionDefinition } from "@/features/content/registry";

import { previewSection } from "../preview";

/**
 * Against the seeded database: does every homepage section row still satisfy
 * its own registry schema, and does at least one of them resolve through the
 * storefront resolver the way `/api/v1/home` will?
 *
 * This is the check the section editor cannot make for you: the editor only
 * ever validates what IT wrote, while the seed, a migration or another agent
 * can leave a payload the registry would now reject - and the storefront would
 * then quietly serve that section with default settings.
 *
 * Run:
 *   node --env-file=.env --import tsx \
 *     --import ./src/features/storefront/__checks__/stub-server-only.ts \
 *     src/features/content/homepage/__checks__/sections-check.ts
 */

type Problem = { key: string; message: string };

async function main(): Promise<void> {
  const now = new Date();
  const rows = await db.contentSection.findMany({ where: { page: "home" }, orderBy: { position: "asc" } });
  console.log(`Loaded ${rows.length} home sections.`);

  const problems: Problem[] = [];
  let unknownTypes = 0;

  for (const row of rows) {
    const definition = sectionDefinition(row.type);
    const known = isSectionType(row.type);
    if (!known) {
      unknownTypes += 1;
      problems.push({ key: row.key, message: `type "${row.type}" is not in the registry (renders read-only)` });
      continue;
    }

    const payload = asObject<Record<string, unknown>>(row.payload, {});
    const parsed = definition.sectionSchema.safeParse(payload);
    const state = scheduleState(row, now);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      problems.push({ key: row.key, message: `payload rejected by ${definition.label} schema — ${detail}` });
      console.log(`  ✗ ${row.key.padEnd(28)} ${definition.label} [${state}] — invalid payload`);
    } else {
      console.log(`  ✓ ${row.key.padEnd(28)} ${definition.label} [${state}] — ${Object.keys(parsed.data).length} setting(s)`);
    }

    if (definition.repeatable) {
      const blocks = await db.contentBlock.findMany({ where: { sectionId: row.id }, orderBy: { position: "asc" } });
      for (const [index, block] of blocks.entries()) {
        const blockParsed = definition.blockSchema.safeParse(asObject<Record<string, unknown>>(block.payload, {}));
        if (!blockParsed.success) {
          problems.push({
            key: `${row.key}[${index}]`,
            message: blockParsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; "),
          });
        }
      }
      console.log(`      ${blocks.length} ${definition.blockNoun}(s) checked`);
    }
  }

  // Preview one section end to end - the same call the editor's Preview pane
  // and GET /api/admin/homepage/sections/:id/preview make.
  const previewRow = rows.find((row) => sectionDefinition(row.type).resolver !== "stored") ?? rows[0];
  if (!previewRow) {
    console.log("\nNo sections to preview.");
  } else {
    const preview = await previewSection(previewRow, { now });
    console.log(
      `\nPreview of "${preview.key}" (${preview.type} → ${preview.resolver} resolver, state ${preview.state}): ` +
        `${preview.items.length} item(s)${preview.error ? `, ERROR: ${preview.error}` : ""}`,
    );
    const first = preview.items[0];
    if (first && typeof first === "object") {
      console.log(`  first item keys: ${Object.keys(first as Record<string, unknown>).join(", ")}`);
    }
    if (preview.error) problems.push({ key: preview.key, message: `resolver failed: ${preview.error}` });
  }

  console.log("");
  if (problems.length === 0) {
    console.log(`PASS — ${rows.length} sections valid against the registry, preview resolved.`);
  } else {
    console.log(`FAIL — ${problems.length} problem(s)${unknownTypes > 0 ? ` (${unknownTypes} unknown type(s))` : ""}:`);
    for (const problem of problems) console.log(`  - ${problem.key}: ${problem.message}`);
  }

  await db.$disconnect();
  process.exitCode = problems.length === 0 ? 0 : 1;
}

void main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exitCode = 1;
});
