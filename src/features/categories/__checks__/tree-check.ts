import "dotenv/config";

import { db } from "@/lib/db";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { resolveCategoryAttributes } from "@/features/catalog/attribute-resolution";

import {
  addCategoryAttribute,
  createCategory,
  deleteCategory,
  excludeCategoryAttribute,
  reorderCategories,
  updateCategory,
} from "@/features/categories/service";

/**
 * End-to-end check against the REAL database:
 *
 *   npx tsx src/features/categories/__checks__/tree-check.ts
 *
 * Creates a `check_` subtree under a demo root, moves it, renames a slug,
 * verifies path/depth/Product.categoryPath at every step, exercises the
 * attribute override/exclude rules, then deletes with reassign and asserts
 * nothing is left behind. Every row it creates is prefixed `check_` and is
 * removed at the end even when an assertion fails.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

const STAMP = Date.now().toString(36);
const NAME = (label: string) => `check_${label}_${STAMP}`;

async function cleanup(): Promise<void> {
  // Deepest first so the Restrict FK on parentId is satisfied.
  const rows = await db.category.findMany({ where: { name: { startsWith: "check_" } }, select: { id: true, depth: true } });
  for (const row of rows.sort((a, b) => b.depth - a.depth)) {
    await db.product.updateMany({ where: { categoryId: row.id }, data: { categoryId: null, categoryPath: null } });
    await db.category.delete({ where: { id: row.id } }).catch(() => undefined);
  }
  // AuditLog is append-only by trigger (D13): the check's audit rows stay, labelled check_*.
}

async function main(): Promise<void> {
  const roots = await db.category.findMany({ where: { parentId: null }, orderBy: { position: "asc" }, take: 2, select: { id: true, name: true, path: true } });
  assert(roots.length >= 2, "the seed should provide at least two root categories");
  const [rootA, rootB] = roots;
  const actor = SYSTEM_ACTOR;

  // 1. Create parent → child under rootA.
  const parent = await db.$transaction((tx) => createCategory(tx, { name: NAME("parent"), parentId: rootA.id, isActive: true, isFeatured: false, noIndex: false } as never, actor));
  const child = await db.$transaction((tx) => createCategory(tx, { name: NAME("child"), parentId: parent.id, isActive: true, isFeatured: false, noIndex: false } as never, actor));
  assert(parent.path === `${rootA.path}/${parent.slug}`, `parent path ${parent.path}`);
  assert(child.path === `${parent.path}/${child.slug}` && child.depth === parent.depth + 1, `child path/depth ${child.path}/${child.depth}`);
  console.log("created", parent.path, "and", child.path);

  // Duplicate name → suffixed slug (§11.23).
  const dupe = await db.$transaction((tx) => createCategory(tx, { name: NAME("child"), parentId: parent.id, isActive: true, isFeatured: false, noIndex: false } as never, actor));
  assert(dupe.slug === `${child.slug}-2`, `duplicate slug suffixed: ${dupe.slug}`);

  // Attach a demo product to the child so categoryPath propagation is observable.
  const product = await db.product.findFirst({ where: { id: { startsWith: "demo_" }, deletedAt: null }, select: { id: true, categoryId: true, categoryPath: true } });
  assert(product, "a demo product exists");
  const originalCategory = { categoryId: product.categoryId, categoryPath: product.categoryPath };
  await db.product.update({ where: { id: product.id }, data: { categoryId: child.id, categoryPath: child.path } });

  try {
    // 2. Move the parent under rootB via a reorder move; the whole subtree follows.
    await db.$transaction((tx) => reorderCategories(tx, [{ id: parent.id, parentId: rootB.id, position: 0 }], actor));
    const movedChild = await db.category.findUniqueOrThrow({ where: { id: child.id }, select: { path: true, depth: true } });
    assert(movedChild.path === `${rootB.path}/${parent.slug}/${child.slug}`, `moved child path ${movedChild.path}`);
    const movedProduct = await db.product.findUniqueOrThrow({ where: { id: product.id }, select: { categoryPath: true } });
    assert(movedProduct.categoryPath === movedChild.path, `product categoryPath followed: ${movedProduct.categoryPath}`);
    console.log("moved to", movedChild.path);

    // Cycle: parent under its own child must be rejected.
    let cycleRejected = false;
    try {
      await db.$transaction((tx) => reorderCategories(tx, [{ id: parent.id, parentId: child.id, position: 0 }], actor));
    } catch (error) {
      cycleRejected = (error as { status?: number }).status === 409;
    }
    assert(cycleRejected, "cycle move rejected with 409");

    // 3. Rename the parent's slug; descendant paths and product paths are rewritten.
    const newSlug = `${parent.slug}-renamed`;
    const renamed = await db.$transaction((tx) => updateCategory(tx, parent.id, { slug: newSlug }, actor));
    assert(renamed.structural, "slug change is structural");
    const renamedChild = await db.category.findUniqueOrThrow({ where: { id: child.id }, select: { path: true } });
    assert(renamedChild.path === `${rootB.path}/${newSlug}/${child.slug}`, `renamed child path ${renamedChild.path}`);
    const renamedProduct = await db.product.findUniqueOrThrow({ where: { id: product.id }, select: { categoryPath: true } });
    assert(renamedProduct.categoryPath === renamedChild.path, "product path follows slug rename");
    console.log("renamed to", renamedChild.path);

    // Edit-time duplicate slug → explicit 422 (§11.23).
    let dupeRejected = false;
    try {
      await db.$transaction((tx) => updateCategory(tx, child.id, { slug: dupe.slug }, actor));
    } catch (error) {
      dupeRejected = (error as { status?: number }).status === 422;
    }
    assert(dupeRejected, "duplicate slug on edit rejected with 422");

    // 4. Attribute inheritance: assign on parent, see it on child; exclude on child.
    const attribute = await db.attribute.findFirst({ where: { isActive: true, isGlobal: false }, select: { id: true, name: true } });
    if (attribute) {
      await db.$transaction((tx) => addCategoryAttribute(tx, { categoryId: parent.id, attributeId: attribute.id }, actor));
      const onChild = (await resolveCategoryAttributes(child.id)).find((entry) => entry.attribute.id === attribute.id);
      assert(onChild?.source === "inherited" && onChild.sourceCategoryId === parent.id, "child inherits the parent's assignment");
      await db.$transaction((tx) => excludeCategoryAttribute(tx, { categoryId: child.id, attributeId: attribute.id }, actor));
      const afterExclude = (await resolveCategoryAttributes(child.id)).some((entry) => entry.attribute.id === attribute.id);
      assert(!afterExclude, "exclusion removes the inherited attribute from the child");
      console.log("attribute inheritance + exclusion OK for", attribute.name);
    } else {
      console.log("no non-global attribute found; skipped inheritance check");
    }

    // 5. Delete without reassign is blocked; with reassign moves child + product.
    let blocked = false;
    try {
      await db.$transaction((tx) => deleteCategory(tx, { id: parent.id }, actor));
    } catch (error) {
      blocked = (error as { status?: number }).status === 409;
    }
    assert(blocked, "delete with children blocked (409)");

    const result = await db.$transaction((tx) => deleteCategory(tx, { id: parent.id, reassignTo: rootA.id }, actor));
    assert(result.movedChildren === 2 && result.reassignedTo?.id === rootA.id, `reassign moved ${result.movedChildren} children`);
    const reassignedChild = await db.category.findUniqueOrThrow({ where: { id: child.id }, select: { path: true, parentId: true } });
    assert(reassignedChild.parentId === rootA.id && reassignedChild.path === `${rootA.path}/${child.slug}`, `child re-homed to ${reassignedChild.path}`);
    const reassignedProduct = await db.product.findUniqueOrThrow({ where: { id: product.id }, select: { categoryPath: true } });
    assert(reassignedProduct.categoryPath === reassignedChild.path, "product path follows reassign");
    console.log("delete-with-reassign OK →", reassignedChild.path);

    // Delete the now-empty leaves outright (product moved back first).
    await db.product.update({ where: { id: product.id }, data: originalCategory });
    await db.$transaction((tx) => deleteCategory(tx, { id: child.id }, actor));
    await db.$transaction((tx) => deleteCategory(tx, { id: dupe.id }, actor));
    assert((await db.category.count({ where: { name: { startsWith: `check_` }, id: { in: [parent.id, child.id, dupe.id] } } })) === 0, "all check_ categories removed");

    const audits = await db.auditLog.count({ where: { entityType: "Category", entityId: { in: [parent.id, child.id, dupe.id] } } });
    assert(audits >= 8, `audit rows written (${audits})`);
    console.log(`OK - ${audits} audit rows written for the check subtree`);
  } finally {
    await db.product.update({ where: { id: product.id }, data: originalCategory }).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("22021") || message.includes("0x00")) {
      console.error(
        "BLOCKED by src/features/catalog/category-tree.ts recomputeSubtreePaths: the temporary path is `\\0${update.id}` and Postgres rejects NUL bytes (22021). Replace the NUL with a printable prefix such as `#tmp/${update.id}` (paths always start with '/', so it cannot collide).",
      );
    }
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await db.$disconnect();
  });
