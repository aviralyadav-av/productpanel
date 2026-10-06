import "server-only";

import type { Prisma } from "@prisma/client";
import type { Route } from "next";

import { db } from "@/lib/db";
import { commissionTargetKey, type CommissionScope } from "@/lib/enums";
import type { DateRange } from "@/lib/dates";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";

import { categoryAncestorIds, loadChargeRules, resolveCommission } from "./service";
import type { ChargeRowValues, CommissionFilters, CommissionSort } from "./ui-schemas";

/**
 * Read side for /admin/commissions (blueprint §14.B3).
 *
 * Everything here is `server-only` and returns plain, client-safe view models
 * so a Server Component can hand a row straight to a client table without
 * leaking a Prisma client into the bundle.
 *
 * The commission SUMMARY reads `OrderItem` snapshots rather than re-resolving
 * rules: the rate that applied when the order was placed is a fact, and a rule
 * edited last week must not retroactively change what a seller earned (B3).
 */

export type CommissionRuleRow = {
  id: string;
  scope: CommissionScope;
  targetKey: string;
  targetId: string | null;
  /** Display name of the category/seller/product, or null when it is gone. */
  targetLabel: string | null;
  targetSubtitle: string | null;
  targetHref: Route | null;
  rateBps: number;
  fixedPaise: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  note: string | null;
  updatedAt: Date;
  /** How many past order lines were priced with this rule. */
  usageCount: number;
};

const RULE_SELECT = {
  id: true,
  scope: true,
  targetKey: true,
  categoryId: true,
  sellerId: true,
  productId: true,
  rateBps: true,
  fixedPaise: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  note: true,
  updatedAt: true,
  category: { select: { id: true, name: true, path: true } },
  seller: { select: { id: true, displayName: true, slug: true } },
  product: { select: { id: true, title: true, slug: true } },
  _count: { select: { orderItems: true } },
} satisfies Prisma.CommissionRuleSelect;

type RuleRecord = Prisma.CommissionRuleGetPayload<{ select: typeof RULE_SELECT }>;

function toRuleRow(rule: RuleRecord): CommissionRuleRow {
  const scope = rule.scope as CommissionScope;

  // A rule whose target row was deleted keeps its key so an operator can see
  // (and remove) it, rather than the row silently disappearing from the list.
  const target =
    scope === "CATEGORY" && rule.category
      ? {
          id: rule.category.id,
          label: rule.category.name,
          subtitle: rule.category.path,
          href: `/admin/categories/${rule.category.id}` as Route,
        }
      : scope === "SELLER" && rule.seller
        ? {
            id: rule.seller.id,
            label: rule.seller.displayName,
            subtitle: rule.seller.slug,
            href: `/admin/sellers/${rule.seller.id}` as Route,
          }
        : scope === "PRODUCT" && rule.product
          ? {
              id: rule.product.id,
              label: rule.product.title,
              subtitle: rule.product.slug,
              href: `/admin/products/${rule.product.id}` as Route,
            }
          : null;

  return {
    id: rule.id,
    scope,
    targetKey: rule.targetKey,
    targetId: rule.categoryId ?? rule.sellerId ?? rule.productId ?? null,
    targetLabel: target?.label ?? (scope === "GLOBAL" ? "Every sale" : null),
    targetSubtitle: target?.subtitle ?? null,
    targetHref: target?.href ?? null,
    rateBps: rule.rateBps,
    fixedPaise: rule.fixedPaise,
    isActive: rule.isActive,
    startsAt: rule.startsAt,
    endsAt: rule.endsAt,
    note: rule.note,
    updatedAt: rule.updatedAt,
    usageCount: rule._count.orderItems,
  };
}

export function buildCommissionWhere(filters: CommissionFilters): Prisma.CommissionRuleWhereInput {
  const where: Prisma.CommissionRuleWhereInput = {};
  if (filters.scope) where.scope = filters.scope;
  if (filters.active !== undefined) where.isActive = filters.active;

  if (filters.q) {
    // Search across the three possible targets plus the note, so "candles" or
    // a seller name both find the rule the operator is thinking of.
    where.OR = [
      { note: { contains: filters.q, mode: "insensitive" } },
      { targetKey: { contains: filters.q, mode: "insensitive" } },
      { category: { name: { contains: filters.q, mode: "insensitive" } } },
      { seller: { displayName: { contains: filters.q, mode: "insensitive" } } },
      { product: { title: { contains: filters.q, mode: "insensitive" } } },
    ];
  }

  return where;
}

const RULE_ORDER: Record<CommissionSort, (order: "asc" | "desc") => Prisma.CommissionRuleOrderByWithRelationInput[]> = {
  // Scope order is alphabetical in SQL (CATEGORY, GLOBAL, PRODUCT, SELLER),
  // which is not the specificity order; the table sorts by scope then rate so
  // the grouping is at least stable and obvious.
  scope: (order) => [{ scope: order }, { updatedAt: "desc" }],
  rateBps: (order) => [{ rateBps: order }, { updatedAt: "desc" }],
  fixedPaise: (order) => [{ fixedPaise: order }, { updatedAt: "desc" }],
  updatedAt: (order) => [{ updatedAt: order }],
  createdAt: (order) => [{ createdAt: order }],
};

export async function listCommissionRules(
  params: ListParams & { sort: CommissionSort },
  filters: CommissionFilters,
): Promise<{ rows: CommissionRuleRow[]; meta: PageMeta; total: number }> {
  const where = buildCommissionWhere(filters);
  const [total, rules] = await Promise.all([
    db.commissionRule.count({ where }),
    db.commissionRule.findMany({
      where,
      select: RULE_SELECT,
      orderBy: RULE_ORDER[params.sort](params.order),
      skip: params.skip,
      take: params.pageSize,
    }),
  ]);

  return { rows: rules.map(toRuleRow), meta: buildPageMeta(total, params), total };
}

export async function commissionScopeCounts(
  filters: CommissionFilters,
): Promise<Record<CommissionScope, number> & { all: number }> {
  // The scope filter itself is dropped so a tab never shows 0 while holding rows.
  const where = buildCommissionWhere({ ...filters, scope: undefined });
  const grouped = await db.commissionRule.groupBy({ by: ["scope"], where, _count: { _all: true } });

  const counts = { GLOBAL: 0, CATEGORY: 0, SELLER: 0, PRODUCT: 0, all: 0 } as Record<CommissionScope, number> & {
    all: number;
  };
  for (const row of grouped) {
    counts[row.scope as CommissionScope] = row._count._all;
    counts.all += row._count._all;
  }
  return counts;
}

/** The single GLOBAL rule that every other rule falls back to. */
export async function getGlobalCommissionRule(): Promise<CommissionRuleRow | null> {
  const rule = await db.commissionRule.findUnique({
    where: { targetKey: commissionTargetKey("GLOBAL") },
    select: RULE_SELECT,
  });
  return rule ? toRuleRow(rule) : null;
}

export async function getMarketplaceCharges(): Promise<ChargeRowValues[]> {
  const rules = await loadChargeRules();
  return rules.map((rule) => ({
    code: rule.code,
    label: rule.label,
    type: rule.type,
    valueBps: rule.valueBps ?? null,
    valuePaise: rule.valuePaise ?? null,
    appliesWhen: rule.appliesWhen,
  }));
}

// ---------------------------------------------------------------------------
// "Resolve for a product" tester (B3)
// ---------------------------------------------------------------------------

export type ResolutionStep = {
  scope: CommissionScope;
  /** The key `resolveCommission` looks up at this step. */
  targetKey: string;
  label: string;
  rule: {
    id: string;
    rateBps: number;
    fixedPaise: number;
    isActive: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    note: string | null;
  } | null;
  /** True for the one step that actually won. */
  applied: boolean;
  /** Why a rule that exists did not win, e.g. "Outside its window". */
  skippedReason: string | null;
};

export type CommissionResolution = {
  product: { id: string; title: string; slug: string; href: Route };
  seller: { id: string; name: string; href: Route } | null;
  category: { id: string; name: string; path: string | null } | null;
  resolved: { rateBps: number; fixedPaise: number; ruleId: string | null; scope: CommissionScope };
  /** Most specific first: PRODUCT → SELLER → category leaf…root → GLOBAL. */
  chain: ResolutionStep[];
};

/**
 * Walks the same PRODUCT → SELLER → nearest CATEGORY ancestor → GLOBAL order
 * `resolveCommission` uses, but returns every step so an operator can see WHY
 * a product resolves the way it does - the single most common finance support
 * question ("why is this seller being charged 12%?").
 */
export async function resolveCommissionForProduct(
  productId: string,
  now: Date = new Date(),
): Promise<CommissionResolution | null> {
  const product = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      sellerId: true,
      categoryId: true,
      seller: { select: { id: true, displayName: true } },
      category: { select: { id: true, name: true, path: true } },
    },
  });
  if (!product) return null;

  const [resolved, ancestorIds, rules] = await Promise.all([
    resolveCommission(undefined, {
      productId: product.id,
      sellerId: product.sellerId,
      categoryId: product.categoryId,
      categoryPath: product.category?.path ?? null,
      now,
    }),
    categoryAncestorIds(db, {
      categoryId: product.categoryId,
      categoryPath: product.category?.path ?? null,
    }),
    db.commissionRule.findMany({
      select: {
        id: true,
        targetKey: true,
        rateBps: true,
        fixedPaise: true,
        isActive: true,
        startsAt: true,
        endsAt: true,
        note: true,
      },
    }),
  ]);

  const byKey = new Map(rules.map((rule) => [rule.targetKey, rule]));
  const categoryNames = new Map<string, string>();
  if (ancestorIds.length > 0) {
    const rows = await db.category.findMany({
      where: { id: { in: ancestorIds } },
      select: { id: true, name: true },
    });
    for (const row of rows) categoryNames.set(row.id, row.name);
  }

  const steps: Array<{ scope: CommissionScope; targetKey: string; label: string }> = [
    { scope: "PRODUCT", targetKey: commissionTargetKey("PRODUCT", product.id), label: product.title },
  ];
  if (product.sellerId) {
    steps.push({
      scope: "SELLER",
      targetKey: commissionTargetKey("SELLER", product.sellerId),
      label: product.seller?.displayName ?? "Seller",
    });
  }
  // Nearest ancestor first: categoryAncestorIds returns root → leaf.
  for (let index = ancestorIds.length - 1; index >= 0; index -= 1) {
    const id = ancestorIds[index];
    steps.push({
      scope: "CATEGORY",
      targetKey: commissionTargetKey("CATEGORY", id),
      label: categoryNames.get(id) ?? id,
    });
  }
  steps.push({ scope: "GLOBAL", targetKey: commissionTargetKey("GLOBAL"), label: "Every sale" });

  const chain: ResolutionStep[] = steps.map((step) => {
    const rule = byKey.get(step.targetKey) ?? null;
    let skippedReason: string | null = null;
    if (rule && rule.id !== resolved.ruleId) {
      if (!rule.isActive) skippedReason = "Inactive";
      else if (rule.startsAt && rule.startsAt > now) skippedReason = "Window has not started";
      else if (rule.endsAt && rule.endsAt < now) skippedReason = "Window has ended";
      else skippedReason = "A more specific rule won";
    }
    return {
      scope: step.scope,
      targetKey: step.targetKey,
      label: step.label,
      rule,
      applied: rule !== null && rule.id === resolved.ruleId,
      skippedReason,
    };
  });

  return {
    product: {
      id: product.id,
      title: product.title,
      slug: product.slug,
      href: `/admin/products/${product.id}` as Route,
    },
    seller: product.seller
      ? {
          id: product.seller.id,
          name: product.seller.displayName,
          href: `/admin/sellers/${product.seller.id}` as Route,
        }
      : null,
    category: product.category
      ? { id: product.category.id, name: product.category.name, path: product.category.path }
      : null,
    resolved,
    chain,
  };
}

// ---------------------------------------------------------------------------
// Commission summary for a date range (reads OrderItem snapshots)
// ---------------------------------------------------------------------------

export type SellerCommissionRow = {
  sellerId: string | null;
  sellerName: string;
  href: Route | null;
  lines: number;
  units: number;
  grossPaise: number;
  commissionPaise: number;
  chargesPaise: number;
  payablePaise: number;
  /** Commission ÷ gross, in bps; the rate actually realised, not the rule's. */
  effectiveRateBps: number;
};

export type CommissionSummary = {
  orders: number;
  lines: number;
  grossPaise: number;
  commissionPaise: number;
  chargesPaise: number;
  payablePaise: number;
  effectiveRateBps: number;
  sellers: SellerCommissionRow[];
};

/**
 * Σ commission / charges / seller payable per seller for a range, from the
 * OrderItem commission snapshots. CANCELLED lines and CANCELLED/FAILED orders
 * are excluded - they earned nobody anything - and platform-owned lines
 * (sellerId null) are grouped as one "Platform" row rather than dropped, so
 * the totals add up to what the orders actually contained.
 */
export async function commissionSummary(range: DateRange, limit = 12): Promise<CommissionSummary> {
  const where: Prisma.OrderItemWhereInput = {
    status: { not: "CANCELLED" },
    order: {
      placedAt: { gte: range.from, lte: range.to },
      status: { notIn: ["CANCELLED", "FAILED"] },
    },
  };

  const [grouped, orderCount, sellers] = await Promise.all([
    db.orderItem.groupBy({
      by: ["sellerId"],
      where,
      _sum: {
        quantity: true,
        commissionPaise: true,
        chargesPaise: true,
        sellerPayablePaise: true,
        lineTotalPaise: true,
      },
      _count: { _all: true },
    }),
    db.order.count({
      where: {
        placedAt: { gte: range.from, lte: range.to },
        status: { notIn: ["CANCELLED", "FAILED"] },
      },
    }),
    db.seller.findMany({ select: { id: true, displayName: true } }),
  ]);

  const names = new Map(sellers.map((seller) => [seller.id, seller.displayName]));

  const rows: SellerCommissionRow[] = grouped.map((row) => {
    const commissionPaise = row._sum.commissionPaise ?? 0;
    const chargesPaise = row._sum.chargesPaise ?? 0;
    const payablePaise = row._sum.sellerPayablePaise ?? 0;
    // sellerPayable = sellerGross − commission − charges (B3), so the gross the
    // commission was actually taken on is the sum of the three.
    const grossPaise = payablePaise + commissionPaise + chargesPaise;
    return {
      sellerId: row.sellerId,
      sellerName: row.sellerId ? (names.get(row.sellerId) ?? "Unknown seller") : "Platform",
      href: row.sellerId ? (`/admin/sellers/${row.sellerId}` as Route) : null,
      lines: row._count._all,
      units: row._sum.quantity ?? 0,
      grossPaise,
      commissionPaise,
      chargesPaise,
      payablePaise,
      effectiveRateBps: grossPaise > 0 ? Math.round((commissionPaise * 10000) / grossPaise) : 0,
    };
  });

  rows.sort((a, b) => b.commissionPaise - a.commissionPaise);

  const totals = rows.reduce(
    (sum, row) => ({
      lines: sum.lines + row.lines,
      grossPaise: sum.grossPaise + row.grossPaise,
      commissionPaise: sum.commissionPaise + row.commissionPaise,
      chargesPaise: sum.chargesPaise + row.chargesPaise,
      payablePaise: sum.payablePaise + row.payablePaise,
    }),
    { lines: 0, grossPaise: 0, commissionPaise: 0, chargesPaise: 0, payablePaise: 0 },
  );

  return {
    orders: orderCount,
    ...totals,
    effectiveRateBps:
      totals.grossPaise > 0 ? Math.round((totals.commissionPaise * 10000) / totals.grossPaise) : 0,
    sellers: rows.slice(0, limit),
  };
}

/** EntityPicker chip for `?product=` on the resolver card. */
export async function getCommissionFilterRefs(
  filters: CommissionFilters,
): Promise<{ product: { id: string; title: string; subtitle?: string } | null }> {
  if (!filters.productId) return { product: null };
  const product = await db.product.findFirst({
    where: { id: filters.productId, deletedAt: null },
    select: { id: true, title: true, slug: true },
  });
  return { product: product ? { id: product.id, title: product.title, subtitle: product.slug } : null };
}
