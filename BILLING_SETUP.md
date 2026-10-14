# Billing setup

How to turn on the 30-day free trial, paid plans and promotion codes.
Do the steps in order. Stay in Stripe **test mode** until step 8, so no real money moves.

| What | Where it lives |
|---|---|
| Trial, read-only mode | `supabase/migrations/004_billing.sql` |
| Checkout, billing portal, Stripe webhook, trial reminders | `supabase/functions/` |
| Daily reminder schedule | `supabase/migrations/005_trial_reminders.sql` |
| Plan section in Settings | `client/src/components/plan-section.tsx` |
| Trial / read-only banner | `client/src/components/billing-banner.tsx` |

## 1. Update the database (before pushing the app)

The new app code reads the billing table, so run the SQL **before** Vercel deploys the new code, or signed-in pages will show "Couldn't load your organization".

In the Supabase dashboard, open **SQL Editor** and run each file, in order:

1. `supabase/migrations/003_shared_media_and_signup_fix.sql`
2. `supabase/migrations/004_billing.sql`
3. `supabase/migrations/006_branding_and_demo_data.sql` (public form branding)
4. `supabase/migrations/007_account_deletion.sql` (keeps a team's records when a member deletes their account)
5. `supabase/migrations/008_sample_data.sql` (the dashboard's "Load sample data" button; removes the old guest demo and its codes)

`005_trial_reminders.sql` comes later, in step 6.

Every existing organization's 30 days start when you run 004.

## 2. Create a Stripe account and products

1. Sign up at https://dashboard.stripe.com/register. Keep the **Test mode** switch on.
2. **Product catalog > Add product**:
   - Name `Starter`, recurring, **$5.00 per month**. Save, then copy the price ID (`price_...`).
   - Name `Mission`, recurring, **$36.00 per year**. Copy its price ID.
3. Optional, for discounts: **Product catalog > Coupons > New**. Choose the discount and how long it lasts (for example 50%, Forever). Then, on the coupon, **Add promotion code** and type the code customers will enter (for example `LAUNCH50`). You can limit it to first-time customers, a number of uses or an expiry date. Customers enter it on the checkout page; no app changes are needed for new codes.
4. **Settings > Billing > Customer portal**: activate it. Allow updating payment methods, viewing invoices and canceling. Under "Switch plans", add both products.
5. **Developers > API keys**: copy the **Secret key** (`sk_test_...`).

## 3. Set up email

1. Sign up at https://resend.com.
2. **API Keys > Create API key**. Copy it (`re_...`).

Resend's built-in sender (`onboarding@resend.dev`) can only send to the address you signed up with. **Trial reminder and account deletion emails go to customers, so they need your own domain**:

3. **Domains > Add domain**. Add the DNS records Resend shows you, where your domain is managed. Wait until it says Verified.
4. Choose a sender on that domain, for example `HumMotion <billing@yourdomain.com>`. You'll set it as `NOTIFY_FROM` in step 4.

Until `NOTIFY_FROM` is set, the reminder job runs but sends nothing. Its log says why.

## 4. Deploy the server functions

In a terminal in this folder:

```sh
npx supabase login
npx supabase link --project-ref dmboosigttutyqaujdjv

npx supabase secrets set STRIPE_SECRET_KEY=sk_test_...
npx supabase secrets set STRIPE_PRICE_STARTER=price_...
npx supabase secrets set STRIPE_PRICE_MISSION=price_...
npx supabase secrets set SITE_URL=https://your-site.vercel.app
npx supabase secrets set RESEND_API_KEY=re_...
npx supabase secrets set "NOTIFY_FROM=HumMotion <billing@yourdomain.com>"
npx supabase secrets set CRON_SECRET=paste-a-long-random-value

npx supabase functions deploy create-checkout
npx supabase functions deploy create-portal
npx supabase functions deploy stripe-webhook --no-verify-jwt
npx supabase functions deploy trial-reminders --no-verify-jwt
npx supabase functions deploy request-account-deletion
npx supabase functions deploy confirm-account-deletion --no-verify-jwt
```

For `CRON_SECRET`, use any long random value, such as a password from a password manager. Keep it handy for step 6.

`--no-verify-jwt` is required for `stripe-webhook`, `trial-reminders` and `confirm-account-deletion`, because their callers aren't signed in to Supabase. The webhook checks Stripe's signature, the reminders check `CRON_SECRET`, and account deletion checks the one-time link from the email.

Account deletion emails, like trial reminders, go to customers, so they need `NOTIFY_FROM` (step 3).

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
