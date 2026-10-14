/**
 * PrivacyPage
 *
 * Route: /privacy. Privacy Policy.
 *
 * DRAFT: this is a starting point written for this product, not legal advice.
 * Have a lawyer review it before taking live payments. Business details
 * (company name, contact email, date) come from lib/legal.ts. Keep the
 * subprocessor list in sync with the services the app actually uses, and
 * update effectiveDate there whenever this page changes.
 */

import { LegalLayout, Section, ContactEmail, MailingAddress } from "@/components/legal-layout";
import { LEGAL } from "@/lib/legal";

/** Third parties that process data for us. */
const SUBPROCESSORS = [
  { name: "Supabase", purpose: "Database, sign-in and file storage (form responses, people records, photos, voice memos and other records)" },
  { name: "Stripe", purpose: "Subscription billing, promotion codes and payment processing" },
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
            <strong>Customer Content</strong>: everything an organization stores in {app}. This includes responses that
            people ("respondents") submit through the organization's forms; records about the people the organization
            serves ("participants") and their progress over time; and donation, volunteer, fundraising goal, inventory and
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
          subscription, such as the plan, payment status and card brand and last four digits. Promotion codes are entered
          on Stripe's checkout page. Stripe's use of your information is covered by its own privacy policy.
        </p>
      </Section>

      <Section title="3. Information about respondents and participants">
        <p>
          When someone fills out an organization's form, we store what they submit (answers, photos, voice memos and
          other files) for that organization, along with the time of submission. Forms can be shared as a link or
          embedded on the organization's own website. What a form asks for is up to the organization that created it.
        </p>
        <p>
          <strong>People records and progress over time.</strong> An organization can keep a record for each person it
          serves, such as their name, contact details, program, start date, status and staff notes. It can send a person
          a personal link to a form. Answers sent through that link are added to that person's record, so the
          organization can see how their answers change from one check-in to the next (for example, "confidence went
          from 2 to 4"). Answers sent through a form's ordinary link aren't connected to anyone. Everyone on the
          organization's team can see its people records.
        </p>
        <p>
          <strong>Personal links.</strong> A personal link contains a private code that identifies the person it was
          made for. Anyone who has the link can submit answers that will be added to that person's record, so
          organizations should send it only to that person. The organization can turn old links off at any time.
        </p>
        <p>
          If you responded to a form, or an organization keeps a record about you, and you have a question about your
          information or want it corrected or deleted, please contact that organization. They control that information.
          If you contact us, we'll pass your request to them and help them respond.
        </p>
        <p>Organizations are responsible for giving respondents and participants any notices and getting any consent the law requires.</p>
        <p>
          <strong>Sensitive information.</strong> {app} isn't designed to store health information protected by HIPAA,
          substance use treatment records covered by 42 CFR Part 2, or other information that requires special legal
          safeguards. Organizations shouldn't use {app} for that information unless we've agreed otherwise in writing.
        </p>
      </Section>

      <Section title="4. Sharing reports with funders">
        <p>
          An organization's owners and admins can create a private link to a live, read-only report for a funder or
          grant maker (a "funder portal"). They choose which sections and time period it shows.
        </p>
        <ul>
          <li>
            Funder reports show <strong>totals, trends, fundraising goals and outcome summaries only</strong>, such as
            "$12,400 raised", "320 volunteer hours" or "71% of participants improved". They never show the names, contact
            details or individual answers of donors, volunteers, respondents or participants.
          </li>
          <li>
            Anyone with the link can view the report without signing in. We record how many times it's viewed and when it
            was last viewed, and show this to the organization. We don't record who viewed it.
          </li>
          <li>The organization can pause or delete a funder link at any time, and the report stops being available.</li>
          <li>When a group is very small, a total or percentage can still hint at individuals. Organizations should keep this in mind when choosing what to share.</li>
        </ul>
      </Section>

      <Section title="5. How we use information">
        <ul>
          <li>To provide, maintain and secure the Service, including signing you in and storing your organization's data.</li>
          <li>To manage trials, subscriptions, promotion codes and billing.</li>
          <li>To send service emails: account confirmation, password resets, team invitations, trial and billing reminders, and important changes. These aren't marketing and you can't opt out of them while you have an account.</li>
          <li>To answer your questions and feedback.</li>
          <li>To prevent fraud and abuse, and to meet legal obligations.</li>
          <li>To understand and improve the Service in aggregate. We don't look at Customer Content except to support you when you ask, to keep the Service secure, or when the law requires it.</li>
        </ul>
      </Section>

      <Section title="6. Who we share information with">
        <p>We share information only with the providers that help us run {app} (our subprocessors):</p>
        <ul>
          {SUBPROCESSORS.map((sub) => (
            <li key={sub.name}>
              <strong>{sub.name}</strong>: {sub.purpose}.
            </li>
          ))}
        </ul>
        <p>
          They may only use the information to provide their services to us. We also share information when an
          organization tells us to, for example through a funder portal (section 4) or a public form. We may share
          information if the law requires it, to protect people's safety or our rights, or as part of a merger or sale
          of the business (in which case this policy would continue to apply to your information).
        </p>
        <p>Information may be stored and processed in the United States.</p>
      </Section>

      <Section title="7. Cookies and local storage">
        <p>
          We don't use advertising or tracking cookies. {app} stores a small amount of information in your browser only
          to:
        </p>
        <ul>
          <li>Keep you signed in.</li>
          <li>Remember your light or dark theme and display preferences (for example, a list or grid view).</li>
        </ul>
        <p>
          Forms embedded on an organization's website don't set tracking cookies. Stripe's checkout and billing pages set
          their own cookies to process payments and prevent fraud.
        </p>
      </Section>

      <Section title="8. How long we keep information">
        <ul>
          <li>Account information is kept while your account exists.</li>
          <li>
            Customer Content is kept while the organization exists, including after a trial or subscription ends, when
            the organization becomes read-only. It's deleted when the organization's owner asks us to delete it, or
            when the organization's only member deletes their account.
          </li>
          <li>
            When an organization deletes a person's record, their past form answers stay with the organization but are
            no longer connected to that person.
          </li>
          <li>Deleted data may remain in backups for a limited time before being overwritten.</li>
          <li>We keep billing records as long as tax and accounting laws require.</li>
        </ul>
      </Section>

      <Section title="9. Security">
        <p>
          Data is encrypted in transit (HTTPS). Access is limited by organization and role, so members only see their
          own organization's data. Personal links and funder links use long random codes that can't practically be
          guessed. Payment details are handled entirely by Stripe.
        </p>
        <p>
          <strong>Uploaded files.</strong> Photos, voice memos and other files submitted through forms, and logos added
          to forms, are stored at long, hard-to-guess web addresses so they can be displayed. Anyone who has a file's
          exact address can open it, so organizations should only share those addresses with people who should see them.
        </p>
        <p>
          No system is perfectly secure, so please use a strong password and keep it private. If we learn of a breach
          affecting your information, we'll notify you as the law requires.
        </p>
      </Section>

      <Section title="10. Your rights and choices">
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
        <p>
          If you're a respondent or participant, the organization that collected your information handles these requests
          (see section 3).
        </p>
      </Section>

      <Section title="11. Children">
        <p>
          {app} isn't directed to children under 13, and we don't knowingly collect their personal information for our
          own purposes. Account holders must be adults.
        </p>
        <p>
          Organizations sometimes use forms and people records with young people, such as youth programs. When an
          organization collects information about a minor, the organization is responsible for getting consent from a
          parent or guardian as the law requires (including under COPPA for children under 13). If you believe a child's
          information was collected without proper consent, contact the organization, or email us and we'll help.
        </p>
      </Section>

      <Section title="12. Changes to this policy">
        <p>
          We may update this policy. The "Last updated" date at the top shows when. If a change is significant, we'll let
          account owners know by email or in the app before it takes effect.
        </p>
      </Section>

      <Section title="13. Contact">
        <p>
          Questions or requests about privacy? Email <ContactEmail />.
        </p>
        <MailingAddress />
      </Section>
    </LegalLayout>
  );
}
