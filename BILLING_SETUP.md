# Billing setup

How to turn on the 30-day free trial, the Starter, Mission and Enterprise plans, and promotion codes.
Do the steps in order. Stay in Stripe **test mode** until step 8, so no real money moves.

| What | Where it lives |
|---|---|
| Trial, read-only mode | `supabase/migrations/004_billing.sql` |
| Checkout, billing portal, Stripe webhook, trial reminders | `supabase/functions/` |
| Daily reminder schedule | `supabase/migrations/005_trial_reminders.sql` |
| Prices, limits and features (app) | `client/src/lib/plans.ts` |
| Limits enforced by the database, Enterprise inquiries | `supabase/migrations/016_plans_and_limits.sql` |
| Plan section in Settings | `client/src/components/plan-section.tsx` |
| Enterprise "Contact us" form | `client/src/pages/enterprise.tsx`, `supabase/functions/enterprise-inquiry/` |
| Trial / read-only banner | `client/src/components/billing-banner.tsx` |

## 1. Update the database (before pushing the app)

The new app code reads the billing table, so run the SQL **before** Vercel deploys the new code, or signed-in pages will show "Couldn't load your organization".

In the Supabase dashboard, open **SQL Editor** and run each file, in order:

1. `supabase/migrations/003_shared_media_and_signup_fix.sql`
2. `supabase/migrations/004_billing.sql`
3. `supabase/migrations/006_branding_and_demo_data.sql` (public form branding)
4. `supabase/migrations/007_account_deletion.sql` (keeps a team's records when a member deletes their account)
5. `supabase/migrations/008_sample_data.sql` (the dashboard's "Load sample data" button; removes the old guest demo and its codes)
6. `supabase/migrations/009_fundraising_goals.sql` (fundraising goals with progress bars on the Reports page)
7. `supabase/migrations/010_people_outcomes_funder_portals.sql` (People, outcome tracking and funder portals)
8. `supabase/migrations/011_custom_fields.sql` (Customize fields on Donations, Volunteer hours, Inventory, Links and People)
9. `supabase/migrations/012_services_and_case_notes.sql` (Help given, case notes and duplicate warnings on People)
10. `supabase/migrations/013_form_notifications.sql` (email alerts and confirmations for form responses; also deploy `form-notify` in step 4)
11. `supabase/migrations/014_private_form_uploads.sql` (private storage for form photos and voice memos, and upload limits)
12. `supabase/migrations/015_people_access_and_history.sql` (who can see People, and a change history for admins)
13. `supabase/migrations/016_plans_and_limits.sql` (plan limits, monthly PDF report counts, Starter branding lock, Enterprise inquiries)
14. `supabase/migrations/017_feedback_and_staff_inbox.sql` (the feedback table, and the staff-only Inbox at /admin)
15. `supabase/migrations/018_join_with_existing_organization.sql` (accepting an invitation when you already have your own organization; also deploy `join-organization` in step 4)
16. `supabase/migrations/019_media_bucket.sql` (creates the "media" storage bucket used by the Media library and form logos; fixes "Bucket not found")
17. `supabase/migrations/020_funder_portal_options.sql` (edit funder links; on Mission and Enterprise: filters, section order and notes, branding, expiry dates and passwords)
18. `supabase/migrations/021_restore_form_access_rules.sql` (puts back the access rules for forms and responses; fixes "Form not found" and empty form lists if they were removed)
19. `supabase/migrations/022_id_cards_and_scanning.sql` (ID cards for people, inventory barcodes and the Scan page; Mission and Enterprise)

`005_trial_reminders.sql` comes later, in step 6.

Every existing organization's 30 days start when you run 004.

## 2. Create a Stripe account and products

1. Sign up at https://dashboard.stripe.com/register. Keep the **Test mode** switch on.
2. **Product catalog > Add product**:
   - Name `Starter`, with two recurring prices: **$49.00 per month** and **$470.00 per year**. Copy both price IDs (`price_...`).
   - Name `Mission`, with two recurring prices: **$199.00 per month** and **$1,910.00 per year**. Copy both price IDs.
   - Enterprise has no product here. See "Enterprise" under How it behaves.
3. Optional, for discounts: **Product catalog > Coupons > New**. Choose the discount and how long it lasts (for example 50%, Forever). Then, on the coupon, **Add promotion code** and type the code customers will enter (for example `LAUNCH50`). You can limit it to first-time customers, a number of uses or an expiry date. Customers enter it on the checkout page; no app changes are needed for new codes.
4. **Settings > Billing > Customer portal**: activate it. Allow updating payment methods, viewing invoices and canceling. Under "Switch plans", add both products with both of their prices, so customers can move between plans and between monthly and yearly.
5. **Developers > API keys**: copy the **Secret key** (`sk_test_...`).

## 3. Set up email

1. Sign up at https://resend.com.
2. **API Keys > Create API key**. Copy it (`re_...`).

Resend's built-in sender (`onboarding@resend.dev`) can only send to the address you signed up with. **Trial reminder and account deletion emails go to customers, so they need your own domain**:

3. **Domains > Add domain**. Add the DNS records Resend shows you, where your domain is managed. Wait until it says Verified.
4. Choose a sender on that domain, for example `HumMotion <info@hummotion.com>`. You'll set it as `NOTIFY_FROM` in step 4.

Until `NOTIFY_FROM` is set, the reminder job runs but sends nothing. Its log says why.

### Password reset email (required)

Email security scanners (Outlook Safe Links on Microsoft 365, Mimecast and others) open every link in an email to check it. Supabase's default reset link works only once, so the scanner uses it up and the person sees "This reset link has expired". Change the template so the link only works after the person presses **Continue**:

1. Supabase: **Authentication > Emails > Templates > Reset Password** (older dashboards: Authentication > Email Templates).
2. Replace the link in the message body with:

   ```html
   <a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a>
   ```

3. **Authentication > URL Configuration**: set **Site URL** to the live site (e.g. `https://your-site.vercel.app`) and add `https://your-site.vercel.app/reset-password` under **Redirect URLs**.

Old links already sitting in inboxes keep working until they expire.

## 4. Deploy the server functions

In a terminal in this folder:

```sh
npx supabase login
npx supabase link --project-ref dmboosigttutyqaujdjv

npx supabase secrets set STRIPE_SECRET_KEY=sk_test_...
npx supabase secrets set STRIPE_PRICE_STARTER_MONTHLY=price_...
npx supabase secrets set STRIPE_PRICE_STARTER_YEARLY=price_...
npx supabase secrets set STRIPE_PRICE_MISSION_MONTHLY=price_...
npx supabase secrets set STRIPE_PRICE_MISSION_YEARLY=price_...
npx supabase secrets set SITE_URL=https://your-site.vercel.app
npx supabase secrets set RESEND_API_KEY=re_...
npx supabase secrets set "NOTIFY_FROM=HumMotion <info@hummotion.com>"
npx supabase secrets set CRON_SECRET=paste-a-long-random-value

npx supabase functions deploy create-checkout
npx supabase functions deploy create-portal
npx supabase functions deploy stripe-webhook --no-verify-jwt
npx supabase functions deploy trial-reminders --no-verify-jwt
npx supabase functions deploy request-account-deletion
npx supabase functions deploy confirm-account-deletion --no-verify-jwt
npx supabase functions deploy form-notify --no-verify-jwt
npx supabase functions deploy enterprise-inquiry --no-verify-jwt
npx supabase functions deploy join-organization
```

Enterprise requests are emailed to info@hummotion.com. To send them somewhere else, run `npx supabase secrets set ENTERPRISE_NOTIFY_TO=sales@example.org` (comma-separate several addresses).

If you already had the old $5 and $36 prices set as `STRIPE_PRICE_STARTER` and `STRIPE_PRICE_MISSION`, leave them set: existing subscriptions on those prices keep their plan. New checkouts use the four new prices.

For `CRON_SECRET`, use any long random value, such as a password from a password manager. Keep it handy for step 6.

`--no-verify-jwt` is required for `stripe-webhook`, `trial-reminders`, `confirm-account-deletion`, `form-notify` and `enterprise-inquiry`, because their callers aren't signed in to Supabase. The webhook checks Stripe's signature, the reminders check `CRON_SECRET`, account deletion checks the one-time link from the email, and form-notify only sends once per new response (within 15 minutes of it being submitted) with an hourly cap per form.

Account deletion emails and form notifications, like trial reminders, go to customers, so they need `NOTIFY_FROM` (step 3). `form-notify` doesn't need the Stripe secrets, so form emails work even before billing is set up.

## 5. Connect Stripe to the webhook

1. Stripe: **Developers > Webhooks > Add endpoint**.
2. Endpoint URL: `https://dmboosigttutyqaujdjv.supabase.co/functions/v1/stripe-webhook`
3. Events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Save, then copy the **Signing secret** (`whsec_...`) and run:

```sh
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

## 6. Schedule the trial reminder emails

Each day, owners and admins of unsubscribed organizations get an email 7 days before the trial ends, 1 day before, and when it ends. Each email goes out once.

1. In the Supabase SQL Editor, store the same `CRON_SECRET` value in Vault. Run this on its own, and don't save it in a file:

   ```sql
   select vault.create_secret('paste-the-same-value', 'trial_reminders_cron_secret');
   ```

2. Run `supabase/migrations/005_trial_reminders.sql`. The job runs every day at 15:00 UTC.

To check it: **Integrations > Cron** lists the job and its past runs. The function's results are in **Edge Functions > trial-reminders > Logs**.

## 7. Test it end to end

1. Push the app so Vercel deploys it.
2. Sign up and create your organization.
3. Go to **Settings > Plan** and choose a plan. If you made a promotion code in step 2, click **Add promotion code** on the checkout page and enter it.
4. Pay with test card `4242 4242 4242 4242`, any future date, any CVC and ZIP.
5. Check that you're back in Settings and the plan shows as active.

To test read-only mode, run this in the SQL Editor, then reload the app:

```sql
update organization_billing set trial_ends_at = now() - interval '1 day'
where organization_id = (select organization_id from organization_members
                         where email = 'you@example.com');
```

Undo it with `now() + interval '30 days'`.

If something fails, the error details are in **Supabase > Edge Functions > (function) > Logs** and **Stripe > Developers > Webhooks > (endpoint) > Event deliveries**.

## 8. Go live

Before switching on live payments:

- [ ] Fill in every `TODO` in `client/src/lib/legal.ts`: legal business name, mailing address, governing law and venue. Then set `LEGAL_DETAILS_COMPLETE = true`. Until then the legal pages log a warning in development.
- [ ] Have a lawyer review the Terms, Privacy and Refund pages.
- [ ] Verify hummotion.com in Resend and set `NOTIFY_FROM` (step 3), so Enterprise requests and customer emails are delivered.
- [ ] Sign in as info@hummotion.com (with the email confirmed) and check that **Inbox** appears in the sidebar.
- [ ] Check that the latest GitHub Actions run (the **CI** workflow) is green.

Then:

1. Switch Stripe to live mode. Then repeat step 2 (products, any coupons and promotion codes, portal), step 5 (webhook) and the API key.
2. Run `npx supabase secrets set` again with the live `sk_live_...`, the new price IDs and the new `whsec_...`.

## How it behaves

- **Trial:** each new organization gets 30 days free, with no card. Subscribing early doesn't cost any trial days: the first charge happens when the 30 days end.
- **After the trial:** without a subscription, the organization becomes read-only. Members can still sign in, view and export. Nothing can be added, changed or deleted, and public forms answer "This form isn't accepting responses right now." Subscribing restores everything right away. The database enforces this, not just the app.
- **Failed payments:** while Stripe retries a card, access continues and the banner asks for a card update. If Stripe gives up, the subscription ends and the organization becomes read-only.
- **Promotion codes:** created and managed in Stripe (Product catalog > Coupons). Customers enter them on the checkout page. Their limits and usage are tracked in Stripe.
- **Reminder emails:** owners and admins get one 7 days before the trial ends, one the day before, and one when it ends. Organizations that have subscribed get none.
- **Deleting an account:** Settings > Delete account emails a one-time link that expires in 24 hours, and nothing is deleted until the person opens it and confirms. If they're their organization's only member, the organization, its records and files go too, and any subscription is canceled at once. If they're on a team, they leave it and their records stay. The only owner of a team must make someone else an owner first.
- **Who can pay:** only owners and admins. Billing belongs to the organization, so the whole team shares one subscription.
- **Plans and limits:**

  | | Starter | Mission | Enterprise |
  |---|---|---|---|
  | Price | $49/month or $470/year | $199/month or $1,910/year | Contact us |
  | Active forms | 50 | 100 | Unlimited |
  | Team members (including the owner and open invitations) | 2 | 10 | Unlimited |
  | Client profiles (People) | 200 | 500 | Unlimited |
  | PDF reports per month | 50 | 100 | Unlimited |
  | Impact tracking | Yes | Yes | Yes |
  | CSV and Excel import and export | No | Yes | Yes |
  | Custom branding (logo, colors, per-form appearance) | No | Yes | Yes |

  Yearly is 20% off twelve months, rounded down to whole dollars. During the free trial, organizations get Mission's limits. The database refuses new forms, people, invitations and PDF reports past the limit, and Starter organizations can't save branding. Nothing that already exists is removed when an organization moves to a smaller plan. Import and export are hidden from Starter in the app only, because they run in the browser. To change a limit, edit both `client/src/lib/plans.ts` and `plan_limit()` in a new migration.
- **Enterprise:** the "Contact us" buttons open `/enterprise`. Each request is saved in **Table Editor > enterprise_inquiries**, emailed to info@hummotion.com, and listed in the in-app Inbox. After you agree a price, bill them outside the app (an invoice, or a custom Stripe price), then turn the plan on in the SQL Editor:

  ```sql
  update organization_billing set plan = 'enterprise', status = 'active'
  where organization_id = (select organization_id from organization_members
                           where email = 'owner@their-org.org');
  ```

  To end it, set `status = 'canceled'`.
- **Joining a team when you already have an organization:** everyone creates an organization at sign-up, and each person belongs to one. If someone who is the only member of their own organization opens an invitation, the invite page lets them bring their records into the new team (blocked if it would put the team over its plan's form or client profile limits; sample data stays behind) or delete their old organization. Either way its subscription is canceled at once, then they join. If their organization has other members, they must make someone else an owner and leave it on the Team page first.
- **Funder portals:** owners and admins create links in Reports > Funder portals. Every plan can set the name, note, period and sections, and edit a link later without changing its address. Mission and Enterprise can also filter what's counted (campaigns, volunteer activities, programs, forms, goals, outcome questions), reorder sections and add a note to each, show the organization's logo and color, set an expiry date, and add a password (stored only as a hash; 10 wrong tries lock the link for 15 minutes). Funders only ever see totals.
- **ID cards and scanning (Mission and Enterprise):** on a person's page, **ID card** gives them a card number (your prefix + a number, e.g. `FB-000123`; owners and admins set the prefix there) and chooses the form that opens when the card is scanned. **People > ID cards** makes cards for everyone at once and prints them (ID-badge size, 10 per Letter page). Inventory items have a **Barcode** field for product barcodes, and **Inventory > Print labels** prints QR labels (Avery 5160). The **Scan** page uses the phone or tablet camera: a card opens its form linked to that person; an item adds stock (Receive) or removes it (Give out). Cards and labels hold only a link to `/scan/...`, which works only for signed-in members of the organization. Print at 100% scale. The camera needs `camera=(self)` in `vercel.json`, which is set.
- **Staff Inbox:** `/admin` lists Enterprise requests and feedback, with Reply links and a "Mark handled" button. Only people whose confirmed email is in `staff_admins` can open it; it starts with info@hummotion.com. That account also needs to belong to an organization (any one) to get past sign-in. Add or remove staff in the SQL Editor:

  ```sql
  insert into staff_admins (email) values ('someone@hummotion.com');
  delete from staff_admins where email = 'someone@hummotion.com';
  ```
