import { NextResponse } from "next/server";
import {
  handleStripeEvent,
  verifyStripeSignature,
} from "@/lib/billing/service";

// Stripe → "checkout.session.completed" records the card payment on the invoice. Signed with STRIPE_WEBHOOK_SECRET.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 503 },
    );
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret))
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  try {
    await handleStripeEvent(JSON.parse(raw));
  } catch (e) {
    console.error("stripe webhook", e);
    return NextResponse.json(
      { error: "Couldn't record the payment" },
      { status: 500 },
    ); // Stripe retries
  }
  return NextResponse.json({ received: true });
}
