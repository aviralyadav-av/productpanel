import { db } from "@/lib/db";
import { SYSTEM_ACTOR } from "@/lib/audit";

import { getMenuPreview, getMenuTree, listMenus, resolveActiveMenu } from "../queries";
import { NAV_MAX_DEPTH } from "../schemas";
import { createItem, deleteItem, reorderItems } from "../service";

/**
 * End-to-end smoke of the navigation module against the seeded database:
 * read the menus, then create a throwaway three-level branch, nest it one
 * level too deep (must be rejected), move it back and delete it.
 *
 * The depth rule is the one thing a unit test cannot prove here, because the
 * TreeView clamps the drag on the client and the service clamps it again on
 * the server - if only one of them is right, menus quietly go four levels deep
 * and the storefront drops the deepest links.
 *
 * Run:
 *   node --env-file=.env --import tsx \
 *     --import ./src/features/storefront/__checks__/stub-server-only.ts \
 *     src/features/navigation/__checks__/navigation-check.ts
 */

const ACTOR = SYSTEM_ACTOR;
const created: string[] = [];

function step(label: string, detail: string): void {
  console.log(`  ✓ ${label.padEnd(40)} ${detail}`);
}

async function expectReject(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    throw new Error(`EXPECTED REJECTION: ${label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("EXPECTED REJECTION")) throw error;
    step(label, `rejected — ${message}`);
  }
}

async function main(): Promise<void> {
  const menus = await listMenus();
  console.log(`Menus: ${menus.map((menu) => `${menu.slug}(${menu.itemCount})`).join(", ")}`);
  const main = resolveActiveMenu(menus, "main");
  if (!main) throw new Error("No 'main' menu in the database; run the seed first.");

  const before = await getMenuTree(main.id);
  const broken = before.filter((row) => !row.available);
  step("read the main menu", `${before.length} items, ${broken.length} with an unavailable target`);

  const preview = await getMenuPreview(main.slug);
  step("public payload", `${preview?.items.length ?? 0} top-level items for GET /api/v1/navigation/main`);

  // --- a throwaway branch, three levels deep -------------------------------
  const root = await createItem(
    { menuId: main.id, parentId: null, label: "check_root", type: "URL", url: "/check-root", categoryId: null, productId: null, pageId: null, blogPostId: null, iconName: null, badgeText: null, openInNewTab: false, isMegaMenu: false, isActive: false },
    ACTOR,
  );
  created.push(root.id);
  const child = await createItem(
    { menuId: main.id, parentId: root.id, label: "check_child", type: "URL", url: "/check-child", categoryId: null, productId: null, pageId: null, blogPostId: null, iconName: null, badgeText: null, openInNewTab: false, isMegaMenu: false, isActive: false },
    ACTOR,
  );
  created.push(child.id);
  const grandchild = await createItem(
    { menuId: main.id, parentId: child.id, label: "check_grandchild", type: "URL", url: "/check-gc", categoryId: null, productId: null, pageId: null, blogPostId: null, iconName: null, badgeText: null, openInNewTab: false, isMegaMenu: false, isActive: false },
    ACTOR,
  );
  created.push(grandchild.id);
  step("created a 3-level branch", `${root.label} > ${child.label} > ${grandchild.label}`);

  await expectReject(`a 4th level (max depth ${NAV_MAX_DEPTH})`, () =>
    createItem(
      { menuId: main.id, parentId: grandchild.id, label: "check_too_deep", type: "URL", url: "/nope", categoryId: null, productId: null, pageId: null, blogPostId: null, iconName: null, badgeText: null, openInNewTab: false, isMegaMenu: false, isActive: false },
      ACTOR,
    ),
  );

  await expectReject("moving a node inside its own subtree", () =>
    reorderItems([{ id: root.id, parentId: grandchild.id, position: 0 }], ACTOR),
  );

  // A second branch, so "too deep" can be tested without also being a cycle.
  const other = await createItem(
    { menuId: main.id, parentId: null, label: "check_other", type: "URL", url: "/check-other", categoryId: null, productId: null, pageId: null, blogPostId: null, iconName: null, badgeText: null, openInNewTab: false, isMegaMenu: false, isActive: false },
    ACTOR,
  );
  created.push(other.id);
  const otherChild = await createItem(
    { menuId: main.id, parentId: other.id, label: "check_other_child", type: "URL", url: "/check-other-child", categoryId: null, productId: null, pageId: null, blogPostId: null, iconName: null, badgeText: null, openInNewTab: false, isMegaMenu: false, isActive: false },
    ACTOR,
  );
  created.push(otherChild.id);

  // `check_child` carries one level below it, so landing it at depth 2 would
  // put its own child at depth 3 - a depth rejection, not a cycle.
  await expectReject("re-parenting a subtree one level too deep", () =>
    reorderItems([{ id: child.id, parentId: otherChild.id, position: 0 }], ACTOR),
  );

  // --- a legal move, then read it back -------------------------------------
  const moved = await reorderItems([{ id: grandchild.id, parentId: root.id, position: 0 }], ACTOR);
  const afterMove = await getMenuTree(main.id);
  const movedRow = afterMove.find((row) => row.id === grandchild.id);
  if (!movedRow || movedRow.parentId !== root.id || movedRow.position !== 0) {
    throw new Error(`Move not applied: ${JSON.stringify(movedRow)}`);
  }
  const siblings = afterMove.filter((row) => row.parentId === root.id).sort((a, b) => a.position - b.position);
  const dense = siblings.every((row, index) => row.position === index);
  step("moved the grandchild up a level", `${moved.moved} row(s) written, sibling positions ${dense ? "dense" : "SPARSE"}`);
  if (!dense) throw new Error("Sibling positions are not dense after a move.");

  // --- delete cascades ------------------------------------------------------
  const removed = await deleteItem(root.id, ACTOR);
  await deleteItem(other.id, ACTOR);
  created.length = 0;
  const afterDelete = await getMenuTree(main.id);
  const leftovers = afterDelete.filter((row) => row.label.startsWith("check_"));
  step("deleted the branch", `${removed.descendants} descendant(s) reported, ${leftovers.length} leftover row(s)`);
  if (leftovers.length > 0) throw new Error("Delete did not cascade to the children.");
  if (afterDelete.length !== before.length) throw new Error(`Menu size changed: ${before.length} → ${afterDelete.length}`);

  console.log("\nPASS — depth cap, cycle guard, dense positions and cascade delete all behave.");
}

void main()
  .catch(async (error) => {
    console.error("\nFAIL —", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Best effort cleanup if the run died halfway through.
    for (const id of created.reverse()) {
      await db.navigationItem.deleteMany({ where: { id } });
    }
    await db.$disconnect();
  });
