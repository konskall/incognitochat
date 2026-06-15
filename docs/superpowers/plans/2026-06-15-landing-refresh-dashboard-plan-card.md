# Landing Refresh + Responsive "Your Plan" Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (1) On small screens, move the dashboard "Your Plan" card into the profile edit panel to save space; keep it as a standalone sidebar card on desktop. (2) Refresh the landing page to reflect ALL current features, add a premium "View Plans" hero CTA next to "Start Chatting Now", reorder so "Fast & Transient" sits before the FAQ (FAQ last), and expand the FAQ (and its index.html JSON-LD) to cover the new features.

**Architecture:** Pure client/markup work (no DB, no new deps). Dashboard reuses the existing `tier`/`ent`/`entLoading` + `handleUpgrade`/`handleManageBilling`/`billingBusy` by extracting the card JSX into one `planCard` element rendered in two responsive slots. Landing edits are content + structure in `LandingPage.tsx` (+ an `id="pricing"` anchor in `PricingSection.tsx`); the FAQ JSON-LD in `index.html` is kept in sync.

**Tech Stack:** React 18 + TS, Tailwind, lucide-react. English copy.

---

## Verified anchors (2026-06-15)
- **DashboardScreen.tsx:** sidebar column `lg:col-span-4 xl:col-span-3 space-y-6` opens at **1236**; profile card outer div **1237–1298** (`isEditingProfile ?` edit panel **1239–1281**, with Cancel/Save buttons at **1277–1280**; view mode **1283–1297**); standalone "Your Plan" card at **1300–1329**. `tier`, `ent`, `entLoading`, `handleUpgrade`, `handleManageBilling`, `billingBusy`, `Sparkles` already in scope (Phase 4/5).
- **LandingPage.tsx:** `FEATURES` array **21–43**; `STEPS` **45–61**; `FAQS` **63–85**; `Reveal` helper; hero CTA block **231–239** (single button, `onStart`); section order in `<main>`: Hero(197–241) → Features(243–253) → How it works(255–274) → `<PricingSection/>`(276) → FAQ(279–294) → Trust "Fast & Transient"(296–307). `scrollToTop` defined ~151; imports at line 2.
- **PricingSection.tsx:** `<section aria-labelledby="pricing-title" className="max-w-6xl …">` — no `id` yet.
- **index.html:** FAQ JSON-LD `FAQPage.mainEntity` array at **64–90** (5 entries), inside the `@graph`.

**Verification:** build `npm run build`; tests `npx vitest run`.

---

### Task 1: Responsive "Your Plan" card (dashboard)

**Files:** Modify `components/DashboardScreen.tsx`

- [ ] **Step 1: Extract the card into a `planCard` element**

Just above the `return (` of the component (or near the other derived values, after the billing handlers), define the card once:

```tsx
const planCard = (
  <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-5">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Your plan</h3>
      <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${
        entLoading ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
        : tier === 'ultra' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
        : tier === 'basic' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
        {entLoading ? '…' : tier === 'ultra' ? 'Ultra' : tier === 'basic' ? 'Basic' : 'Free'}
      </span>
    </div>
    <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-1 mb-4">
      {entLoading ? (
        <li className="text-slate-400 dark:text-slate-500">Loading your plan…</li>
      ) : (
        <>
          <li>{ent.maxRooms === null ? 'Unlimited rooms' : `${ent.maxRooms} room${ent.maxRooms === 1 ? '' : 's'}`}</li>
          <li>{ent.msgPerRoomPerDay === null ? 'Unlimited messages' : `${ent.msgPerRoomPerDay} messages/day per room`}</li>
          <li>{`Up to ${Math.round(ent.maxFileBytes / (1024 * 1024))}MB files`}</li>
        </>
      )}
    </ul>
    {!entLoading && (tier === 'free' ? (
      <div className="flex gap-2">
        <button onClick={() => handleUpgrade('basic')} disabled={billingBusy} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-60">Upgrade to Basic</button>
        <button onClick={() => handleUpgrade('ultra')} disabled={billingBusy} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-purple-600 hover:bg-purple-700 text-white transition disabled:opacity-60">Ultra</button>
      </div>
    ) : (
      <div className="flex flex-col gap-2">
        {tier === 'basic' && (
          <button onClick={() => handleUpgrade('ultra')} disabled={billingBusy} className="w-full py-2.5 rounded-xl text-sm font-bold bg-purple-600 hover:bg-purple-700 text-white transition disabled:opacity-60 flex items-center justify-center gap-2"><Sparkles size={16} /> Upgrade to Ultra</button>
        )}
        <button onClick={handleManageBilling} disabled={billingBusy} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition disabled:opacity-60">Manage subscription</button>
      </div>
    ))}
  </div>
);
```

This is the SAME markup currently inline at lines 1300–1329 — move it verbatim into this const (do not change its content).

- [ ] **Step 2: Render it standalone on desktop only**

Replace the current inline card at 1300–1329 with:
```tsx
<div className="hidden lg:block">{planCard}</div>
```

- [ ] **Step 3: Render it inside the edit-profile panel on small screens only**

Inside the `isEditingProfile` block, immediately AFTER the Cancel/Save buttons row (the `<div className="flex gap-3 pt-2">…</div>` at lines 1277–1280) and BEFORE that block's closing `</div>` (line 1281), insert:
```tsx
<div className="lg:hidden pt-4 border-t border-slate-200 dark:border-slate-800">{planCard}</div>
```
So on phones the plan card is tucked into "edit profile" (saving sidebar space); on desktop it stays a standalone sidebar card and never duplicates (the two wrappers are mutually exclusive by breakpoint).

- [ ] **Step 4: Build + commit**

Run `npm run build` (zero errors). Manually confirm: desktop shows the standalone card and NOT the in-edit one; resizing to mobile + tapping Edit shows the card inside the edit panel and the standalone is hidden.
```bash
git add components/DashboardScreen.tsx
git commit -m "feat(dashboard): Your Plan card moves into profile edit on small screens"
```

---

### Task 2: Landing page refresh (features, hero CTA, reorder, FAQ)

**Files:** Modify `components/LandingPage.tsx`, `components/PricingSection.tsx`

- [ ] **Step 1: PricingSection — add a scroll anchor**

In `components/PricingSection.tsx`, add `id="pricing"` to the top-level `<section …>` (keep `aria-labelledby="pricing-title"`):
```tsx
<section id="pricing" aria-labelledby="pricing-title" className="max-w-6xl mx-auto px-6 py-12 lg:py-20">
```

- [ ] **Step 2: LandingPage imports**

Update the lucide-react import (line 2) to also include `Sparkles`, `Timer`, `Bell` (keep the existing icons):
```ts
import { Shield, Lock, Zap, Smartphone, ArrowRight, Video, LogIn, KeyRound, Share2, MessagesSquare, ChevronDown, Sun, Moon, ArrowUp, Sparkles, Timer, Bell } from 'lucide-react';
```

- [ ] **Step 3: Replace the `FEATURES` array (lines 21–43) with 8 cards**

```tsx
const FEATURES = [
  {
    icon: <Lock className="text-blue-500" />,
    title: 'PIN-Locked Private Rooms',
    description: 'Every message is scrambled with your room PIN — only people who join with the right name and PIN can read along.',
  },
  {
    icon: <Shield className="text-purple-500" />,
    title: 'No Sign-Up, Truly Anonymous',
    description: 'No phone number or email. Pick a username and a secret room; a Google login is optional, just to save your rooms.',
  },
  {
    icon: <Video className="text-green-500" />,
    title: 'Audio, Video & Screen Share',
    description: 'Group and 1-on-1 calls connect peer-to-peer with a secure relay fallback. Add video and screen sharing on Ultra.',
  },
  {
    icon: <Sparkles className="text-fuchsia-500" />,
    title: 'Inco AI Assistant',
    description: 'Summon an in-room AI to answer questions and look things up — with cited sources. Available on Ultra.',
  },
  {
    icon: <Timer className="text-orange-500" />,
    title: 'Disappearing & Self-Destruct Rooms',
    description: 'Set messages to vanish on a timer, or have the whole room auto-delete after a chosen period of inactivity.',
  },
  {
    icon: <MessagesSquare className="text-emerald-500" />,
    title: 'Rich Messaging',
    description: 'Replies, reactions, polls, voice notes, location, a media gallery, link previews and full-text search.',
  },
  {
    icon: <Bell className="text-rose-500" />,
    title: 'Push & Email Alerts',
    description: 'Get notified of new messages by web push — even when the app is closed — or by email, without exposing your message content.',
  },
  {
    icon: <Smartphone className="text-sky-500" />,
    title: 'Installable PWA + Dark Mode',
    description: 'Add it to your home screen like a native app, offline-ready, with a polished dark theme.',
  },
];
```
The Features grid (`md:grid-cols-2 lg:grid-cols-4`) already lays 8 cards out as 2 rows of 4 — no grid change needed.

- [ ] **Step 4: Hero subcopy + step 3 copy (light touch)**

Hero paragraph (line 227–229) — replace with:
```tsx
<p className="max-w-2xl mx-auto text-lg lg:text-xl text-slate-600 dark:text-slate-400 leading-relaxed mb-10 animate-in slide-in-from-bottom-6 duration-700 delay-100">
  Incognito Chat is a privacy-first messaging app. Spin up a room, lock it with a PIN, and only the people you invite can read along — no phone number, no sign-up. Add calls, AI, polls and disappearing messages when you want more.
</p>
```
In `STEPS` (line 57–60), update step 3's description to:
```tsx
    description: 'Message, share media, run polls, start audio/video calls, or summon Inco AI. Delete the room to wipe it for everyone.',
```

- [ ] **Step 5: Hero — add the "View Plans" CTA + a `scrollToPricing` helper**

Add near `scrollToTop` (~line 151):
```ts
const scrollToPricing = () => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
```
Replace the hero CTA block (lines 231–239) with a two-button row (primary + premium glow CTA):
```tsx
<div className="flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-4 animate-in slide-in-from-bottom-8 duration-700 delay-200">
  <button
    onClick={onStart}
    className={`group relative px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/30 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 ${focusRing}`}
  >
    Start Chatting Now
    <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
  </button>
  <button
    onClick={scrollToPricing}
    className={`group relative px-8 py-4 font-bold rounded-2xl text-white transition-all hover:scale-105 active:scale-95 ${focusRing}`}
  >
    <span aria-hidden="true" className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-500 opacity-50 blur-md group-hover:opacity-80 transition-opacity animate-pulse" style={{ animationDuration: '3s' }}></span>
    <span className="relative flex items-center gap-2 px-0 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 -mx-8 -my-4 px-8 py-4 shadow-xl shadow-purple-500/30">
      <Sparkles size={20} className="group-hover:rotate-12 transition-transform" />
      View Plans
    </span>
  </button>
</div>
```
(The premium button has an animated blurred gradient glow behind it; the inner span carries the solid gradient + sparkle. Clicking smooth-scrolls to the pricing comparison, where the existing Choose-Basic/Ultra CTAs take over.)

- [ ] **Step 6: Reorder — move "Fast & Transient" (Trust) BEFORE the FAQ**

In `<main>`, the current order after `<PricingSection/>` is FAQ then Trust. Swap them so it reads:
`<PricingSection/>` → **Trust "Fast & Transient"** → **FAQ** → (closing `</main>`).
Move the entire Trust `<section aria-labelledby="trust-title">…</section>` (currently lines 296–307) to sit immediately AFTER `<PricingSection … />` (line 276) and BEFORE the FAQ section (line 279). Leave both sections' internal markup unchanged.

- [ ] **Step 7: Replace the `FAQS` array (lines 63–85) with the expanded list**

```tsx
// Kept in sync with the FAQPage JSON-LD in index.html.
const FAQS = [
  {
    q: 'Do I need an account to use Incognito Chat?',
    a: 'No. Just pick a username and a room — no phone number, email, or sign-up required. A Google login is optional, used to save your rooms and for paid plans.',
  },
  {
    q: 'Are my messages encrypted?',
    a: "Messages are scrambled with your room's PIN, and only members who join with the correct PIN can read them. This is strong access control rather than end-to-end encryption — treat the PIN like a shared password.",
  },
  {
    q: 'What plans are available and what do they cost?',
    a: 'Incognito Chat is free to use. Basic (€5/month) unlocks 10 rooms, 100 messages per day per room, audio calls, room customization and disappearing messages. Ultra (€10/month) adds unlimited rooms and messages, video calls, screen sharing, the Inco AI assistant and 40MB uploads. You can cancel anytime from your dashboard.',
  },
  {
    q: 'How do the audio and video calls work?',
    a: "Calls connect directly between participants (peer-to-peer) when the network allows, and fall back to a secure relay otherwise. Audio calls are available on Basic and Ultra; video calls and screen sharing are Ultra (screen sharing isn't available on iPhone or iPad).",
  },
  {
    q: 'What is Inco, the AI assistant?',
    a: "Inco is an in-room AI helper available on Ultra. Mention “inco” in a message and it replies with answers and cited sources. Any signed-in member can switch it on or off for the room.",
  },
  {
    q: 'Can messages or rooms delete themselves?',
    a: 'Yes. On Basic and Ultra you can set messages to disappear on a timer, or have the entire room auto-delete after a chosen period of inactivity. Free rooms also expire automatically 24 hours after they are created.',
  },
  {
    q: 'How large can my uploads be?',
    a: 'Up to 10MB per file on Free and Basic, and 40MB on Ultra. Images are compressed automatically to save data.',
  },
  {
    q: 'Will I be notified of new messages?',
    a: 'Yes — enable web push notifications (they work even when the app is closed; on iPhone, add the app to your Home Screen first) or per-room email alerts. Your message content is never sent to the email service.',
  },
  {
    q: 'What happens when a room is deleted?',
    a: 'Any member can delete the room. Deleting it permanently removes every message and shared file for everyone — there is no archive.',
  },
  {
    q: 'Can I install it on my phone?',
    a: "Yes. It's a Progressive Web App — add it to your home screen from your browser to launch it like a native app, with optional push notifications.",
  },
];
```

- [ ] **Step 8: Build + commit**

Run `npm run build` (zero errors). Manually skim: 8 feature cards; hero shows both buttons (premium one glows) and "View Plans" smooth-scrolls to pricing; order is Pricing → Fast & Transient → FAQ; 10 FAQ items.
```bash
git add components/LandingPage.tsx components/PricingSection.tsx
git commit -m "feat(landing): full feature refresh, premium View Plans CTA, reorder, expanded FAQ"
```

---

### Task 3: Sync the FAQ JSON-LD in index.html

**Files:** Modify `index.html`

- [ ] **Step 1: Replace the `FAQPage.mainEntity` array** (lines 64–90) so its questions/answers EXACTLY match the new `FAQS` in `LandingPage.tsx` (all 10, same wording). Each entry:
```json
{
  "@type": "Question",
  "name": "<q>",
  "acceptedAnswer": { "@type": "Answer", "text": "<a>" }
}
```
Produce all 10 entries in the same order as the `FAQS` array from Task 2 Step 7. Keep the surrounding `@graph` / `SoftwareApplication` node and JSON structure intact and valid (mind the commas — it's raw JSON in a `<script type="application/ld+json">`). Use straight quotes; escape any inner quotes as `\"` and keep the `€`/curly-quote characters as literal UTF-8 (the file is UTF-8).

- [ ] **Step 2: Validate + commit**

The build doesn't type-check HTML, so validate by eye: the JSON must parse (balanced braces/brackets, commas between entries, no trailing comma). Optionally paste into a JSON validator. Run `npm run build` to confirm nothing else broke.
```bash
git add index.html
git commit -m "chore(seo): sync FAQ JSON-LD with the refreshed landing FAQ"
```

---

## Final verification
- [ ] `npm run build` passes; `npx vitest run` passes (61 tests).
- [ ] Final code-review subagent over the whole diff.
- [ ] Push to `main` (authorized) → Actions deploy.
- [ ] Device test (deferred per user): mobile dashboard — plan card only appears inside Edit Profile; desktop — standalone sidebar card. Landing — 8 features, glowing "View Plans" scrolls to pricing, order Pricing→Fast&Transient→FAQ, 10 FAQs. JSON-LD valid (Google Rich Results test optional).

## Self-review notes
- **DRY:** one `planCard` element rendered in two breakpoint-exclusive slots — no duplicated markup, reuses existing handlers/state.
- **No new deps / no DB changes.** Pure markup/content.
- **Accuracy:** feature + FAQ copy is grounded in the actual feature set (calls/AI/disappearing/notifications/uploads/tiers) and the verified Stripe prices (Basic €5 / Ultra €10). The encryption FAQ keeps the honest "access control, not E2EE" wording.
- **Consistency:** landing FAQ and index.html JSON-LD must contain identical Q/A (Task 3 mirrors Task 2 Step 7).
- **Out of scope:** restructuring the pricing cards, annual plans, animations beyond the hero CTA glow.
