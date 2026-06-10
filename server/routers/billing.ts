/**
 * Billing router — Stripe subscriptions
 * tRPC procedures: createCheckoutSession, createPortalSession
 * Express route: POST /api/billing/webhook  (registered in _core/index.ts)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { ENV } from "../_core/env";
import type { Express, Request, Response } from "express";

// ─── Stripe singleton ─────────────────────────────────────────────────────────

function getStripe() {
  if (!ENV.stripeSecretKey) return null;
  // Dynamic import to avoid crashing if stripe not configured
  const Stripe = require("stripe");
  return new Stripe(ENV.stripeSecretKey, { apiVersion: "2025-05-28.basil" });
}

// Plan slug → Stripe Price ID
const PLAN_PRICE_IDS: Record<string, string> = {
  creator: ENV.stripeCreatorPriceId,
  pro:     ENV.stripeProPriceId,
  agency:  ENV.stripeAgencyPriceId,
};

// Stripe Price ID → plan slug (reverse map for webhooks)
function planFromPriceId(priceId: string): string | null {
  for (const [slug, id] of Object.entries(PLAN_PRICE_IDS)) {
    if (id && id === priceId) return slug;
  }
  return null;
}

// ─── tRPC router ─────────────────────────────────────────────────────────────

export const billingRouter = router({

  // Create a Stripe Checkout Session → return the URL to redirect to
  createCheckoutSession: protectedProcedure
    .input(z.object({ plan: z.enum(["creator", "pro", "agency"]) }))
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      if (!stripe) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Stripe non configuré. Contactez l'administrateur." });

      const priceId = PLAN_PRICE_IDS[input.plan];
      if (!priceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Prix Stripe manquant pour le plan ${input.plan}. Contactez l'administrateur.` });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const userRow = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const u = userRow[0];
      if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable" });

      // Reuse existing Stripe customer if already created
      let customerId: string | undefined = u.stripeCustomerId || undefined;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: u.email || undefined,
          name: u.name || undefined,
          metadata: { userId: String(u.id) },
        });
        customerId = customer.id;
        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, u.id));
      }

      const baseUrl = ENV.appBaseUrl.replace(/\/$/, "");

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/billing?success=1&plan=${input.plan}`,
        cancel_url: `${baseUrl}/billing?cancelled=1`,
        metadata: { userId: String(u.id), plan: input.plan },
        subscription_data: {
          metadata: { userId: String(u.id), plan: input.plan },
        },
      });

      return { url: session.url };
    }),

  // Open the Stripe Customer Portal (manage / cancel subscription)
  createPortalSession: protectedProcedure
    .mutation(async ({ ctx }) => {
      const stripe = getStripe();
      if (!stripe) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Stripe non configuré." });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const userRow = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const u = userRow[0];
      if (!u?.stripeCustomerId) throw new TRPCError({ code: "NOT_FOUND", message: "Aucun abonnement Stripe trouvé." });

      const baseUrl = ENV.appBaseUrl.replace(/\/$/, "");

      const portal = await stripe.billingPortal.sessions.create({
        customer: u.stripeCustomerId,
        return_url: `${baseUrl}/billing`,
      });

      return { url: portal.url };
    }),

  // Get current subscription info
  getSubscription: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const userRow = await db.select({
        plan: users.plan,
        stripeSubscriptionId: users.stripeSubscriptionId,
        subscriptionStatus: users.subscriptionStatus,
        currentPeriodEnd: users.currentPeriodEnd,
        stripeCustomerId: users.stripeCustomerId,
      }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
      return userRow[0] || null;
    }),
});

// ─── Stripe Webhook handler (Express route, NOT tRPC) ─────────────────────────

export function registerBillingRoutes(app: Express) {
  // Raw body needed for Stripe signature verification
  app.post(
    "/api/billing/webhook",
    (req: Request, res: Response, next) => {
      // express.json() runs before — we need raw body here
      // Handled by express.raw() middleware registered before this route
      next();
    },
    async (req: Request, res: Response) => {
      const stripe = getStripe();
      if (!stripe) {
        res.status(200).json({ received: true }); // silently ignore if not configured
        return;
      }

      const sig = req.headers["stripe-signature"] as string;
      if (!sig || !ENV.stripeWebhookSecret) {
        res.status(400).json({ error: "Missing signature" });
        return;
      }

      let event: any;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, ENV.stripeWebhookSecret);
      } catch (err: any) {
        console.error("[Stripe webhook] Signature verification failed:", err.message);
        res.status(400).json({ error: `Webhook Error: ${err.message}` });
        return;
      }

      const db = await getDb();
      if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

      try {
        switch (event.type) {

          case "checkout.session.completed": {
            const session = event.data.object as any;
            const userId = parseInt(session.metadata?.userId || "0");
            const plan = session.metadata?.plan as string;
            if (!userId || !plan) break;

            await db.update(users).set({
              plan: plan as any,
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
              subscriptionStatus: "active",
            }).where(eq(users.id, userId));

            console.log(`[Stripe] User ${userId} upgraded to ${plan}`);
            break;
          }

          case "customer.subscription.updated": {
            const sub = event.data.object as any;
            const userId = parseInt(sub.metadata?.userId || "0");
            if (!userId) break;

            const priceId = sub.items?.data?.[0]?.price?.id as string;
            const newPlan = planFromPriceId(priceId) || undefined;
            const periodEnd = sub.current_period_end
              ? new Date(sub.current_period_end * 1000)
              : undefined;

            await db.update(users).set({
              ...(newPlan ? { plan: newPlan as any } : {}),
              subscriptionStatus: sub.status,
              stripeSubscriptionId: sub.id,
              ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
            }).where(eq(users.id, userId));

            console.log(`[Stripe] Subscription updated for user ${userId}: ${sub.status}`);
            break;
          }

          case "customer.subscription.deleted": {
            const sub = event.data.object as any;
            const userId = parseInt(sub.metadata?.userId || "0");
            if (!userId) break;

            await db.update(users).set({
              plan: "free",
              subscriptionStatus: "cancelled",
              stripeSubscriptionId: null,
              currentPeriodEnd: null,
            }).where(eq(users.id, userId));

            console.log(`[Stripe] Subscription cancelled for user ${userId} → downgraded to free`);
            break;
          }

          default:
            // Ignore other events
            break;
        }
      } catch (err: any) {
        console.error("[Stripe webhook] Handler error:", err.message);
        res.status(500).json({ error: "Internal error" });
        return;
      }

      res.json({ received: true });
    }
  );
}
