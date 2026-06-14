# Monetization — Free / Basic / Ultra tiers with Stripe — Design Spec

**Date:** 2026-06-14
**Status:** Approved (design phase) — ready for implementation plan.

**Goal:** Add a three-tier subscription model (Free / Basic / Ultra) to Incognito
Chat, monetized via Stripe monthly subscriptions, with per-viewer feature gating,
server-enforced message & room quotas, free-tier rooms that auto-delete after one
day, landing-page pricing, and account/billing management in the dashboard.

**Architecture in one line:** A `subscriptions` table (written only by a Stripe
webhook) drives an `effective_tier(uid)` function; that tier is enforced
server-side for the things that cost money or data (message quota, room count,
premium room settings) and surfaced client-side via a `useEntitlements()` hook for
gray-outs and upgrade prompts. Stripe Checkout + Customer Portal handle all
payment UI. Two new pg_cron jobs purge expired free rooms and (finally) expired
"disappearing" messages.

---

## 1. Background — current architecture (verified 2026-06-14)

- **Auth:** Supabase anonymous auth (default, no login) + Google OAuth (optional,
  needed for the dashboard / room-list persistence). `user.isAnonymous`
  distinguishes them. **No identity linking** — anon and Google are separate uids.
- **Rooms:** created via the `join_or_create_room` SECURITY DEFINER RPC; anonymous
  users can create rooms today. Cosmetic columns (`avatar_url`, `background_*`,
  `display_name`, `ai_enabled`, `ai_avatar_url`, `message_ttl_seconds`,
  `auto_delete_seconds`, `pinned_message_id`) are member-updatable; `pin`,
  `created_by`, `room_key`, `room_name`, `created_at` are locked.
- **Messages:** direct client INSERT into `messages` (RLS membership-gated).
  **No quota of any kind exists today.** `messages.created_at` is microsecond
  `timestamptz`.
- **TTL / auto-delete:** `rooms.message_ttl_seconds` and `auto_delete_seconds`
  columns exist but **no cron purges them** — "disappearing messages" does not
  actually delete anything server-side today. A daily cron only cleans abandoned
  anon users.
- **Edge functions** (Deno): `inco-ai`, `notify-room`, `send-push`,
  `link-preview`. Pattern: CORS, JWT via `Authorization` header, `is_member` RPC
  check, service-role client for privileged reads, secrets via `Deno.env`.
- **Hosting:** GitHub Pages (static) via Actions on push to `main`; base path
  `/incognitochat/`. **All server-side payment logic must live in Supabase edge
  functions** (no Node server).
- **File size:** current hard limit is **40MB** (`ChatInput.tsx`), not 10MB.

---

## 2. Tier matrix (the contract)

Tier is determined by **subscription status, not login**. A logged-in Google user
with no active subscription is **Free**. An anonymous user is always **Free**.

| Capability | Free | Basic | Ultra |
|---|---|---|---|
| Login required | No (anon) or Google | Google | Google |
| Price (EUR / month) | €0 | TBD (Stripe) | TBD (Stripe) |
| Active owned rooms | **1 at a time** | **10** | ∞ |
| Room lifetime | **auto-delete 24h after creation** | permanent | permanent |
| Sent-message quota (per room, per day, Europe/Athens) | **10** | **100** | ∞ |
| Send text / file / location / emoji / poll / audio-message | ✓ | ✓ | ✓ |
| Max file size | 10MB | 10MB | **40MB** |
| Core chat: reply, reactions, edit/delete own, search, media gallery, push & email alerts, sound/vibration, pinned messages | ✓ | ✓ | ✓ |
| Delete room | ✓ | ✓ | ✓ |
| Audio call | ✗ | ✓ | ✓ |
| Room appearance (avatar / background / display name) | ✗ | ✓ | ✓ |
| Disappearing messages (TTL) + custom auto-delete | ✗ | ✓ | ✓ |
| Video call | ✗ | ✗ | ✓ |
| Screen share | ✗ | ✗ | ✓ |
| AI assistant (Inco) | ✗ | ✗ | ✓ |

**Quota counts each `messages` INSERT** by the user (text, file, poll, audio,
location all = 1 message), excluding `system`. Resets at the Europe/Athens day
boundary.

### Per-viewer gating consequences (accepted)
1. An Ultra user inside a Free user's room keeps their own features, **but the
   room is free-owned and still auto-deletes at 24h.**
2. If an Ultra user enables AI in a room, every present member sees the AI replies.
3. The message quota is per sender: the Free owner is capped at 10/day, an Ultra
   visitor is uncapped.

---

## 3. Tier resolution

`effective_tier(p_uid)` — SECURITY DEFINER, STABLE — returns `'free' | 'basic' |
'ultra'`:

- Returns the subscription's `tier` when `status IN ('active','trialing')`, or
  when `status IN ('past_due','canceled') AND current_period_end > now()` (grace:
  cancellation and dunning keep access until the paid period ends).
- Otherwise `'free'`.
- Anonymous uids never have a subscription row → always `'free'`.

A TypeScript mirror of this logic powers `useEntitlements()` for instant UI, but
**the database function is the authority** for all enforcement.

---

## 4. Data model changes

### New table `subscriptions`
```sql
create table public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  tier                   text not null check (tier in ('basic','ultra')),
  status                 text not null,           -- Stripe sub status verbatim
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
-- read own row only:
create policy subs_select_own on public.subscriptions for select using (auth.uid() = user_id);
-- NO insert/update/delete policy for anon/authenticated -> only service role (webhook) writes.
```

### `rooms` new columns
```sql
alter table public.rooms add column expires_at timestamptz;  -- set = created_at+24h for free creators; NULL otherwise
alter table public.rooms add column locked     boolean not null default false; -- read-only after downgrade-over-limit
```

> Implementation note: confirm the live type of `messages.uid` / `rooms.created_by`
> (uuid vs text) before writing the trigger/RPC SQL and cast consistently.

---

## 5. Enforcement — hard (server) vs soft (client)

### Hard, server-side (cannot be bypassed)

**5.1 Message quota** — `BEFORE INSERT` trigger on `messages`:
```sql
create or replace function public.enforce_message_quota()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tier text; v_limit int; v_count int; v_locked boolean;
begin
  if coalesce(NEW.type,'text') = 'system' then return NEW; end if;
  select locked into v_locked from public.rooms where room_key = NEW.room_key;
  if v_locked then raise exception 'ROOM_LOCKED'; end if;
  v_tier  := public.effective_tier(NEW.uid);
  v_limit := case v_tier when 'ultra' then null when 'basic' then 100 else 10 end;
  if v_limit is null then return NEW; end if;
  select count(*) into v_count from public.messages m
   where m.uid = NEW.uid and m.room_key = NEW.room_key
     and coalesce(m.type,'text') <> 'system'
     and m.created_at >= (date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens');
  if v_count >= v_limit then raise exception 'QUOTA_EXCEEDED:%', v_tier; end if;
  return NEW;
end; $$;
```
Index `messages (room_key, uid, created_at)` supports the count.

**5.2 Room count + free expiry** — extend `join_or_create_room`: when creating a
**new** room, count the caller's existing rooms; if `>= limit(effective_tier)`
(free=1, basic=10, ultra=∞) raise `ROOM_LIMIT:<tier>`. On create, set
`expires_at = now() + interval '24 hours'` when the creator is Free, else NULL.
(Rest of the RPC body preserved.)

**5.3 Premium room settings** — `BEFORE UPDATE` trigger on `rooms`
(`enforce_room_tier`), using `effective_tier(auth.uid())`:
- setting `ai_enabled = true` or changing `ai_avatar_url` ⇒ require **Ultra**, else
  `TIER_REQUIRED:ai`;
- changing `message_ttl_seconds`, `auto_delete_seconds`, `avatar_url`,
  `background_type/preset/url`, or `display_name` ⇒ require **Basic+**, else
  `TIER_REQUIRED:basic`.
- `pinned_message_id` is core (not gated).

**5.4 AI edge function** — `inco-ai` additionally verifies
`effective_tier(caller) = 'ultra'` (defense in depth; the room-update guard already
prevents enabling AI below Ultra).

### Soft, client-side (gray-out only — accepted risk, stated explicitly)
- **Audio/video call & screen share:** gated in the UI. Both parties need the
  feature; the only server cost is TURN relay (metered.ca) — acceptable for MVP.
  (If abused, a future `start_call` signaling RPC can add a server tier check.)
- **File size (10MB free/basic vs 40MB ultra):** enforced in `ChatInput`. Storage
  uploads are direct-to-bucket; per-tier size is not server-validated in MVP.
- **Cosmetic gray-outs** in RoomInfoModal/header.

### Cron jobs (pg_cron)
```sql
-- free rooms die ~24h after creation (granularity 15 min)
select cron.schedule('purge-expired-free-rooms','*/15 * * * *',
  $$ delete from public.rooms where expires_at is not null and expires_at < now(); $$);

-- disappearing messages — make the sold Basic feature actually work
select cron.schedule('purge-expired-messages','*/5 * * * *',
  $$ delete from public.messages m using public.rooms r
      where m.room_key = r.room_key and r.message_ttl_seconds is not null
        and m.created_at < now() - (r.message_ttl_seconds || ' seconds')::interval; $$);
```

### Downgrade reconciliation
`reconcile_entitlements(p_uid)` — SECURITY DEFINER, called by the webhook on every
subscription change:
- if tier ≠ free → clear `expires_at` on all the user's rooms;
- recompute `locked`: rank the user's rooms by most-recent activity
  (`max(messages.created_at)` else `rooms.created_at`), keep the top
  `limit(tier)` writable (`locked=false`), set `locked=true` on the rest;
- ultra → unlock all.

The quota trigger (5.1) already blocks inserts into a `locked` room → read-only.

---

## 6. Stripe integration (3 edge functions, existing Deno pattern)

**`create-checkout-session`** — POST, JWT required and **must be non-anonymous**
(Google). Creates or reuses a Stripe Customer (stored on `subscriptions`/looked up
by uid; uid in customer metadata + `client_reference_id`). Creates a Checkout
Session: `mode='subscription'`, `line_items=[{ price: <STRIPE_PRICE_BASIC|ULTRA>,
quantity:1 }]`, `success_url`/`cancel_url` → app dashboard with a status param.
Returns `{ url }`.

**`stripe-webhook`** — verifies the signature with `STRIPE_WEBHOOK_SECRET` (raw
body). Idempotent (dedupe by Stripe event id). Handles:
- `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
  `invoice.payment_failed`, `invoice.paid`.
- Upserts the `subscriptions` row (service role) — tier from the price id, plus
  `status`, `current_period_end`, `cancel_at_period_end`, `stripe_*` ids — keyed to
  uid via customer metadata / `client_reference_id`.
- Calls `reconcile_entitlements(uid)` after every upsert/delete.

**`create-portal-session`** — POST, JWT required. Returns a Stripe **Customer
Portal** URL for the caller's customer (`return_url` → dashboard). Portal provides
cancel, invoice/transaction history, and payment-method changes — nothing custom
to build.

**Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`,
`STRIPE_PRICE_ULTRA`, `APP_URL`. Prices/amounts are configured in Stripe later; the
app reads only the price ids from env.

---

## 7. Client

**`useEntitlements()`** hook — single source of UI truth:
- resolves `tier` (from the user's `subscriptions` row, realtime-subscribed so an
  upgrade reflects without reload; falls back to `effective_tier` RPC on load);
- returns flags derived from one config map:
  `{ tier, canAI, canAudioCall, canVideoCall, canScreenShare, canRoomAppearance,
     canDisappearing, maxFileBytes, msgQuota, maxRooms }`.

**Gating UI:**
- A reusable `FeatureGate` wrapper + `UpgradeModal` (opens pricing / triggers
  Checkout).
- `RoomInfoModal` premium rows render a 🔒 and "Ξεκλείδωσε με Basic/Ultra" when
  locked; clicking opens the upgrade flow instead of the feature.
- `CallManager` call/share buttons locked per tier.
- `ChatInput` enforces `maxFileBytes` and shows a remaining-messages counter for
  Free/Basic.

**Quota & lock UX:** on a send rejected with `QUOTA_EXCEEDED` → inline banner
"Έφτασες το όριο μηνυμάτων για σήμερα — αναβάθμισε."; a `locked` room shows a
read-only banner "Read-only — αναβάθμισε ή ξεκλείδωσε".

**Greek copy** for all customer-facing strings; English internal.

---

## 8. Landing pricing + dashboard billing

**Landing (`LandingPage`)** — new `#pricing` section (between "How it works" and
FAQ): three cards (Free / Basic / Ultra) with the feature matrix and EUR/month.
CTAs: Free → enter app; Basic/Ultra → if not logged in, Google login then Checkout;
if logged in, Checkout directly.

**Dashboard → Account/Settings** — current plan + status + renewal/expiry date;
usage meters (rooms X / limit; today's sent messages); **"Διαχείριση συνδρομής"**
button → Customer Portal; upgrade buttons → Checkout. Transaction history lives in
the Portal.

---

## 9. Error handling

Typed error codes raised by triggers/RPC, mapped to Greek prompts client-side:
- `QUOTA_EXCEEDED:<tier>` → daily message limit reached.
- `ROOM_LIMIT:<tier>` → room cap reached.
- `ROOM_LOCKED` → room is read-only (downgrade).
- `TIER_REQUIRED:ai` / `TIER_REQUIRED:basic` → feature needs a higher tier.

Webhook is idempotent and tolerant of out-of-order events (always reconciles from
the latest known state). Checkout/Portal failures → toast.

---

## 10. Testing

- **Pure-function unit tests (vitest):** tier resolution (mirror of
  `effective_tier`), entitlement flag derivation, the daily-quota counting helper,
  per-tier file-size/room/quota constants.
- **SQL:** apply via migration then verify with live queries (the project's
  migrate-then-verify practice): quota trigger blocks the (N+1)th message and
  resets next day; room-limit RPC; room-update tier guard; `reconcile_entitlements`
  lock ranking; both purge crons.
- **Stripe:** webhook signature verification + event handling tested with the
  Stripe CLI / a signed fixture; Checkout & Portal in Stripe test mode.

---

## 11. Non-goals / accepted limitations

- Calls, file size, and cosmetic gray-outs are **client-side only** (§5 soft).
- Storage upload size is not server-validated per tier in MVP.
- **No anon→Google identity linking** — buying creates a fresh Google identity; the
  abandoned free room expires within 24h. (User decision.)
- Plaintext-PIN membership model, public storage bucket, TURN creds — unchanged
  (pre-accepted).
- Prices/amounts are TBD and live in Stripe; only price ids are referenced.
- Monthly EUR only; no annual plan, no free trial (Free tier is the trial).

---

## 12. Phasing (one spec, staged build)

1. **Entitlements core:** `subscriptions` table, `rooms.expires_at/locked`,
   `effective_tier`, quota trigger, room-limit RPC change, room-tier guard,
   `reconcile_entitlements`, the two purge crons.
2. **Stripe edge functions:** checkout / webhook / portal + secrets.
3. **Client gating:** `useEntitlements`, `FeatureGate`/`UpgradeModal`, RoomInfoModal
   / ChatInput / CallManager gates, quota & lock UX.
4. **Landing pricing + dashboard billing UI.**
5. **Polish + tests.**

Each phase ends green (build + tests) and is independently shippable behind the
fact that no price is live until Stripe is configured.
