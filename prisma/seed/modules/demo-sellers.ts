import type { Prisma, PrismaClient } from "@prisma/client";

import { encrypt } from "@/lib/crypto";
import { sanitizeHtml } from "@/lib/sanitize/html";
import type { SeedContext } from "./context";
import { documentSvg, heroBannerSvg, logoSvg, putDemoSvg } from "../lib/placeholders";
import { addDays, daysAgo } from "../lib/rng";
import { demoId, mediaId, registerMedia, state, type DemoSeller } from "../lib/state";

/**
 * Eight demo artisans (blueprint §12): five ACTIVE, one PENDING, one
 * UNDER_REVIEW, one SUSPENDED - with KYC documents (PRIVATE placeholder
 * files), encrypted bank accounts (D4, purpose "bank"), a status history
 * (C5) and a zero SellerBalance row the finance module later recomputes.
 *
 * Idempotent: sellers upsert on id; child rows use stable ids with
 * skipDuplicates. GSTIN/PAN values follow the real FORMAT but are fake.
 */
type SellerSpec = {
  n: number;
  slug: string;
  displayName: string;
  legalName: string;
  ownerName: string;
  email: string;
  phone: string;
  status: "ACTIVE" | "PENDING" | "UNDER_REVIEW" | "SUSPENDED";
  description: string;
  city: string;
  state: string;
  stateCode: string;
  pinCode: string;
  addressLine1: string;
  addressLine2?: string;
  pan: string;
  gstin?: string;
  hue: number;
  /** Days ago the seller registered. */
  registeredDaysAgo: number;
  bank?: BankSpec;
  secondBank?: BankSpec;
  suspensionReason?: string;
};

type BankSpec = { holder: string; bank: string; account: string; ifsc: string; upi?: string };

const SELLERS: SellerSpec[] = [
  {
    n: 1,
    slug: "kalakriti-studio",
    displayName: "Kalakriti Studio",
    legalName: "Kalakriti Handicrafts LLP",
    ownerName: "Meera Sharma",
    email: "hello@kalakriti.example.com",
    phone: "+919829012345",
    status: "ACTIVE",
    description:
      "<p>A family workshop in Jaipur making wall decor, wooden serveware, brass lamps and hand-poured candles. Every piece is finished by hand and signed by the maker.</p>",
    city: "Jaipur",
    state: "Rajasthan",
    stateCode: "08",
    pinCode: "302016",
    addressLine1: "14, Shilpgram Lane, Bani Park",
    pan: "AAECK4521F",
    gstin: "08AAECK4521F1Z3",
    hue: 22,
    registeredDaysAgo: 400,
    bank: { holder: "Kalakriti Handicrafts LLP", bank: "HDFC Bank", account: "50100234567891", ifsc: "HDFC0001234", upi: "kalakriti@hdfcbank" },
    secondBank: { holder: "Meera Sharma", bank: "State Bank of India", account: "31245678901", ifsc: "SBIN0004567" },
  },
  {
    n: 2,
    slug: "anokhi-threads",
    displayName: "Anokhi Threads",
    legalName: "Anokhi Threads Private Limited",
    ownerName: "Rahul Patel",
    email: "orders@anokhithreads.example.com",
    phone: "+919876543210",
    status: "ACTIVE",
    description:
      "<p>Handloom and hand-block-printed clothing from Ahmedabad: kurtas, sarees, dupattas and soft furnishings, woven and printed by artisan cooperatives in Kutch and Bagru.</p>",
    city: "Ahmedabad",
    state: "Gujarat",
    stateCode: "24",
    pinCode: "380009",
    addressLine1: "B-204, Textile Market, Ashram Road",
    pan: "AAFCA7789K",
    gstin: "24AAFCA7789K1ZP",
    hue: 335,
    registeredDaysAgo: 320,
    bank: { holder: "Anokhi Threads Private Limited", bank: "ICICI Bank", account: "002301567890", ifsc: "ICIC0000023", upi: "anokhi@icici" },
  },
  {
    n: 3,
    slug: "rangrez-jewels",
    displayName: "Rangrez Jewels",
    legalName: "Rangrez Jewels",
    ownerName: "Kavita Rathore",
    email: "kavita@rangrezjewels.example.com",
    phone: "+919414012345",
    status: "ACTIVE",
    description:
      "<p>Oxidised silver, meenakari and kundan jewellery made in a small Udaipur atelier. Designs are inspired by Rajasthani tribal forms and made in limited batches.</p>",
    city: "Udaipur",
    state: "Rajasthan",
    stateCode: "08",
    pinCode: "313001",
    addressLine1: "Shop 7, Bada Bazaar, Old City",
    pan: "BKRPR3345L",
    gstin: "08BKRPR3345L1Z9",
    hue: 42,
    registeredDaysAgo: 260,
    bank: { holder: "Kavita Rathore", bank: "Axis Bank", account: "917010045678123", ifsc: "UTIB0000456", upi: "rangrez@axisbank" },
  },
  {
    n: 4,
    slug: "mithila-art-house",
    displayName: "Mithila Art House",
    legalName: "Mithila Art House",
    ownerName: "Sunita Devi",
    email: "sunita@mithilaart.example.com",
    phone: "+917004567890",
    status: "ACTIVE",
    description:
      "<p>Original Madhubani and Warli paintings in natural pigments and acrylic, plus commissioned portraits. Sunita has painted for twenty-five years and trains women artists in her village.</p>",
    city: "Madhubani",
    state: "Bihar",
    stateCode: "10",
    pinCode: "847211",
    addressLine1: "Village Jitwarpur, Ward 6",
    pan: "CMDPD9012Q",
    hue: 262,
    registeredDaysAgo: 200,
    bank: { holder: "Sunita Devi", bank: "Punjab National Bank", account: "0123000100456789", ifsc: "PUNB0012300" },
  },
  {
    n: 5,
    slug: "paper-and-pine",
    displayName: "Paper & Pine",
    legalName: "Paper and Pine Studio",
    ownerName: "Arjun Nair",
    email: "studio@paperandpine.example.com",
    phone: "+919845098450",
    status: "ACTIVE",
    description:
      "<p>Handmade paper journals, planners and personalised gifts - mugs, frames, keychains - printed and finished in a Bengaluru studio. Most items ship within 48 hours.</p>",
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
    pinCode: "560034",
    addressLine1: "45, 5th Cross, Koramangala 4th Block",
    pan: "AAJFP2233M",
    gstin: "29AAJFP2233M1ZB",
    hue: 150,
    registeredDaysAgo: 150,
    bank: { holder: "Paper and Pine Studio", bank: "Kotak Mahindra Bank", account: "7811234567", ifsc: "KKBK0000811", upi: "paperpine@kotak" },
  },
  {
    n: 6,
    slug: "terracotta-tales",
    displayName: "Terracotta Tales",
    legalName: "Terracotta Tales",
    ownerName: "Debashish Roy",
    email: "debashish@terracottatales.example.com",
    phone: "+919830012345",
    status: "PENDING",
    description: "<p>Bankura horses, terracotta jewellery and planters from Bishnupur potters.</p>",
    city: "Kolkata",
    state: "West Bengal",
    stateCode: "19",
    pinCode: "700029",
    addressLine1: "21B, Southern Avenue",
    pan: "AHQPR5566D",
    hue: 15,
    registeredDaysAgo: 3,
  },
  {
    n: 7,
    slug: "nakshatra-crafts",
    displayName: "Nakshatra Crafts",
    legalName: "Nakshatra Crafts",
    ownerName: "Lakshmi Reddy",
    email: "lakshmi@nakshatracrafts.example.com",
    phone: "+919000123456",
    status: "UNDER_REVIEW",
    description: "<p>Kalamkari fabrics, Kondapalli toys and Pochampally ikat from Telangana and Andhra artisans.</p>",
    city: "Hyderabad",
    state: "Telangana",
    stateCode: "36",
    pinCode: "500034",
    addressLine1: "Plot 12, Road No. 3, Banjara Hills",
    pan: "BXNPR7788E",
    gstin: "36BXNPR7788E1Z2",
    hue: 300,
    registeredDaysAgo: 9,
    bank: { holder: "Lakshmi Reddy", bank: "State Bank of India", account: "20012345678", ifsc: "SBIN0020123" },
  },
  {
    n: 8,
    slug: "rustic-roots",
    displayName: "Rustic Roots",
    legalName: "Rustic Roots Decor",
    ownerName: "Vikram Joshi",
    email: "vikram@rusticroots.example.com",
    phone: "+919822012345",
    status: "SUSPENDED",
    description: "<p>Planters, baskets and garden decor in terracotta, jute and cane.</p>",
    city: "Pune",
    state: "Maharashtra",
    stateCode: "27",
    pinCode: "411038",
    addressLine1: "Shop 3, Karve Nagar",
    pan: "AAXFR9900H",
    gstin: "27AAXFR9900H1ZK",
    hue: 90,
    registeredDaysAgo: 220,
    bank: { holder: "Rustic Roots Decor", bank: "Bank of Baroda", account: "29870100012345", ifsc: "BARB0KARVEP" },
    suspensionReason: "Repeated late dispatch (SLA breached on 6 of the last 10 orders) and two unresolved quality complaints.",
  },
];

type DocumentSpec = { type: string; label: string; lines: string[] };

function documentsFor(spec: SellerSpec): DocumentSpec[] {
  const docs: DocumentSpec[] = [
    { type: "PAN", label: "PAN card", lines: [`Name: ${spec.legalName}`, `PAN: ${spec.pan}`] },
    { type: "BANK_PROOF", label: "Cancelled cheque", lines: [`Account holder: ${spec.bank?.holder ?? spec.ownerName}`, `Bank: ${spec.bank?.bank ?? "-"}`] },
    { type: "ADDRESS_PROOF", label: "Electricity bill", lines: [spec.addressLine1, `${spec.city}, ${spec.state} ${spec.pinCode}`] },
  ];
  if (spec.gstin) docs.splice(1, 0, { type: "GSTIN", label: "GST certificate", lines: [`GSTIN: ${spec.gstin}`, `Legal name: ${spec.legalName}`] });
  return docs;
}

function historyFor(spec: SellerSpec, registeredAt: Date): Array<{ from: string | null; to: string; message: string; daysAfter: number; byAdmin: boolean }> {
  const steps = [{ from: null as string | null, to: "PENDING", message: "Seller registration received.", daysAfter: 0, byAdmin: false }];
  if (spec.status === "PENDING") return steps;
  steps.push({ from: "PENDING", to: "UNDER_REVIEW", message: "Documents opened for review.", daysAfter: 1, byAdmin: true });
  if (spec.status === "UNDER_REVIEW") return steps;
  steps.push({ from: "UNDER_REVIEW", to: "APPROVED", message: "Application approved. Welcome email sent.", daysAfter: 3, byAdmin: true });
  steps.push({ from: "APPROVED", to: "ACTIVE", message: "Documents verified and primary bank account on file - listing enabled.", daysAfter: 4, byAdmin: true });
  if (spec.status === "SUSPENDED") {
    steps.push({ from: "ACTIVE", to: "SUSPENDED", message: spec.suspensionReason ?? "Suspended.", daysAfter: spec.registeredDaysAgo - 12, byAdmin: true });
  }
  void registeredAt;
  return steps;
}

export async function seedDemoSellers(db: PrismaClient, ctx: SeedContext): Promise<void> {
  const now = state.now;
  const folderSellers = mediaId("folder:demo/sellers");
  const folderDocuments = mediaId("folder:demo/documents");
  let documents = 0;
  let bankAccounts = 0;
  let events = 0;

  for (const spec of SELLERS) {
    const id = demoId("seller", spec.n);
    const registeredAt = daysAgo(now, spec.registeredDaysAgo);
    const history = historyFor(spec, registeredAt);
    const approved = history.find((step) => step.to === "APPROVED");
    const suspended = history.find((step) => step.to === "SUSPENDED");
    const initials = spec.displayName
      .split(/\s+/)
      .filter((word) => /^[A-Za-z]/.test(word))
      .map((word) => word[0])
      .join("")
      .slice(0, 2);

    const logo = await putDemoSvg(db, {
      id: demoId("media_seller_logo", spec.n),
      key: `demo/sellers/${spec.slug}-logo.svg`,
      svg: logoSvg({ initials, hue: spec.hue }),
      folderId: folderSellers,
      alt: `${spec.displayName} logo`,
      width: 400,
      height: 400,
      uploadedById: ctx.adminUserId,
    });
    const banner = await putDemoSvg(db, {
      id: demoId("media_seller_banner", spec.n),
      key: `demo/sellers/${spec.slug}-banner.svg`,
      svg: heroBannerSvg({
        heading: spec.displayName,
        subheading: `${spec.city}, ${spec.state} · handmade since forever`,
        hue: spec.hue,
        eyebrow: "Artisan",
      }),
      folderId: folderSellers,
      alt: `${spec.displayName} shop banner`,
      width: 1600,
      height: 600,
      uploadedById: ctx.adminUserId,
    });
    registerMedia(`seller-logo:${spec.n}`, logo.id, logo.url);
    registerMedia(`seller-banner:${spec.n}`, banner.id, banner.url);

    await db.seller.upsert({
      where: { id },
      update: {},
      create: {
        id,
        slug: spec.slug,
        displayName: spec.displayName,
        legalName: spec.legalName,
        ownerName: spec.ownerName,
        email: spec.email,
        phone: spec.phone,
        status: spec.status,
        description: sanitizeHtml(spec.description, "basic"),
        logoMediaId: logo.id,
        bannerMediaId: banner.id,
        addressLine1: spec.addressLine1,
        addressLine2: spec.addressLine2 ?? null,
        city: spec.city,
        state: spec.state,
        pinCode: spec.pinCode,
        country: "IN",
        gstin: spec.gstin ?? null,
        pan: spec.pan,
        approvedAt: approved ? addDays(registeredAt, approved.daysAfter) : null,
        approvedById: approved ? ctx.adminUserId : null,
        suspendedAt: suspended ? addDays(registeredAt, suspended.daysAfter) : null,
        suspensionReason: suspended ? spec.suspensionReason ?? null : null,
        lastActiveAt: spec.status === "ACTIVE" ? daysAgo(now, spec.n) : registeredAt,
        createdAt: registeredAt,
      },
    });

    // ---- documents (PRIVATE placeholder files) --------------------------------
    const verified = spec.status === "ACTIVE" || spec.status === "SUSPENDED";
    for (const [index, doc] of documentsFor(spec).entries()) {
      const media = await putDemoSvg(db, {
        id: demoId("media_doc", spec.n, doc.type.toLowerCase()),
        key: `demo/documents/${spec.slug}-${doc.type.toLowerCase()}.svg`,
        svg: documentSvg({ title: `${doc.label} — ${spec.displayName}`, lines: doc.lines }),
        folderId: folderDocuments,
        alt: `${doc.label} for ${spec.displayName}`,
        width: 800,
        height: 1100,
        visibility: "PRIVATE",
        uploadedById: null,
      });
      // The address proof of the newest active seller is still pending, so the
      // documents screen has a mixed list to review.
      const status = verified && !(spec.n === 5 && doc.type === "ADDRESS_PROOF") ? "VERIFIED" : "PENDING";
      await db.sellerDocument.upsert({
        where: { id: demoId("sellerdoc", spec.n, index + 1) },
        update: {},
        create: {
          id: demoId("sellerdoc", spec.n, index + 1),
          sellerId: id,
          type: doc.type,
          label: doc.label,
          mediaId: media.id,
          status,
          note: status === "VERIFIED" ? "Checked against the registry." : null,
          reviewedById: status === "VERIFIED" ? ctx.adminUserId : null,
          reviewedAt: status === "VERIFIED" ? addDays(registeredAt, 2) : null,
          createdAt: addDays(registeredAt, 0.5),
        },
      });
      documents += 1;
    }

    // ---- bank accounts (encrypted, D4) ----------------------------------------
    const banks = [spec.bank, spec.secondBank].filter((bank): bank is BankSpec => Boolean(bank));
    for (const [index, bank] of banks.entries()) {
      const bankId = demoId("bank", spec.n, index + 1);
      const exists = await db.sellerBankAccount.findUnique({ where: { id: bankId }, select: { id: true } });
      if (exists) continue;
      await db.sellerBankAccount.create({
        data: {
          id: bankId,
          sellerId: id,
          accountHolder: bank.holder,
          bankName: bank.bank,
          accountNumberEnc: encrypt(bank.account, "bank"),
          accountNumberLast4: bank.account.slice(-4),
          ifsc: bank.ifsc,
          upiId: bank.upi ?? null,
          isPrimary: index === 0,
          isVerified: verified,
          createdAt: addDays(registeredAt, 1),
        },
      });
      bankAccounts += 1;
    }

    // ---- status history (C5) --------------------------------------------------
    const eventRows: Prisma.SellerEventCreateManyInput[] = history.map((step, index) => ({
      id: demoId("sellerevent", spec.n, index + 1),
      sellerId: id,
      fromStatus: step.from,
      toStatus: step.to,
      message: step.message,
      actorId: step.byAdmin ? ctx.adminUserId : null,
      createdAt: addDays(registeredAt, step.daysAfter),
    }));
    const created = await db.sellerEvent.createMany({ data: eventRows, skipDuplicates: true });
    events += created.count;

    await db.sellerBalance.upsert({ where: { sellerId: id }, update: {}, create: { sellerId: id } });
  }

  const rows = await db.seller.findMany({
    where: { id: { startsWith: "demo_seller_" } },
    select: { id: true, slug: true, displayName: true, status: true, city: true, state: true, email: true },
    orderBy: { id: "asc" },
  });
  state.sellers = rows satisfies DemoSeller[];
  ctx.log(`sellers: ${rows.length} (documents ${documents}, bank accounts ${bankAccounts}, events created ${events})`);
}
