import type { PrismaClient } from "@prisma/client";

import { slugify, type SeedContext } from "./context";

/**
 * The DIY Baazar category tree (blueprint §12). Data, not code: the admin can
 * rename, move or delete any of it. Third-level nodes exist to prove depth.
 *
 * `path` is slug-based and materialised here exactly as the categories service
 * will maintain it (`/fashion/kurta/mens-kurta`).
 */
type CategorySeed = {
  name: string;
  slug?: string;
  description?: string;
  iconName?: string;
  isFeatured?: boolean;
  metaTitle?: string;
  metaDescription?: string;
  children?: CategorySeed[];
};

const TREE: CategorySeed[] = [
  {
    name: "Home & Living",
    slug: "home-living",
    iconName: "house",
    isFeatured: true,
    description: "Handmade decor, lighting and everyday objects for Indian homes.",
    metaDescription: "Shop handmade home decor, candles, planters, cushions and kitchenware from Indian artisans.",
    children: [
      { name: "Wall Decor", description: "Hangings, macramé, wall plates and clocks." },
      { name: "Candles", description: "Hand-poured soy and beeswax candles." },
      { name: "Planters & Vases", description: "Terracotta, ceramic and metal planters." },
      { name: "Cushions & Throws", description: "Block-printed and embroidered soft furnishings." },
      { name: "Kitchen & Dining", description: "Serveware, coasters, jars and table linen." },
      { name: "Storage & Organisers", description: "Baskets, trays and boxes." },
      { name: "Lamps & Lighting", description: "Table lamps, lanterns and fairy lights." },
      { name: "Woodcrafts", description: "Carved and turned wooden objects." },
    ],
  },
  {
    name: "Fashion",
    slug: "fashion",
    iconName: "shirt",
    isFeatured: true,
    description: "Handloom and hand-finished clothing and accessories.",
    metaDescription: "Handloom kurtas, sarees, dupattas, bags and footwear made by independent Indian makers.",
    children: [
      {
        name: "Kurta",
        description: "Hand-block printed and handloom kurtas.",
        children: [
          { name: "Men's Kurta", slug: "mens-kurta" },
          { name: "Women's Kurta", slug: "womens-kurta" },
        ],
      },
      { name: "Sarees", description: "Handloom and hand-painted sarees." },
      { name: "Dupattas & Stoles" },
      { name: "Bags", description: "Handcrafted totes, sling bags and clutches." },
      { name: "Footwear", description: "Juttis, kolhapuris and hand-stitched sandals." },
      { name: "Kids Wear" },
    ],
  },
  {
    name: "Jewellery",
    slug: "jewellery",
    iconName: "gem",
    isFeatured: true,
    description: "Handmade jewellery in silver, brass, beads and thread.",
    metaDescription: "Handmade earrings, necklaces, bangles and rings from Indian jewellery artisans.",
    children: [
      { name: "Earrings" },
      { name: "Necklaces" },
      { name: "Bracelets & Bangles" },
      { name: "Rings" },
      { name: "Anklets" },
      { name: "Jewellery Sets" },
    ],
  },
  {
    name: "Gifts",
    slug: "gifts",
    iconName: "gift",
    isFeatured: true,
    description: "Personalised and handmade gifts for every occasion.",
    metaDescription: "Personalised mugs, photo frames, hampers and keepsakes made to order.",
    children: [
      { name: "Personalised Gifts", description: "Name, message and photo personalisation." },
      {
        name: "Coffee Mugs",
        description: "Hand-painted and printed mugs.",
        children: [{ name: "Personalised Mugs" }],
      },
      { name: "Photo Frames" },
      { name: "Gift Hampers" },
      { name: "Corporate Gifts" },
      { name: "Keychains" },
    ],
  },
  {
    name: "Stationery",
    slug: "stationery",
    iconName: "notebook-pen",
    isFeatured: true,
    description: "Handmade paper goods and desk accessories.",
    metaDescription: "Handmade journals, planners, cards and desk accessories.",
    children: [
      { name: "Notebooks & Journals" },
      { name: "Planners" },
      { name: "Pens & Pencils" },
      { name: "Greeting Cards" },
      { name: "Desk Accessories" },
      { name: "Stickers & Washi Tape" },
    ],
  },
  {
    name: "Paintings",
    slug: "paintings",
    iconName: "palette",
    isFeatured: true,
    description: "Original artwork and folk art from Indian artists.",
    metaDescription: "Original canvas, watercolour, Madhubani, Warli and mandala paintings.",
    children: [
      { name: "Canvas Paintings" },
      { name: "Watercolour" },
      { name: "Madhubani" },
      { name: "Warli" },
      { name: "Mandala Art" },
      { name: "Portraits & Custom Paintings", description: "Commissioned from your photo." },
    ],
  },
];

async function upsertNode(
  db: PrismaClient,
  node: CategorySeed,
  parent: { id: string; path: string; depth: number } | null,
  position: number,
): Promise<number> {
  const slug = node.slug ?? slugify(node.name);
  const path = `${parent?.path ?? ""}/${slug}`;
  const depth = parent ? parent.depth + 1 : 0;

  const row = await db.category.upsert({
    where: { slug },
    // Structure (parent/path/depth) is re-asserted; names and copy are the
    // admin's to change.
    update: { parentId: parent?.id ?? null, path, depth },
    create: {
      slug,
      name: node.name,
      description: node.description ?? null,
      parentId: parent?.id ?? null,
      path,
      depth,
      position,
      isFeatured: node.isFeatured ?? false,
      isActive: true,
      iconName: node.iconName ?? null,
      metaTitle: node.metaTitle ?? `${node.name} | DIY Baazar`,
      metaDescription: node.metaDescription ?? node.description ?? null,
    },
    select: { id: true },
  });

  let count = 1;
  for (const [index, child] of (node.children ?? []).entries()) {
    count += await upsertNode(db, child, { id: row.id, path, depth }, index);
  }
  return count;
}

export async function seedTaxonomy(db: PrismaClient, ctx: SeedContext) {
  let count = 0;
  for (const [index, root] of TREE.entries()) {
    count += await upsertNode(db, root, null, index);
  }
  ctx.log(`categories: ${count}`);
}
