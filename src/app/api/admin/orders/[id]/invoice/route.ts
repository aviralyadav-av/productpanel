import { notFound } from "@/lib/api/errors";
import { apiOk, withAdminApi } from "@/lib/api/admin";

import { getOrderDetail, getStoreIdentity } from "@/features/orders/detail-queries";

/**
 * GET /api/admin/orders/:id/invoice -> { data: { store, order, lines, totals, payments } }
 * (orders.view)
 *
 * The JSON behind the printable invoice, for anyone generating a PDF outside
 * the admin. Every figure is the snapshot stored on the order, never a
 * recomputation, so a PDF built from this endpoint and the printed page can
 * never disagree.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const [order, store] = await Promise.all([getOrderDetail(params.id), getStoreIdentity()]);
    if (!order) throw notFound("Order");

    return apiOk({
      store: {
        name: store["store.name"],
        tagline: store["store.tagline"],
        address: store["store.address"],
        email: store["store.contact_email"],
        phone: store["store.contact_phone"],
      },
      order: {
        orderNumber: order.orderNumber,
        placedAt: order.placedAt,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        currency: order.currency,
        pricesIncludeTax: order.pricesIncludeTax,
        taxRemittedBy: order.taxRemittedBy,
        shippingMethodName: order.shippingMethodName,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        shippingAddress: order.shippingAddress,
        billingAddress: order.billingAddress,
      },
      lines: order.items
        .filter((item) => item.status !== "CANCELLED")
        .map((item) => ({
          title: item.titleSnapshot,
          variant: item.variantSnapshot,
          sku: item.skuSnapshot,
          hsnCode: item.hsnCodeSnapshot,
          quantity: item.quantity,
          unitPricePaise: item.unitPricePaise,
          customizationPaise: item.customizationPaise,
          discountPaise: item.discountPaise,
          taxRateBps: item.taxRateBps,
          taxPaise: item.taxPaise,
          lineTotalPaise: item.lineTotalPaise,
          customization: item.customization.map((entry) => ({ label: entry.label, value: entry.value })),
        })),
      totals: {
        subtotalPaise: order.subtotalPaise,
        discountPaise: order.discountPaise,
        couponCode: order.couponCode,
        couponDiscountPaise: order.couponDiscountPaise,
        shippingPaise: order.shippingPaise,
        codFeePaise: order.codFeePaise,
        taxPaise: order.taxPaise,
        totalPaise: order.totalPaise,
        paidPaise: order.paidPaise,
        refundedPaise: order.refundedPaise,
        balanceDuePaise: order.balanceDuePaise,
      },
      payments: order.payments
        .filter((payment) => payment.status === "SUCCEEDED")
        .map((payment) => ({
          provider: payment.provider,
          method: payment.method,
          reference: payment.providerPaymentId,
          amountPaise: payment.amountPaise,
          at: payment.capturedAt ?? payment.createdAt,
        })),
    });
  },
  { permission: "orders.view" },
);
