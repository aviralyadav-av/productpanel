import { z } from "zod";

import { db } from "@/lib/db";
import { effectivePricePaise } from "@/lib/money";
import { paiseToRupees } from "@/lib/money";
import { toPublicOrderStatus } from "@/lib/serializers/public";
import { publicError, publicJson } from "../_lib/response";

/**
 * POST /api/v1/orders
 *
 * This is the endpoint behind `// await createOrder(orderPayload)` in
 * OrderPage.jsx:144. Note that src/api/orderApi.js does not exist in the
 * storefront - creating that file is part of the cutover, not just uncommenting.
 *
 * THE ONE IMPORTANT DECISION HERE: prices are recomputed from the catalogue and
 * the client's totals are ignored.
 *
 * That is the security fix (a browser can otherwise post any total it likes) and
 * it also fixes a live bug: CartPage.jsx totals on `product.price` while the
 * product cards advertise `salePrice`, so all ten on-sale products are currently
 * billed at full price. Re-pricing server-side makes the charge match what the
 * shopper was shown. Both figures are stored - listPricePaise and
 * unitPricePaise - so discount analytics has something real to measure.
 *
 * The response echoes the legacy order shape so OrderReceipt.jsx and
 * MyOrders.jsx render it unchanged, including `status` as its display string.
 */

const orderSchema = z.object({
  shippingDetails: z.object({
    fullName: z.string().trim().min(1).max(120),
    email: z.email(),
    phone: z.string().trim().min(6).max(20),
    address: z.string().trim().min(1).max(400),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(80),
    pinCode: z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit PIN code"),
  }),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().nullish(),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(50),
  paymentMethod: z.enum(["COD", "ONLINE"]).default("COD"),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return publicError("Invalid JSON body", 400);
  }

  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) {
    return publicError(parsed.error.issues[0]?.message ?? "Invalid order", 422);
  }

  const { shippingDetails, items, paymentMethod } = parsed.data;

  const products = await db.product.findMany({
    where: {
      id: { in: [...new Set(items.map((item) => item.productId))] },
      status: "PUBLISHED",
      deletedAt: null,
    },
    include: { variants: true, images: { take: 1, orderBy: { position: "asc" }, include: { media: true } } },
  });

  const productById = new Map(products.map((product) => [product.id, product]));

  type OrderLine = {
    productId: string;
    variantId: string | null;
    titleSnapshot: string;
    variantSnapshot: string | null;
    skuSnapshot: string | null;
    imageUrl: string | null;
    listPricePaise: number;
    unitPricePaise: number;
    quantity: number;
    lineTotalPaise: number;
  };

  const lines: OrderLine[] = [];
  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product) {
      return publicError(`Product ${item.productId} is no longer available`, 409);
    }

    const variant =
      product.variants.find((candidate) => candidate.id === item.variantId) ??
      product.variants[0] ??
      null;

    const listPricePaise = variant?.pricePaise ?? product.pricePaise;
    const unitPricePaise = effectivePricePaise({
      pricePaise: listPricePaise,
      salePricePaise: variant?.salePricePaise ?? product.salePricePaise,
      saleStartsAt: product.saleStartsAt,
      saleEndsAt: product.saleEndsAt,
    });

    lines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      titleSnapshot: product.title,
      variantSnapshot: variant?.name ?? null,
      skuSnapshot: variant?.sku ?? null,
      imageUrl: product.images[0]?.media.url ?? null,
      listPricePaise,
      unitPricePaise,
      quantity: item.quantity,
      lineTotalPaise: unitPricePaise * item.quantity,
    });
  }

  const subtotalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);

  // The shipping rule is read from settings rather than hardcoded, so an
  // operator can change it once the storefront reads totals from this endpoint.
  const settings = await db.setting.findMany({
    where: { key: { in: ["shipping.freeThresholdPaise", "shipping.flatRatePaise"] } },
  });
  const threshold = Number(
    settings.find((s) => s.key === "shipping.freeThresholdPaise")?.value ?? 200000,
  );
  const flatRate = Number(
    settings.find((s) => s.key === "shipping.flatRatePaise")?.value ?? 10000,
  );
  const shippingPaise = subtotalPaise >= threshold ? 0 : flatRate;
  const totalPaise = subtotalPaise + shippingPaise;

  const orderNumber = `NIYA-${Date.now()}`;

  const order = await db.$transaction(async (tx) => {
    const customer = await tx.customer.upsert({
      where: { email: shippingDetails.email.toLowerCase() },
      update: {
        fullName: shippingDetails.fullName,
        phone: shippingDetails.phone,
      },
      create: {
        email: shippingDetails.email.toLowerCase(),
        fullName: shippingDetails.fullName,
        phone: shippingDetails.phone,
      },
    });

    const created = await tx.order.create({
      data: {
        orderNumber,
        customerId: customer.id,
        status: "PLACED",
        paymentStatus: "PENDING",
        paymentMethod,
        source: "STOREFRONT",
        subtotalPaise,
        shippingPaise,
        totalPaise,
        shipFullName: shippingDetails.fullName,
        shipEmail: shippingDetails.email,
        shipPhone: shippingDetails.phone,
        shipAddress: shippingDetails.address,
        shipCity: shippingDetails.city,
        shipState: shippingDetails.state,
        shipPinCode: shippingDetails.pinCode,
        items: { create: lines },
        events: {
          create: {
            type: "STATUS_CHANGE",
            toStatus: "PLACED",
            message: "Order placed from the storefront",
          },
        },
      },
      include: { items: true },
    });

    // Stock is decremented at placement, not at confirmation. With COD and no
    // payment gateway there is no later signal to hang it on, and an oversold
    // item is worse for this store than a briefly over-reserved one. Cancelling
    // restocks - see the order status action.
    for (const line of lines) {
      if (!line.variantId) continue;

      const inventory = await tx.inventoryItem.findUnique({
        where: { variantId: line.variantId },
      });
      if (!inventory) continue;

      const balance = inventory.onHand - line.quantity;
      await tx.inventoryItem.update({
        where: { variantId: line.variantId },
        data: { onHand: balance },
      });
      await tx.stockMovement.create({
        data: {
          variantId: line.variantId,
          delta: -line.quantity,
          type: "SALE",
          reason: `Order ${orderNumber}`,
          orderId: created.id,
          balance,
        },
      });
    }

    await tx.notification.create({
      data: {
        type: "NEW_ORDER",
        severity: "info",
        title: `New order ${orderNumber}`,
        body: `${shippingDetails.fullName} · ${lines.length} item${lines.length === 1 ? "" : "s"}`,
        entityType: "order",
        entityId: created.id,
        href: `/orders/${created.id}`,
      },
    });

    return created;
  });

  return publicJson(
    {
      orderId: order.orderNumber,
      status: toPublicOrderStatus(order.status),
      date: order.placedAt.toISOString(),
      paymentMethod: order.paymentMethod,
      shippingDetails,
      items: order.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        title: item.titleSnapshot,
        price: paiseToRupees(item.unitPricePaise),
        quantity: item.quantity,
        selectedVariant: item.variantSnapshot
          ? { name: item.variantSnapshot }
          : null,
      })),
      subtotal: paiseToRupees(order.subtotalPaise),
      shippingFee: paiseToRupees(order.shippingPaise),
      totalAmount: paiseToRupees(order.totalPaise),
    },
    { status: 201 },
  );
}
