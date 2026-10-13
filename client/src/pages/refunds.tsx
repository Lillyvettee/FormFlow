/**
 * RefundsPage
 *
 * Route: /refunds. Refund & Cancellation Policy.
 *
 * DRAFT: this is a starting point written for this product, not legal advice.
 * Have a lawyer review it before taking live payments. Business details
 * (contact email, date) come from lib/legal.ts.
 */

import { LegalLayout, Section, ContactEmail, MailingAddress } from "@/components/legal-layout";
import { LEGAL } from "@/lib/legal";

export default function RefundsPage() {
  const app = LEGAL.appName;

  return (
    <LegalLayout title="Refund & Cancellation Policy">
      <p>
        This policy explains how cancellations and refunds work for {app} subscriptions. It's part of our{" "}
        <a href="/terms">Terms of Service</a>.
      </p>

      <Section title="1. Try it free first">
        <p>
          Every organization starts with a 30-day free trial, and no card is needed. You aren't charged anything until
          the trial ends, and only if you've chosen a paid plan. If you subscribe during the trial, the first charge
          happens when the trial ends.
        </p>
      </Section>

      <Section title="2. Plans and automatic renewal">
        <ul>
          <li><strong>Starter</strong>: $5 per month, billed monthly.</li>
          <li><strong>Mission</strong>: $36 per year, billed yearly.</li>
        </ul>
        <p>
          Both plans renew automatically at the end of each billing period until you cancel. Stripe sends a receipt for
          each charge.
        </p>
      </Section>

      <Section title="3. How to cancel">
        <p>
          An owner or admin can cancel anytime: go to <strong>Settings &gt; Plan &gt; Manage billing</strong>, which
          opens Stripe's billing portal, and cancel the subscription there. You don't need to contact us.
        </p>
        <p>
          Cancellation takes effect at the end of the period you've already paid for. You keep full access until then,
          and you won't be charged again.
        </p>
      </Section>

      <Section title="4. Refunds">
        <ul>
          <li>
            <strong>Partial periods.</strong> We don't give prorated refunds for unused time in a month or year, except
            where the law requires it.
          </li>
          <li>
            <strong>Mission (yearly) renewals.</strong> If your yearly plan renews and you didn't mean to keep it, ask for
            a refund within <strong>14 days of the renewal charge</strong> and we'll refund that charge in full and
            cancel the subscription.
          </li>
          <li>
            <strong>Mistakes on our side.</strong> If you were charged twice or charged in error, we'll refund the
            incorrect amount.
          </li>
        </ul>
        <p>Approved refunds go back to the original payment method, usually within 5 to 10 business days.</p>
      </Section>

      <Section title="5. How to request a refund">
        <p>
          Email <ContactEmail /> from the address on your account and include your organization name, the date and
          amount of the charge, and the reason. We reply within a few business days.
        </p>
      </Section>

      <Section title="6. Failed payments">
        <p>
          If a renewal payment fails, Stripe will retry it over the following days and we'll let you know so you can
          update your card in Manage billing. If the payment still can't be collected, the subscription ends and your
          organization becomes read-only.
        </p>
      </Section>

      <Section title="7. Your data after cancellation">
        <p>
          When a subscription ends, your organization's data is kept, not deleted. It becomes <strong>read-only</strong>:
          you can still sign in, view and export everything, but you can't add or change records, and public forms stop
          accepting new responses. Subscribe again anytime to pick up where you left off. If you'd like your data
          deleted, email <ContactEmail />.
        </p>
      </Section>

      <Section title="8. Demo discount">
        <p>
          A 50% demo discount lasts as long as the subscription it was applied to. If that subscription is canceled and
          ends, the discount ends too and can't be reused.
        </p>
      </Section>

      <Section title="9. Contact">
        <p>
          Questions about billing? Email <ContactEmail />.
        </p>
        <MailingAddress />
      </Section>
    </LegalLayout>
  );
}
