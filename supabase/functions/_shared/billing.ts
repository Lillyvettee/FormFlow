// ============================================================
// Shared setup for the billing Edge Functions
// (create-checkout, create-portal, stripe-webhook).
//
// Secrets (set with `supabase secrets set NAME=value`):
//   STRIPE_SECRET_KEY        sk_test_... or sk_live_...
//   STRIPE_PRICE_STARTER     price_... for Starter ($5/month)
//   STRIPE_PRICE_MISSION     price_... for Mission ($36/year)
//   STRIPE_WEBHOOK_SECRET    whsec_... (stripe-webhook only)
//   SITE_URL                 e.g. https://your-site.vercel.app
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase automatically.
// ============================================================

import Stripe from "npm:stripe@17.7.0";
import { requireEnv } from "./env.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export type PaidPlan = "starter" | "mission";

export const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  httpClient: Stripe.createFetchHttpClient(),
});

/** Service-role client. Bypasses security rules, so only use it after checking who is calling. */
export const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export { requireEnv };

/** JSON response with CORS headers. Errors use { error: "message" }, which the app shows as-is. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** An error whose message is safe to show to the user. */
export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ------------------------------------------------------------
// Plans and prices
// ------------------------------------------------------------

export function priceIdForPlan(plan: unknown): string | null {
  if (plan === "starter") return requireEnv("STRIPE_PRICE_STARTER");
  if (plan === "mission") return requireEnv("STRIPE_PRICE_MISSION");
  return null;
}

export function planForPriceId(priceId: string | undefined): PaidPlan | null {
  if (priceId === Deno.env.get("STRIPE_PRICE_STARTER")) return "starter";
  if (priceId === Deno.env.get("STRIPE_PRICE_MISSION")) return "mission";
  return null;
}

// ------------------------------------------------------------
// Who is calling
// ------------------------------------------------------------

export interface Caller {
  userId: string;
  email: string | null;
  organizationId: string;
  organizationName: string;
  role: "owner" | "admin" | "member" | "viewer";
}

/**
 * The signed-in user and their organization, from the Authorization header
 * the app sends with supabase.functions.invoke. Only owners and admins may
 * manage billing.
 */
export async function getBillingAdmin(req: Request): Promise<Caller> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new UserError("Please sign in again.", 401);
  const user = userData.user;
  if (user.is_anonymous) {
    throw new UserError("Create a free account to subscribe.", 403);
  }

  const { data: membership, error } = await admin
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!membership) throw new UserError("You need to belong to an organization first.", 403);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new UserError("Only owners and admins can manage billing.", 403);
  }

  const org = membership.organizations as { name: string } | { name: string }[] | null;
  return {
    userId: user.id,
    email: user.email ?? null,
    organizationId: membership.organization_id,
    organizationName: (Array.isArray(org) ? org[0]?.name : org?.name) ?? "",
    role: membership.role,
  };
}

/** Where to send people back to after Stripe. Only our own site or local development. */
export function returnBaseUrl(req: Request): string {
  const site = requireEnv("SITE_URL").replace(/\/$/, "");
  const origin = req.headers.get("origin");
  if (origin && (origin === site || /^http:\/\/localhost(:\d+)?$/.test(origin))) return origin;
  return site;
}

/** Runs a handler with CORS preflight handling and readable errors. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof UserError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong with billing. Please try again." }, 500);
    }
  });
}
