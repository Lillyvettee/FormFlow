# FormFlow — New Backend Setup Guide

## What Changed

The entire backend has been replaced. Here's the before/after:

| Before (Replit) | After (New Stack) |
|---|---|
| Python/Flask backend | Supabase (database + auth + edge functions) |
| Express.js proxy | Gone — not needed |
| Drizzle ORM + raw SQL | Supabase client SDK |
| Replit Auth (OIDC) | Supabase Auth (email/password) |
| PostgreSQL via psycopg2 | Supabase managed Postgres |
| No Stripe | Stripe via Supabase Edge Functions |

## Files to DELETE from your Replit project

```
server/              ← entire folder
server_py/           ← entire folder
main.py
pyproject.toml
uv.lock
drizzle.config.ts
migrations/          ← entire folder (if exists)
script/              ← entire folder
replit.md            ← optional, no longer accurate
```

## Files to ADD (from this package)

```
src/lib/supabase.ts         → client/src/lib/supabase.ts
src/lib/api.ts              → client/src/lib/api.ts
src/lib/stripe.ts           → client/src/lib/stripe.ts
src/hooks/useAuth.ts        → client/src/hooks/useAuth.ts
src/types/database.ts       → client/src/types/database.ts
shared/schema.ts            → shared/schema.ts (replace existing)
supabase/                   → supabase/ (new folder at project root)
package.json                → replace existing
vite.config.ts              → replace existing
vercel.json                 → new file at project root
.env.example                → reference only, create .env.local
```

---

## Step 1: Supabase Setup

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Go to **SQL Editor** in your Supabase dashboard
3. Paste and run the entire contents of `supabase/migrations/001_initial_schema.sql`
4. Go to **Settings → API** and copy:
   - Project URL → `VITE_SUPABASE_URL`
   - Anon/public key → `VITE_SUPABASE_ANON_KEY`
5. Create `.env.local` at your project root with those values

---

## Step 2: Update Your Frontend Auth

Your `client/src/App.tsx` currently uses Replit Auth. Replace with the new `useAuth` hook:

```tsx
// Before (Replit auth)
import { useUser } from '@/hooks/use-user' // or however it was imported

// After (Supabase auth)
import { useAuth } from '@/hooks/useAuth'

function App() {
  const { user, loading, isAuthenticated } = useAuth()

  if (loading) return <LoadingScreen />
  if (!isAuthenticated) return <LandingPage />
  return <Dashboard />
}
```

Your API calls change from `fetch('/api/forms')` to direct Supabase calls:

```tsx
// Before
const res = await fetch('/api/forms')
const forms = await res.json()

// After
import { formsApi } from '@/lib/api'
const forms = await formsApi.list(user.id)
```

---

## Step 3: Stripe Setup

1. Go to [stripe.com](https://stripe.com) and create an account
2. Create your products and prices in Stripe Dashboard:
   - **Starter Monthly** → copy Price ID → `price_TODO_starter_monthly` in `src/types/database.ts`
   - **Starter Yearly** → copy Price ID
   - **Mission Monthly** → copy Price ID
   - **Mission Yearly** → copy Price ID
3. Update `PLAN_CONFIG` in `src/types/database.ts` with your actual prices and Price IDs

---

## Step 4: Deploy Supabase Edge Functions

Install the Supabase CLI first:
```bash
npm install -g supabase
supabase login
supabase link --project-ref your-project-id
```

Set secrets (use your actual values):
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set STRIPE_STARTER_MONTHLY_PRICE_ID=price_...
supabase secrets set STRIPE_STARTER_YEARLY_PRICE_ID=price_...
supabase secrets set STRIPE_MISSION_MONTHLY_PRICE_ID=price_...
supabase secrets set STRIPE_MISSION_YEARLY_PRICE_ID=price_...
supabase secrets set APP_URL=https://your-app.vercel.app
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Deploy the functions:
```bash
supabase functions deploy create-checkout
supabase functions deploy create-portal
supabase functions deploy stripe-webhook
```

---

## Step 5: Configure Stripe Webhook

1. In Stripe Dashboard → **Webhooks** → Add endpoint
2. URL: `https://your-project-id.supabase.co/functions/v1/stripe-webhook`
3. Events to listen for:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the **Signing secret** → set as `STRIPE_WEBHOOK_SECRET`

---

## Step 6: Deploy to Vercel

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) → Import project
3. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy — `vercel.json` handles SPA routing automatically

---

## Plan Limits

Update `PLAN_CONFIG` in `src/types/database.ts` to set your prices and limits:

```ts
free: {
  monthlyPrice: 0,
  limits: { forms: 3, responsesPerMonth: 100, seats: 1 }
},
starter: {
  monthlyPrice: 1500,  // $15.00 in cents
  yearlyPrice: 15300,  // $153.00/year (15% off)
  yearlyDiscount: 15,
  limits: { forms: 15, responsesPerMonth: 1000, seats: 3 }
},
mission: {
  monthlyPrice: 3900,  // $39.00 in cents
  yearlyPrice: 39600,  // $396.00/year (15% off)
  yearlyDiscount: 15,
  limits: { forms: Infinity, responsesPerMonth: Infinity, seats: 10 }
}
```

Then use the guards in your components:
```tsx
import { canCreateForm } from '@/lib/stripe'

// Before allowing form creation:
if (!canCreateForm(plan, currentFormCount)) {
  // Show upgrade prompt
}
```
