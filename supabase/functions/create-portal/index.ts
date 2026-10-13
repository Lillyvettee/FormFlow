// ============================================================
// create-portal
//
// Opens Stripe's billing portal for the caller's organization, where owners
// and admins can update the card, see invoices, switch plans or cancel.
// Returns { url }.
// ============================================================

import { admin, getBillingAdmin, json, returnBaseUrl, serve, stripe, UserError } from "../_shared/billing.ts";

serve(async (req) => {
  const caller = await getBillingAdmin(req);

  const { data: billing, error } = await admin
    .from("organization_billing")
    .select("stripe_customer_id")
    .eq("organization_id", caller.organizationId)
    .single();
  if (error) throw error;
  if (!billing.stripe_customer_id) throw new UserError("Your organization hasn't subscribed yet.");

  const session = await stripe.billingPortal.sessions.create({
    customer: billing.stripe_customer_id,
    return_url: `${returnBaseUrl(req)}/settings`,
  });

  return json({ url: session.url });
});
