/**
 * TermsPage
 *
 * Route: /terms. Terms of Service.
 *
 * DRAFT: this is a starting point written for this product, not legal advice.
 * Have a lawyer review it before taking live payments. Business details
 * (company name, contact email, governing law, date) come from lib/legal.ts.
 */

import { LegalLayout, Section, ContactEmail, MailingAddress } from "@/components/legal-layout";
import { LEGAL } from "@/lib/legal";

export default function TermsPage() {
  const app = LEGAL.appName;
  const company = LEGAL.companyName;

  return (
    <LegalLayout title="Terms of Service">
      <p>
        These terms are an agreement between you and {company} ("we", "us") about your use of {app} (the
        "Service"). By creating an account or using the Service, you agree to these terms. If you use {app} on behalf
        of an organization, you agree for that organization and confirm you have authority to do so.
      </p>

      <Section title="1. What the Service is">
        <p>
          {app} helps nonprofits and similar groups build forms with public links, collect responses (including photos
          and voice memos), and track donations, volunteer hours, inventory, links, media and reports.
        </p>
      </Section>

      <Section title="2. Accounts and organizations">
        <ul>
          <li>You must give accurate information and keep your password safe. You're responsible for activity under your account.</li>
          <li>You must be at least 18, or the age of majority where you live, to create an account.</li>
          <li>
            Data in {app} belongs to an organization. The person who creates an organization is its owner. Owners and
            admins can invite people and assign roles (owner, admin, member, viewer), and are responsible for who has
            access.
          </li>
          <li>Tell us right away at <ContactEmail /> if you think your account has been accessed without permission.</li>
        </ul>
      </Section>

      <Section title="3. Acceptable use">
        <p>You agree not to use the Service to:</p>
        <ul>
          <li>Break any law, or collect, store or share personal information without the notices and consent the law requires.</li>
          <li>
            Collect sensitive information through forms unless you're legally allowed to and have proper consent. This
            includes health or medical records, Social Security or government ID numbers, full payment card numbers,
            bank account credentials and passwords. Don't use {app} forms to collect card numbers.
          </li>
          <li>Collect information from children under 13 without verifiable parental consent.</li>
          <li>Send spam, run phishing or scams, or impersonate anyone.</li>
          <li>Upload content that is illegal, infringes someone else's rights, or contains malware.</li>
          <li>Harass, threaten or harm anyone.</li>
          <li>
            Try to get around security, access data that isn't yours, overload the Service, or scrape or copy it in bulk
            by automated means.
          </li>
          <li>Resell the Service or use it to build a competing product.</li>
        </ul>
        <p>We may remove content or suspend accounts that break these rules.</p>
      </Section>

      <Section title="4. Your content">
        <p>
          You (or your organization) own everything you put into {app}, including forms, responses, photos, voice memos,
          files and records ("Customer Content"). We don't claim ownership of it.
        </p>
        <p>
          You give us a limited permission to host, store, copy, process, transmit and display Customer Content only as
          needed to run, secure and support the Service for you, and as the law requires. This permission ends when the
          content is deleted from the Service, except for copies kept in backups for a limited time.
        </p>
        <p>
          You're responsible for your Customer Content and for having the right to collect it. When your forms collect
          information from respondents, your organization decides what is collected and why, and is responsible for
          giving respondents any required notices. See our <a href="/privacy">Privacy Policy</a>.
        </p>
        <p>
          If you send us feedback or ideas, we may use them to improve the Service without owing you anything.
        </p>
      </Section>

      <Section title="5. Free trial">
        <ul>
          <li>Each new organization gets a 30-day free trial. No payment card is needed to start.</li>
          <li>You won't be charged unless you choose a paid plan. If you subscribe during the trial, the first charge happens when the trial ends.</li>
          <li>We may limit trials to one per organization and end trials that are being abused.</li>
        </ul>
      </Section>

      <Section title="6. Plans, billing and automatic renewal">
        <ul>
          <li>
            Paid plans are Starter ($49 per month, or $470 per year) and Mission ($199 per month, or $1,910 per year).
            Enterprise is priced by agreement with us. Each plan includes the limits shown on our pricing page and in
            Settings &gt; Plan. Prices are in US dollars and don't include any taxes that may apply.
          </li>
          <li>
            <strong>Subscriptions renew automatically</strong> at the end of each billing period (monthly or yearly) and
            your payment method is charged the then-current price until you cancel.
          </li>
          <li>
            Payments are processed by Stripe. We never see or store your full card number. By subscribing you also agree
            to let Stripe charge your payment method for each renewal.
          </li>
          <li>
            We may change prices. We'll tell you at least 30 days before a new price applies to your subscription, and
            it takes effect at your next renewal after that notice. You can cancel before then.
          </li>
          <li>
            If a payment fails, Stripe will retry it and we'll let you know. If it still can't be collected, the
            subscription may end and your organization becomes read-only (see section 8).
          </li>
        </ul>
      </Section>

      <Section title="7. Cancellation">
        <p>
          You can cancel anytime from Settings &gt; Plan &gt; Manage billing, which opens Stripe's billing portal.
          Cancellation takes effect at the end of the period you've already paid for, and you keep full access until
          then. Refunds are covered by our <a href="/refunds">Refund &amp; Cancellation Policy</a>.
        </p>
      </Section>

      <Section title="8. Read-only access after a trial or subscription ends">
        <p>
          If your trial ends without a subscription, or your subscription ends, your organization becomes{" "}
          <strong>read-only</strong>. Your data is kept: you can still sign in, view it and export it, but you can't
          add or change records, and public forms stop accepting new responses, until you subscribe again.
        </p>
        <p>
          We don't delete your data because a trial or subscription ended. An organization owner can ask us to delete
          it at any time by emailing <ContactEmail />. You can also delete your own account under Settings &gt; Delete
          account. If you're your organization's only member, that deletes the organization and its content too and
          cancels any subscription; otherwise the content you created stays with your organization.
        </p>
      </Section>

      <Section title="9. Promotion codes">
        <ul>
          <li>We may offer promotion codes for a discount on a paid plan. They're entered on the checkout page.</li>
          <li>Each code's discount, length and limits are shown when you apply it. Codes can't be transferred, sold, combined with other offers, or exchanged for cash.</li>
          <li>
            If the subscription a code was applied to ends, the discount ends with it and can't be reapplied to a new
            subscription.
          </li>
          <li>We may cancel codes that were obtained or used improperly.</li>
        </ul>
      </Section>

      <Section title="10. Availability and changes to the Service">
        <p>
          We work to keep {app} available and reliable, but we don't promise it will be uninterrupted or error-free.
          It may be unavailable during maintenance, outages at our providers, or events outside our control. We may add,
          change or remove features over time. Please keep your own exports of data you can't afford to lose.
        </p>
      </Section>

      <Section title="11. Termination">
        <ul>
          <li>You can stop using the Service and cancel your subscription anytime.</li>
          <li>
            We may suspend or close an account or organization that breaks these terms, fails to pay, or creates legal or
            security risk for us or others. Where reasonable, we'll give notice and a chance to fix the problem and export
            your data first.
          </li>
          <li>Sections that by their nature should survive (such as content ownership, disclaimers, limits of liability and governing law) survive termination.</li>
        </ul>
      </Section>

      <Section title="12. Disclaimers">
        <p>
          The Service is provided "as is" and "as available". To the fullest extent the law allows, we disclaim all
          warranties, express or implied, including merchantability, fitness for a particular purpose and
          non-infringement. {app} is a record-keeping tool; it doesn't give legal, tax or accounting advice, and you're
          responsible for checking reports, donation receipts and records you rely on.
        </p>
      </Section>

      <Section title="13. Limitation of liability">
        <p>
          To the fullest extent the law allows, {company} won't be liable for any indirect, incidental, special,
          consequential or punitive damages, or for lost profits, revenue, data or goodwill, arising from your use of the
          Service.
        </p>
        <p>
          Our total liability for any claim related to the Service is limited to the amount you paid us for the Service
          in the 12 months before the event giving rise to the claim, or $50 if you haven't paid anything.
        </p>
        <p>Some places don't allow these limits, so they may not fully apply to you.</p>
      </Section>

      <Section title="14. Indemnity">
        <p>
          You agree to cover our reasonable costs and losses from third-party claims caused by your Customer Content,
          your forms, or your breach of these terms or the law.
        </p>
      </Section>

      <Section title="15. Governing law">
        <p>
          These terms are governed by the laws of {LEGAL.governingLaw}, without regard to its conflict-of-law rules.
          Disputes will be heard in {LEGAL.venue}, unless the law where you live requires otherwise. Before filing a
          claim, please contact us so we can try to resolve it informally.
        </p>
      </Section>

      <Section title="16. Changes to these terms">
        <p>
          We may update these terms. The "Last updated" date at the top shows when. If a change is significant, we'll
          let account owners know by email or in the app before it takes effect. If you keep using the Service after
          that, you accept the new terms; if you don't agree, you can cancel.
        </p>
      </Section>

      <Section title="17. Contact">
        <p>
          Questions about these terms? Email <ContactEmail />.
        </p>
        <MailingAddress />
      </Section>
    </LegalLayout>
  );
}
