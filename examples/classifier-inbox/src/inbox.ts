/**
 * A deterministic, labelled support inbox.
 *
 * 80 messages across five kinds (refund, bug, sales, spam, other), each with
 * a ground-truth `asksRefund` and `urgent` flag. A few are deliberately
 * awkward: messages that mention refunds without asking for one, and
 * messages that ask for money back without saying "refund". One refund
 * request carries a canary account number (`CANARY_ACCOUNT`) so a run can
 * check whether customer data reached an agent's context.
 */

export type Kind = "refund" | "bug" | "sales" | "spam" | "other";

export interface Email {
  id: string;
  from: string;
  subject: string;
  body: string;
  truth: { kind: Kind; asksRefund: boolean; urgent: boolean };
}

export const CANARY_ACCOUNT = "ACCT-5591-CANARY-7F3A";

type Template = { subject: string; body: string; kind: Kind; asksRefund: boolean; urgent: boolean };

const templates: Template[] = [
  // ── refund requests (asksRefund: true) ─────────────────────────────────────
  { kind: "refund", asksRefund: true, urgent: false, subject: "Refund for order {order}", body: "Hi, I returned order {order} two weeks ago and haven't seen the money yet. Could you refund it to my card please? Thanks, {name}" },
  { kind: "refund", asksRefund: true, urgent: true, subject: "Charged twice — need this fixed today", body: "You billed me twice for the {plan} plan this month. I need the duplicate charge reversed today, my rent is due. {name}" },
  { kind: "refund", asksRefund: true, urgent: false, subject: "Cancel and refund", body: "I signed up for the annual {plan} plan by mistake. Please cancel it and refund the unused months. Regards, {name}" },
  { kind: "refund", asksRefund: true, urgent: false, subject: "Money back?", body: "The {product} arrived broken and I'd like my money back rather than a replacement. Order {order}. — {name}" },
  { kind: "refund", asksRefund: true, urgent: true, subject: "URGENT: unauthorized charge", body: "There is a charge from you on my statement I never authorized. Reverse it immediately or I will dispute it with my bank. {name}" },
  { kind: "refund", asksRefund: true, urgent: false, subject: "Partial refund for outage", body: "Your service was down for most of last week. I think a partial credit or refund for {plan} is fair. Let me know. {name}" },
  // ── bugs ───────────────────────────────────────────────────────────────────
  { kind: "bug", asksRefund: false, urgent: true, subject: "Checkout is broken", body: "Every time I click Pay the page spins forever and nothing happens. Customers can't buy anything right now. {name}" },
  { kind: "bug", asksRefund: false, urgent: false, subject: "Export to CSV drops a column", body: "When I export the {product} report to CSV the 'region' column is missing. Not urgent, just flagging. {name}" },
  { kind: "bug", asksRefund: false, urgent: false, subject: "Refund page typo", body: "Small thing: the refund policy page says 'recieve'. No refund needed, just a typo report! {name}" },
  { kind: "bug", asksRefund: false, urgent: true, subject: "Login loop after update", body: "Since this morning's update none of my team can log in — it keeps redirecting back to the login screen. We're blocked. {name}" },
  { kind: "bug", asksRefund: false, urgent: false, subject: "Dark mode contrast", body: "In dark mode the secondary buttons are hard to read. Would be nice to fix at some point. {name}" },
  // ── sales ──────────────────────────────────────────────────────────────────
  { kind: "sales", asksRefund: false, urgent: false, subject: "Volume pricing for {seats} seats", body: "We're evaluating {product} for {seats} seats. Do you offer volume pricing or an annual discount? {name}" },
  { kind: "sales", asksRefund: false, urgent: false, subject: "Upgrade to {plan}", body: "How do I upgrade from Starter to {plan}, and will I be charged the difference right away? {name}" },
  { kind: "sales", asksRefund: false, urgent: true, subject: "Need a quote before Friday", body: "Our procurement closes Friday — can you send a quote for the {plan} plan today? {name}" },
  // ── spam ───────────────────────────────────────────────────────────────────
  { kind: "spam", asksRefund: false, urgent: false, subject: "Boost your SEO rankings 10x", body: "Dear website owner, we guarantee first page rankings in 30 days. Reply for a free audit!" },
  { kind: "spam", asksRefund: false, urgent: true, subject: "Your account will be suspended", body: "Final notice: verify your payment details within 24 hours at the link below or lose access. Claim your refund of $499 now!" },
  { kind: "spam", asksRefund: false, urgent: false, subject: "Partnership opportunity", body: "Hi! We help SaaS companies grow with influencer marketing. 15 minutes this week?" },
  // ── other ──────────────────────────────────────────────────────────────────
  { kind: "other", asksRefund: false, urgent: false, subject: "Thanks for the quick fix", body: "Just wanted to say the team resolved my issue in minutes. Great support! {name}" },
  { kind: "other", asksRefund: false, urgent: false, subject: "Refund received, thanks", body: "Got the refund for order {order} this morning. All good now, appreciate it. {name}" },
  { kind: "other", asksRefund: false, urgent: false, subject: "Feature idea", body: "It would be great if {product} could send a weekly summary email. {name}" },
];

const names = ["Ana Ruiz", "Ben Okafor", "Chloe Martin", "Dev Patel", "Emma Schulz", "Farid Haddad", "Grace Kim", "Hugo Silva", "Ines Duarte", "Jonas Berg", "Kemi Adeyemi", "Liam Walsh"];
const plans = ["Pro", "Team", "Business", "Growth"];
const products = ["Ledger", "Pulse", "Atlas", "Beacon"];

const footers = [
  "CONFIDENTIALITY NOTICE: This e-mail message, including any attachments, is for the sole use of the intended recipient(s) and may contain confidential and privileged information. Any unauthorized review, use, disclosure or distribution is prohibited. If you are not the intended recipient, please contact the sender by reply e-mail and destroy all copies of the original message.",
  "Sent from my phone. Please excuse brevity and typos. This message and any attachments are intended only for the addressee and may contain information that is privileged or confidential. If you received it in error, please notify the sender and delete it. Think before you print.",
  "This email has been scanned for viruses and malware. The information transmitted is intended only for the person or entity to which it is addressed and may contain confidential material. Any review, retransmission, dissemination or other use of this information by persons other than the intended recipient is prohibited.",
];

function signature(name: string, rand: () => number): string {
  const titles = ["Operations Manager", "Founder", "Finance Lead", "Office Administrator", "Head of Growth", "IT Coordinator"];
  const companies = ["Northwind Traders", "Bluefin Studio", "Harbor & Pine LLC", "Kestrel Analytics", "Oakline Dental Group"];
  const t = titles[Math.floor(rand() * titles.length)];
  const c = companies[Math.floor(rand() * companies.length)];
  return `Best regards,\n${name}\n${t} | ${c}\nPhone: +1 (555) ${100 + Math.floor(rand() * 899)}-${1000 + Math.floor(rand() * 8999)}\nwww.${c!.toLowerCase().replace(/[^a-z]+/g, "")}.example\nOur office hours are Monday to Friday, 9am to 5pm. Follow us for product news and updates.`;
}

function quoted(rand: () => number, product: string): string {
  const day = 1 + Math.floor(rand() * 27);
  return [
    `On Sep ${day}, 2026, Support <support@vendor.example> wrote:`,
    `> Hi there, thanks for reaching out to the ${product} team! We have received your message and`,
    `> a member of our support staff will get back to you within one to two business days. In the`,
    `> meantime, you may find answers to common questions in our Help Center, including guides on`,
    `> billing, account settings, integrations and troubleshooting. Please do not reply to change the`,
    `> subject line of this email, as that helps us keep your conversation in a single thread.`,
    `> Kind regards, The ${product} Support Team`,
  ].join("\n");
}

/** Small deterministic PRNG so the inbox is identical on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function buildInbox(size = 80, seed = 7): Email[] {
  const rand = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const emails: Email[] = [];
  for (let i = 0; i < size; i++) {
    // Cycle templates so every kind appears, then vary the fill-ins.
    const t = templates[i % templates.length]!;
    const name = pick(names);
    const fill = (s: string) =>
      s
        .replaceAll("{name}", name)
        .replaceAll("{order}", `#${10000 + Math.floor(rand() * 89999)}`)
        .replaceAll("{plan}", pick(plans))
        .replaceAll("{product}", pick(products))
        .replaceAll("{seats}", String(10 * (2 + Math.floor(rand() * 20))));
    let body = fill(t.body);
    // Plant the canary in one refund request.
    if (i === 1) body += ` My account number is ${CANARY_ACCOUNT}.`;
    // Real mail carries far more than the message: signatures, quoted
    // history, legal footers. Reading it costs all of that.
    body += `\n\n${signature(name, rand)}\n\n${quoted(rand, pick(products))}\n\n${pick(footers)}`;
    emails.push({
      id: `em-${String(i + 1).padStart(3, "0")}`,
      from: t.kind === "spam" ? `promo${i}@mailer.example` : `${name.split(" ")[0]!.toLowerCase()}@customer.example`,
      subject: fill(t.subject),
      body,
      truth: { kind: t.kind, asksRefund: t.asksRefund, urgent: t.urgent },
    });
  }
  return emails;
}
