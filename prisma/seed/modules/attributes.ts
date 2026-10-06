import type { PrismaClient } from "@prisma/client";

import { slugify, type SeedContext } from "./context";

/**
 * Attribute definitions, their values, and per-category assignments (§4.2,
 * §14.A). Assignments are chosen so the effective filter set differs per
 * branch (Jewellery vs Paintings vs Fashion vs Home & Living) and a few
 * child-level rows exercise inheritance: an own row overriding an inherited
 * one, an addition, and an exclusion (Candles excludes Size).
 */
type AttributeSeed = {
  code: string;
  name: string;
  description?: string;
  inputType: "SELECT" | "MULTI_SELECT" | "TEXT" | "NUMBER" | "BOOLEAN" | "COLOR";
  filterType: "CHECKBOX" | "RADIO" | "RANGE" | "COLOR_SWATCH" | "TOGGLE" | "NONE";
  unit?: string;
  isVariantDefining?: boolean;
  isGlobal?: boolean;
  values?: Array<string | { value: string; label?: string; colorHex?: string }>;
};

const ATTRIBUTES: AttributeSeed[] = [
  {
    code: "colour",
    name: "Colour",
    inputType: "COLOR",
    filterType: "COLOR_SWATCH",
    isVariantDefining: true,
    values: [
      { value: "red", label: "Red", colorHex: "#D32F2F" },
      { value: "maroon", label: "Maroon", colorHex: "#7B1E3A" },
      { value: "pink", label: "Pink", colorHex: "#EC407A" },
      { value: "orange", label: "Orange", colorHex: "#F57C00" },
      { value: "yellow", label: "Yellow", colorHex: "#FBC02D" },
      { value: "mustard", label: "Mustard", colorHex: "#D4A017" },
      { value: "green", label: "Green", colorHex: "#388E3C" },
      { value: "teal", label: "Teal", colorHex: "#00897B" },
      { value: "blue", label: "Blue", colorHex: "#1976D2" },
      { value: "indigo", label: "Indigo", colorHex: "#303F9F" },
      { value: "purple", label: "Purple", colorHex: "#7B1FA2" },
      { value: "brown", label: "Brown", colorHex: "#6D4C41" },
      { value: "beige", label: "Beige", colorHex: "#D7CCC8" },
      { value: "white", label: "White", colorHex: "#FFFFFF" },
      { value: "black", label: "Black", colorHex: "#212121" },
      { value: "grey", label: "Grey", colorHex: "#9E9E9E" },
      { value: "gold", label: "Gold", colorHex: "#C9A227" },
      { value: "silver", label: "Silver", colorHex: "#B0BEC5" },
      { value: "multicolour", label: "Multicolour", colorHex: "#8E24AA" },
    ],
  },
  {
    code: "material",
    name: "Material",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Wood", "Metal", "Brass", "Copper", "Ceramic", "Terracotta", "Glass", "Cotton", "Jute", "Fabric", "Paper", "Resin", "Leather", "Bamboo", "Cane", "Stone", "Marble", "Acrylic", "Beads", "Thread"],
  },
  {
    code: "size",
    name: "Size",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    isVariantDefining: true,
    values: ["XS", "S", "M", "L", "XL", "XXL", { value: "free-size", label: "Free Size" }, "Small", "Medium", "Large", { value: "8x10", label: "8 × 10 in" }, { value: "12x16", label: "12 × 16 in" }, { value: "18x24", label: "18 × 24 in" }, { value: "24x36", label: "24 × 36 in" }],
  },
  {
    code: "pattern",
    name: "Pattern",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Solid", "Floral", "Geometric", "Striped", "Abstract", "Ethnic", "Polka Dot", "Block Printed", "Embroidered", "Ikat"],
  },
  {
    code: "occasion",
    name: "Occasion",
    inputType: "MULTI_SELECT",
    filterType: "CHECKBOX",
    values: ["Birthday", "Anniversary", "Wedding", "Diwali", "Christmas", "Raksha Bandhan", "Housewarming", { value: "valentines-day", label: "Valentine's Day" }, "Corporate", "Everyday"],
  },
  {
    code: "style",
    name: "Style",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Traditional", "Modern", "Bohemian", "Minimalist", "Vintage", "Rustic", "Contemporary", "Folk"],
  },
  { code: "weight", name: "Weight", inputType: "NUMBER", filterType: "RANGE", unit: "g" },
  { code: "dimensions", name: "Dimensions", description: "Free text, e.g. 30 × 20 × 5 cm", inputType: "TEXT", filterType: "NONE" },
  {
    code: "fabric",
    name: "Fabric",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Cotton", "Silk", "Linen", "Chanderi", "Khadi", "Georgette", "Rayon", "Wool", "Velvet", "Mulmul"],
  },
  {
    code: "painting-medium",
    name: "Painting Medium",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Acrylic", "Oil", "Watercolour", "Charcoal", "Ink", "Mixed Media", "Natural Pigments", "Digital Print"],
  },
  {
    code: "frame-type",
    name: "Frame Type",
    inputType: "SELECT",
    filterType: "RADIO",
    values: ["Unframed", "Wooden Frame", "Floating Frame", "Stretched Canvas", "Gallery Wrap", "Metal Frame"],
  },
  {
    code: "finish",
    name: "Finish",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Matte", "Glossy", "Natural", "Polished", "Distressed", "Hand-painted", "Antique"],
  },
  {
    code: "fragrance",
    name: "Fragrance",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Lavender", "Vanilla", "Sandalwood", "Rose", "Jasmine", "Lemongrass", "Cinnamon", "Unscented"],
  },
  { code: "capacity", name: "Capacity", inputType: "NUMBER", filterType: "RANGE", unit: "ml" },
  { code: "length", name: "Length", inputType: "NUMBER", filterType: "RANGE", unit: "cm" },
  {
    code: "theme",
    name: "Theme",
    inputType: "MULTI_SELECT",
    filterType: "CHECKBOX",
    values: ["Nature", "Floral", "Spiritual", "Abstract", "Animals", "Quotes", "Cityscape", "Festive", "Kids", "Wildlife", "Tribal"],
  },
  {
    code: "metal-type",
    name: "Metal Type",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Gold Plated", "Silver Plated", "Oxidised Silver", "Sterling Silver", "Brass", "Copper", "German Silver", "Alloy"],
  },
  {
    code: "stone-type",
    name: "Stone Type",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Kundan", "Pearl", "Meenakari", "Semi-precious", "Glass Beads", "Crystal", "Terracotta", "None"],
  },
  {
    code: "closure-type",
    name: "Closure Type",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Hook", "Push Back", "Lobster Clasp", "Adjustable", "Toggle", "Magnetic", "Screw Back", "Zip", "Drawstring"],
  },
  {
    code: "shape",
    name: "Shape",
    inputType: "SELECT",
    filterType: "CHECKBOX",
    values: ["Round", "Square", "Rectangular", "Oval", "Heart", "Hexagonal", "Irregular"],
  },
  {
    code: "handmade",
    name: "Handmade",
    description: "Global toggle shown in every category.",
    inputType: "BOOLEAN",
    filterType: "TOGGLE",
    isGlobal: true,
  },
];

type AssignmentSeed = {
  attribute: string;
  isRequired?: boolean;
  isFilterable?: boolean;
  isVariant?: boolean;
  showInSpecs?: boolean;
  inheritToChildren?: boolean;
  isExcluded?: boolean;
};

/** categorySlug -> assignments. Position follows array order. */
const ASSIGNMENTS: Record<string, AssignmentSeed[]> = {
  // Home & Living: Material, Colour, Dimensions, Finish, Theme (+ Size for soft furnishings)
  "home-living": [
    { attribute: "material", isRequired: true },
    { attribute: "colour", isVariant: true },
    { attribute: "dimensions", isFilterable: false },
    { attribute: "finish" },
    { attribute: "theme" },
    { attribute: "style" },
    { attribute: "size" },
    { attribute: "weight", showInSpecs: true },
  ],
  candles: [
    { attribute: "fragrance", isRequired: true },
    { attribute: "size", isExcluded: true },
    { attribute: "weight", isFilterable: true },
  ],
  "kitchen-and-dining": [{ attribute: "capacity" }],
  "cushions-and-throws": [
    // Own row overrides the inherited one: size becomes required and variant-defining.
    { attribute: "size", isRequired: true, isVariant: true },
    { attribute: "fabric" },
  ],

  // Fashion: Size, Fabric, Colour, Pattern, Occasion
  fashion: [
    { attribute: "size", isRequired: true, isVariant: true },
    { attribute: "fabric", isRequired: true },
    { attribute: "colour", isVariant: true },
    { attribute: "pattern" },
    { attribute: "occasion" },
  ],
  kurta: [{ attribute: "style" }],
  bags: [
    { attribute: "size", isExcluded: true },
    { attribute: "fabric", isExcluded: true },
    { attribute: "material", isRequired: true },
    { attribute: "closure-type" },
  ],
  footwear: [{ attribute: "fabric", isExcluded: true }, { attribute: "material" }],

  // Jewellery: Material, Colour, Occasion, Metal Type, Stone Type
  jewellery: [
    { attribute: "material" },
    { attribute: "colour", isVariant: true },
    { attribute: "occasion" },
    { attribute: "metal-type", isRequired: true },
    { attribute: "stone-type" },
  ],
  earrings: [{ attribute: "closure-type" }],
  anklets: [{ attribute: "length" }],
  "bracelets-and-bangles": [{ attribute: "size", isVariant: true }],
  necklaces: [{ attribute: "length" }],

  // Gifts: Occasion, Colour, Material, Theme
  gifts: [
    { attribute: "occasion", isRequired: true },
    { attribute: "colour", isVariant: true },
    { attribute: "material" },
    { attribute: "theme" },
  ],
  "coffee-mugs": [{ attribute: "capacity" }, { attribute: "shape" }],
  "photo-frames": [{ attribute: "size", isVariant: true }, { attribute: "frame-type" }],
  "gift-hampers": [{ attribute: "colour", isExcluded: true }],

  // Stationery: Colour, Theme, Pattern, Size
  stationery: [
    { attribute: "colour", isVariant: true },
    { attribute: "theme" },
    { attribute: "pattern" },
    { attribute: "size" },
  ],
  planners: [{ attribute: "pattern", isExcluded: true }],

  // Paintings: Painting Medium, Size, Frame Type, Theme
  paintings: [
    { attribute: "painting-medium", isRequired: true },
    { attribute: "size", isRequired: true, isVariant: true },
    { attribute: "frame-type", isVariant: true },
    { attribute: "theme" },
    { attribute: "style" },
    { attribute: "dimensions", isFilterable: false },
  ],
  "portraits-and-custom-paintings": [{ attribute: "theme", isExcluded: true }],
};

export async function seedAttributes(db: PrismaClient, ctx: SeedContext) {
  const attributeId = new Map<string, string>();
  let valueCount = 0;

  for (const [index, attribute] of ATTRIBUTES.entries()) {
    const row = await db.attribute.upsert({
      where: { code: attribute.code },
      update: {
        inputType: attribute.inputType,
        filterType: attribute.filterType,
        unit: attribute.unit ?? null,
        isGlobal: attribute.isGlobal ?? false,
      },
      create: {
        code: attribute.code,
        name: attribute.name,
        description: attribute.description ?? null,
        inputType: attribute.inputType,
        filterType: attribute.filterType,
        unit: attribute.unit ?? null,
        isVariantDefining: attribute.isVariantDefining ?? false,
        isFilterableDefault: attribute.filterType !== "NONE",
        isGlobal: attribute.isGlobal ?? false,
        position: index,
        isActive: true,
      },
      select: { id: true },
    });
    attributeId.set(attribute.code, row.id);

    for (const [valueIndex, raw] of (attribute.values ?? []).entries()) {
      const item = typeof raw === "string" ? { value: slugify(raw), label: raw } : raw;
      await db.attributeValue.upsert({
        where: { attributeId_value: { attributeId: row.id, value: item.value } },
        update: { colorHex: item.colorHex ?? null },
        create: {
          attributeId: row.id,
          value: item.value,
          label: item.label ?? raw.toString(),
          colorHex: item.colorHex ?? null,
          position: valueIndex,
          isActive: true,
        },
      });
      valueCount += 1;
    }
  }
  ctx.log(`attributes: ${attributeId.size}, values: ${valueCount}`);

  let assignmentCount = 0;
  for (const [slug, assignments] of Object.entries(ASSIGNMENTS)) {
    const category = await db.category.findUnique({ where: { slug }, select: { id: true } });
    if (!category) throw new Error(`Attribute assignment targets unknown category ${slug}`);

    for (const [position, assignment] of assignments.entries()) {
      const id = attributeId.get(assignment.attribute);
      if (!id) throw new Error(`Unknown attribute ${assignment.attribute} for ${slug}`);
      const data = {
        isRequired: assignment.isRequired ?? false,
        isFilterable: assignment.isFilterable ?? true,
        isVariant: assignment.isVariant ?? false,
        showInSpecs: assignment.showInSpecs ?? true,
        inheritToChildren: assignment.inheritToChildren ?? true,
        isExcluded: assignment.isExcluded ?? false,
        position,
      };
      await db.categoryAttribute.upsert({
        where: { categoryId_attributeId: { categoryId: category.id, attributeId: id } },
        update: data,
        create: { categoryId: category.id, attributeId: id, ...data },
      });
      assignmentCount += 1;
    }
  }
  ctx.log(`category attributes: ${assignmentCount}`);
}
