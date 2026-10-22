# SARATHI 1.7.2 — Supabase setup

This build replaces the Firebase client integration with Supabase Auth + Postgres. LocalStorage remains enabled and uses the existing SARATHI storage key.

## 1. Configure the table

In Supabase Dashboard → SQL Editor, run this only if `public.sarathi_state` does not already exist:

```sql
create table public.sarathi_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

Then run this policy setup (safe to rerun):

```sql
alter table public.sarathi_state enable row level security;

drop policy if exists "Users can read their own state" on public.sarathi_state;
drop policy if exists "Users can insert their own state" on public.sarathi_state;
drop policy if exists "Users can update their own state" on public.sarathi_state;

create policy "Users can read their own state"
on public.sarathi_state for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own state"
on public.sarathi_state for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own state"
on public.sarathi_state for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

Do not use public/open policies. Each account can access only its own row.

## 2. Authentication

In Supabase Dashboard → Authentication → URL Configuration:
- Set Site URL to your deployed GitHub Pages site URL.
- Add the deployed URL to Redirect URLs if needed.
- For easier first test, you may leave email confirmation enabled; after registration, confirm the email before signing in.

Email/password auth is used in the SARATHI Cloud Sync panel. Logging into Supabase with GitHub is not the same as creating a SARATHI user account.

## 3. Realtime sync

In Database → Publications / Realtime settings, enable Realtime for `public.sarathi_state` (the `supabase_realtime` publication). This is needed for instant updates on the other device. Cloud save/load works without realtime, but updates won't arrive instantly.

## 4. Deploy

Replace the existing `app.js`, `index.html`, `style.css`, and `VERSION.txt` with the files from this package. Keep your original `assets/` folder and all other project assets in place; this package does not include assets because they were not part of the uploaded files. Commit and push the changes to the same GitHub Pages repository.

Open the HTTPS site on the laptop, create a SARATHI account or sign in, and add a small test entry. Wait for “Synced to cloud”. Then open the same site on mobile and sign in with the same SARATHI email/password.

## 5. Data safety

When a cloud row already exists, SARATHI asks whether to load the cloud state or keep the local state and upload it. Choose carefully. A local backup is made before applying cloud state. Keep an exported JSON backup before testing.

The browser uses only the Supabase Project URL and publishable key. Never put a `sb_secret_...` key in frontend code.


## 4. SARATHI account panel (1.7.3)

The account control is a small icon in the top-right corner on every app view. Click it to open the account panel. Use a complete email address (for example, `you@example.com`) and a password of at least 6 characters. If email confirmation is enabled, open the confirmation email before signing in. If the account already exists, use **Sign in** instead of **Create account**.

The browser console may show an HTTP 400 for expected authentication errors such as invalid credentials or an already-registered email. Check the response message before changing project settings. Never put a Supabase secret/service-role key in frontend code.
