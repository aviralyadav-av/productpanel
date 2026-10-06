import type { PrismaClient } from "@prisma/client";

import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey } from "../../../src/lib/enums";
import type { SeedContext } from "./context";

/**
 * One EmailTemplate per key in §4.9 + E3. `variables` is the documented set for
 * that event; the template editor warns on any other `{{var}}`. Bodies are
 * plain, brand-neutral HTML the admin is expected to restyle.
 *
 * On re-seed only `variables` and `name` are refreshed - edited copy is kept.
 */
type TemplateSeed = {
  name: string;
  subject: string;
  variables: string[];
  html: string;
  text: string;
};

const COMMON = ["store_name", "store_url", "support_email"];

function layout(body: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#222">
  <h1 style="font-size:20px;margin:0 0 16px">{{store_name}}</h1>
  ${body}
  <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#777">Questions? Write to <a href="mailto:{{support_email}}">{{support_email}}</a> · <a href="{{store_url}}">{{store_url}}</a></p>
</div>`;
}

const TEMPLATES: Record<EmailTemplateKey, TemplateSeed> = {
  welcome: {
    name: "Welcome",
    subject: "Welcome to {{store_name}}, {{customer_name}}",
    variables: [...COMMON, "customer_name"],
    html: layout(`<p>Hi {{customer_name}},</p><p>Thanks for joining {{store_name}}. Every piece here is handmade by an independent Indian artisan, and many can be personalised just for you.</p><p><a href="{{store_url}}">Start exploring</a></p>`),
    text: "Hi {{customer_name}},\n\nThanks for joining {{store_name}}. Every piece is handmade by an independent Indian artisan.\n\nStart exploring: {{store_url}}",
  },
  order_confirmation: {
    name: "Order confirmation",
    subject: "Order {{order_id}} confirmed",
    variables: [...COMMON, "customer_name", "order_id", "order_total", "order_items_html", "order_url", "payment_method"],
    html: layout(`<p>Hi {{customer_name}},</p><p>We have received your order <strong>{{order_id}}</strong>. Payment method: {{payment_method}}.</p>{{order_items_html}}<p><strong>Total: {{order_total}}</strong></p><p><a href="{{order_url}}">Track your order</a></p>`),
    text: "Hi {{customer_name}},\n\nWe have received your order {{order_id}} ({{payment_method}}).\nTotal: {{order_total}}\n\nTrack it: {{order_url}}",
  },
  payment_confirmation: {
    name: "Payment received",
    subject: "Payment received for order {{order_id}}",
    variables: [...COMMON, "customer_name", "order_id", "amount", "transaction_id", "order_url"],
    html: layout(`<p>Hi {{customer_name}},</p><p>We received your payment of <strong>{{amount}}</strong> for order {{order_id}} (transaction {{transaction_id}}).</p><p><a href="{{order_url}}">View your order</a></p>`),
    text: "Hi {{customer_name}},\n\nWe received {{amount}} for order {{order_id}} (transaction {{transaction_id}}).\n\n{{order_url}}",
  },
  order_shipped: {
    name: "Order shipped",
    subject: "Your order {{order_id}} is on its way",
    variables: [...COMMON, "customer_name", "order_id", "carrier", "tracking_number", "tracking_url", "eta", "order_url"],
    html: layout(`<p>Hi {{customer_name}},</p><p>Your order {{order_id}} has been shipped with {{carrier}}.</p><p>Tracking number: <strong>{{tracking_number}}</strong><br>Expected delivery: {{eta}}</p><p><a href="{{tracking_url}}">Track the shipment</a> · <a href="{{order_url}}">View your order</a></p>`),
    text: "Hi {{customer_name}},\n\nOrder {{order_id}} has shipped with {{carrier}}.\nTracking: {{tracking_number}} ({{tracking_url}})\nExpected: {{eta}}",
  },
  order_delivered: {
    name: "Order delivered",
    subject: "Order {{order_id}} delivered",
    variables: [...COMMON, "customer_name", "order_id", "order_url", "review_url"],
    html: layout(`<p>Hi {{customer_name}},</p><p>Your order {{order_id}} has been delivered. We hope you love it.</p><p><a href="{{review_url}}">Leave a review</a> · <a href="{{order_url}}">View your order</a></p>`),
    text: "Hi {{customer_name}},\n\nOrder {{order_id}} has been delivered.\nLeave a review: {{review_url}}",
  },
  order_cancelled: {
    name: "Order cancelled",
    subject: "Order {{order_id}} cancelled",
    variables: [...COMMON, "customer_name", "order_id", "cancel_reason", "order_url"],
    html: layout(`<p>Hi {{customer_name}},</p><p>Your order {{order_id}} has been cancelled.</p><p>Reason: {{cancel_reason}}</p><p>If you paid online, the refund will follow in a separate email.</p>`),
    text: "Hi {{customer_name}},\n\nOrder {{order_id}} has been cancelled.\nReason: {{cancel_reason}}",
  },
  return_approved: {
    name: "Return approved",
    subject: "Return {{rma_number}} approved",
    variables: [...COMMON, "customer_name", "order_id", "rma_number", "pickup_date", "order_url"],
    html: layout(`<p>Hi {{customer_name}},</p><p>Your return request <strong>{{rma_number}}</strong> for order {{order_id}} has been approved.</p><p>Pickup is scheduled for {{pickup_date}}. Please keep the item packed and ready.</p>`),
    text: "Hi {{customer_name}},\n\nReturn {{rma_number}} (order {{order_id}}) is approved. Pickup: {{pickup_date}}.",
  },
  refund_processed: {
    name: "Refund processed",
    subject: "Refund of {{refund_amount}} for order {{order_id}}",
    variables: [...COMMON, "customer_name", "order_id", "refund_amount", "refund_method", "refund_number"],
    html: layout(`<p>Hi {{customer_name}},</p><p>A refund of <strong>{{refund_amount}}</strong> for order {{order_id}} has been processed via {{refund_method}} (reference {{refund_number}}).</p><p>It can take 5–7 working days to reflect in your account.</p>`),
    text: "Hi {{customer_name}},\n\nRefund {{refund_number}} of {{refund_amount}} for order {{order_id}} was processed via {{refund_method}}.",
  },
  seller_registration_received: {
    name: "Seller registration received",
    subject: "We received your seller application",
    variables: [...COMMON, "seller_name"],
    html: layout(`<p>Hi {{seller_name}},</p><p>Thanks for applying to sell on {{store_name}}. Our team reviews every application and will get back to you within a few working days.</p>`),
    text: "Hi {{seller_name}},\n\nThanks for applying to sell on {{store_name}}. We will review your application shortly.",
  },
  seller_approved: {
    name: "Seller approved",
    subject: "Your seller account is approved",
    variables: [...COMMON, "seller_name", "seller_url"],
    html: layout(`<p>Hi {{seller_name}},</p><p>Congratulations - your seller account on {{store_name}} has been approved. Once your documents are verified and a bank account is on file, your products go live.</p><p><a href="{{seller_url}}">Open your seller area</a></p>`),
    text: "Hi {{seller_name}},\n\nYour seller account on {{store_name}} is approved.\n{{seller_url}}",
  },
  seller_rejected: {
    name: "Seller application declined",
    subject: "Update on your seller application",
    variables: [...COMMON, "seller_name", "reason"],
    html: layout(`<p>Hi {{seller_name}},</p><p>We are unable to approve your seller application at this time.</p><p>Reason: {{reason}}</p><p>You are welcome to reply to this email with more information.</p>`),
    text: "Hi {{seller_name}},\n\nWe could not approve your application.\nReason: {{reason}}",
  },
  seller_password_reset: {
    name: "Seller password reset",
    subject: "Reset your seller password",
    variables: [...COMMON, "seller_name", "reset_url", "expires_minutes"],
    html: layout(`<p>Hi {{seller_name}},</p><p>Use the link below to set a new password. It expires in {{expires_minutes}} minutes.</p><p><a href="{{reset_url}}">Reset password</a></p>`),
    text: "Hi {{seller_name}},\n\nReset your password (expires in {{expires_minutes}} minutes): {{reset_url}}",
  },
  customer_password_reset: {
    name: "Customer password reset",
    subject: "Reset your {{store_name}} password",
    variables: [...COMMON, "customer_name", "reset_url", "expires_minutes"],
    html: layout(`<p>Hi {{customer_name}},</p><p>Use the link below to set a new password. It expires in {{expires_minutes}} minutes. If you did not ask for this, ignore this email.</p><p><a href="{{reset_url}}">Reset password</a></p>`),
    text: "Hi {{customer_name}},\n\nReset your password (expires in {{expires_minutes}} minutes): {{reset_url}}",
  },
  password_reset: {
    name: "Password reset (generic)",
    subject: "Reset your password",
    variables: [...COMMON, "name", "reset_url", "expires_minutes"],
    html: layout(`<p>Hi {{name}},</p><p>Use the link below to set a new password. It expires in {{expires_minutes}} minutes.</p><p><a href="{{reset_url}}">Reset password</a></p>`),
    text: "Hi {{name}},\n\nReset your password (expires in {{expires_minutes}} minutes): {{reset_url}}",
  },
  admin_password_reset: {
    name: "Admin password reset",
    subject: "Reset your {{store_name}} admin password",
    variables: [...COMMON, "name", "reset_url", "expires_minutes"],
    html: layout(`<p>Hi {{name}},</p><p>A password reset was requested for your admin account. The link expires in {{expires_minutes}} minutes and can be used once.</p><p><a href="{{reset_url}}">Reset password</a></p><p>If you did not request this, tell a super-admin.</p>`),
    text: "Hi {{name}},\n\nReset your admin password (expires in {{expires_minutes}} minutes): {{reset_url}}",
  },
  admin_invite: {
    name: "Admin invite",
    subject: "You have been invited to the {{store_name}} admin",
    variables: [...COMMON, "name", "inviter_name", "role_name", "invite_url", "expires_hours"],
    html: layout(`<p>Hi {{name}},</p><p>{{inviter_name}} has invited you to the {{store_name}} admin as <strong>{{role_name}}</strong>.</p><p><a href="{{invite_url}}">Set your password</a> (link valid for {{expires_hours}} hours)</p>`),
    text: "Hi {{name}},\n\n{{inviter_name}} invited you to the {{store_name}} admin as {{role_name}}.\nSet your password: {{invite_url}}",
  },
  contact_ack: {
    name: "Contact acknowledgement",
    subject: "We received your message",
    variables: [...COMMON, "name", "subject", "ticket_id"],
    html: layout(`<p>Hi {{name}},</p><p>Thanks for getting in touch about "{{subject}}". Your reference is <strong>{{ticket_id}}</strong>. We reply within one working day.</p>`),
    text: "Hi {{name}},\n\nWe received your message about \"{{subject}}\" (ref {{ticket_id}}). We reply within one working day.",
  },
  newsletter_welcome: {
    name: "Newsletter welcome",
    subject: "You're on the list",
    variables: [...COMMON, "name", "unsubscribe_url"],
    html: layout(`<p>Hi {{name}},</p><p>You are subscribed to {{store_name}} updates: new makers, new arrivals and festive collections.</p><p style="font-size:12px;color:#777"><a href="{{unsubscribe_url}}">Unsubscribe</a></p>`),
    text: "Hi {{name}},\n\nYou are subscribed to {{store_name}} updates.\nUnsubscribe: {{unsubscribe_url}}",
  },
};

export async function seedTemplates(db: PrismaClient, ctx: SeedContext) {
  for (const key of EMAIL_TEMPLATE_KEYS) {
    const template = TEMPLATES[key];
    await db.emailTemplate.upsert({
      where: { key },
      update: { name: template.name, variables: template.variables },
      create: {
        key,
        name: template.name,
        subject: template.subject,
        htmlBody: template.html,
        textBody: template.text,
        variables: template.variables,
        isActive: true,
        updatedById: ctx.adminUserId,
      },
    });
  }
  ctx.log(`email templates: ${EMAIL_TEMPLATE_KEYS.length}`);
}
