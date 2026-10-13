/**
 * PrivacyPage
 *
 * Route: /privacy. Privacy Policy.
 *
 * DRAFT: this is a starting point written for this product, not legal advice.
 * Have a lawyer review it before taking live payments. Business details
 * (company name, contact email, date) come from lib/legal.ts. Keep the
 * subprocessor list in sync with the services the app actually uses.
 */

import { LegalLayout, Section, ContactEmail, MailingAddress } from "@/components/legal-layout";
import { LEGAL } from "@/lib/legal";

/** Third parties that process data for us. */
const SUBPROCESSORS = [
  { name: "Supabase", purpose: "Database, sign-in and file storage (form responses, photos, voice memos and records)" },
  { name: "Stripe", purpose: "Subscription billing and payment processing" },
  { name: "Resend", purpose: "Sending emails such as sign-up confirmations, password resets, invitations and billing reminders" },
  { name: "Vercel", purpose: "Hosting the website and app" },
];

export default function PrivacyPage() {
  const app = LEGAL.appName;
  const company = LEGAL.companyName;

  return (
    <LegalLayout title="Privacy Policy">
      <p>
        This policy explains what information {company} ("we", "us") collects when you use {app}, how we use it, and
        the choices you have. We don't sell personal information, and we don't use it for advertising.
      </p>

      <Section title="1. Two kinds of information">
        <ul>
          <li>
            <strong>Account information</strong> about the people who sign up and use {app} to run their organization.
            We decide how this is used, as described below.
          </li>
          <li>
            <strong>Customer Content</strong>: everything an organization stores in {app}, including responses that
            people ("respondents") submit through the organization's public forms, plus donation, volunteer, inventory and
            media records. The organization decides what to collect and why. For this information we act as a{" "}
            <strong>service provider (processor)</strong> for the organization, and only use it to provide the Service to
            them.
          </li>
        </ul>
      </Section>

      <Section title="2. Information from account holders">
        <ul>
          <li>Name, email address, password (stored only as a secure hash) and organization name.</li>
          <li>Your organization, team members, roles and invitations.</li>
          <li>Plan and billing status, such as trial dates, plan, renewal dates and whether a payment succeeded.</li>
          <li>Messages you send us, such as feedback and support requests.</li>
          <li>Basic technical information needed to run and secure the Service, such as IP address, browser type and request logs.</li>
        </ul>
        <p>
          <strong>Payment details.</strong> Payments are handled by Stripe. Your card number and bank details go
          directly to Stripe; {app} never sees or stores them. Stripe shares with us only what we need to manage your
          subscription, such as the plan, payment status and card brand and last four digits. Stripe's use of your
          information is covered by its own privacy policy.
        </p>
      </Section>

      <Section title="3. Information from form respondents">
        <p>
          When someone fills out an organization's form, we store what they submit (answers, photos, voice memos and
          other files) for that organization, along with the time of submission. What a form asks for is up to the
          organization that created it.
        </p>
        <p>
          If you responded to a form and have a question about your information, or want it corrected or deleted,
          please contact the organization that owns the form. They control that information. If you contact us, we'll
          pass your request to them and help them respond.
        </p>
        <p>Organizations are responsible for giving respondents any notices and getting any consent the law requires.</p>
      </Section>

      <Section title="4. How we use information">
        <ul>
          <li>To provide, maintain and secure the Service, including signing you in and storing your organization's data.</li>
          <li>To manage trials, subscriptions, discount codes and billing.</li>
          <li>To send service emails: account confirmation, password resets, team invitations, trial and billing reminders, and important changes. These aren't marketing and you can't opt out of them while you have an account.</li>
          <li>To answer your questions and feedback.</li>
          <li>To prevent fraud and abuse, and to meet legal obligations.</li>
          <li>To understand and improve the Service in aggregate. We don't look at Customer Content except to support you when you ask, to keep the Service secure, or when the law requires it.</li>
        </ul>
      </Section>

      <Section title="5. Who we share information with">
        <p>We share information only with the providers that help us run {app} (our subprocessors):</p>
        <ul>
          {SUBPROCESSORS.map((sub) => (
            <li key={sub.name}>
              <strong>{sub.name}</strong>: {sub.purpose}.
            </li>
          ))}
        </ul>
        <p>
          They may only use the information to provide their services to us. We may also share information if the law
          requires it, to protect people's safety or our rights, or as part of a merger or sale of the business (in
          which case this policy would continue to apply to your information).
        </p>
        <p>Information may be stored and processed in the United States.</p>
      </Section>

      <Section title="6. Cookies and local storage">
        <p>
          We don't use advertising or tracking cookies. {app} stores a small amount of information in your browser only
          to:
        </p>
        <ul>
          <li>Keep you signed in.</li>
          <li>Remember your light or dark theme and display preferences (for example, a list or grid view).</li>
          <li>Remember a demo discount code, so it's ready when you choose a plan.</li>
        </ul>
        <p>Stripe's checkout and billing pages set their own cookies to process payments and prevent fraud.</p>
      </Section>

      <Section title="7. How long we keep information">
        <ul>
          <li>Account information is kept while your account exists.</li>
          <li>
            Customer Content is kept while the organization exists, including after a trial or subscription ends, when
            the organization becomes read-only. It's deleted when the organization's owner asks us to delete it, or
            when the organization's only member deletes their account.
          </li>
          <li>Deleted data may remain in backups for a limited time before being overwritten.</li>
          <li>We keep billing records as long as tax and accounting laws require.</li>
        </ul>
      </Section>

      <Section title="8. Security">
        <p>
          Data is encrypted in transit (HTTPS). Access is limited by organization and role, so members only see their
          own organization's data. Payment details are handled entirely by Stripe. No system is perfectly secure, so
          please use a strong password and keep it private. If we learn of a breach affecting your information, we'll
          notify you as the law requires.
        </p>
      </Section>

      <Section title="9. Your rights and choices">
        <p>Depending on where you live, you may have the right to:</p>
        <ul>
          <li>Access the personal information we have about you, or get a copy of it.</li>
          <li>Correct information that's wrong.</li>
          <li>Delete your account and personal information.</li>
          <li>Object to or limit certain uses of your information.</li>
        </ul>
        <p>
          You can view and update much of your information in the app, export your organization's data, and delete your
          account under Settings &gt; Delete account (we email you a link to confirm). For anything
          else, email <ContactEmail />. We'll respond within 30 days, or sooner if the law requires. We may need to
          confirm your identity first. We won't treat you differently for exercising these rights.
        </p>
      </Section>

      <Section title="10. Children">
        <p>
          {app} isn't directed to children under 13, and we don't knowingly collect their personal information for our
          own purposes. Account holders must be adults.
        </p>
        <p>
          Organizations sometimes use forms with young people, such as youth programs. When an organization collects
          information about a minor, the organization is responsible for getting consent from a parent or guardian as the
          law requires (including under COPPA for children under 13). If you believe a child's information was collected
          without proper consent, contact the organization, or email us and we'll help.
        </p>
      </Section>

      <Section title="11. Changes to this policy">
        <p>
          We may update this policy. The "Last updated" date at the top shows when. If a change is significant, we'll let
          account owners know by email or in the app before it takes effect.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>
          Questions or requests about privacy? Email <ContactEmail />.
        </p>
        <MailingAddress />
      </Section>
    </LegalLayout>
  );
}
