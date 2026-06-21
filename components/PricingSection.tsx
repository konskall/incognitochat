import React from 'react';
import { Check, Sparkles, Crown, Rocket, MessageCircle } from 'lucide-react';
import { usePrices, formatPrice } from '../hooks/usePrices';

interface PricingSectionProps {
  onStartFree: () => void;                                  // Free CTA -> enter app
  onChoosePlan: (tier: 'basic' | 'ultra') => void;          // Paid CTA -> login/checkout funnel
}

interface PlanCard {
  key: 'free' | 'basic' | 'ultra';
  name: string;
  icon: React.ReactNode;
  blurb: string;
  features: string[];
  accent: 'slate' | 'blue' | 'purple';
  highlight?: boolean;
}

const PLANS: PlanCard[] = [
  {
    key: 'free', name: 'Free', icon: <MessageCircle size={22} />, accent: 'slate',
    blurb: 'For quick, private conversations.',
    features: ['1 active room', '10 messages/day per room', 'Rooms expire after 24h', 'Up to 10MB files', 'Private, PIN-locked rooms'],
  },
  {
    key: 'basic', name: 'Basic', icon: <Rocket size={22} />, accent: 'blue', highlight: true,
    blurb: 'More rooms, more messages, audio calls.',
    features: ['10 rooms', '100 messages/day per room', 'Rooms never expire', 'Audio calls', 'Room appearance & disappearing messages', 'Up to 10MB files'],
  },
  {
    key: 'ultra', name: 'Ultra', icon: <Crown size={22} />, accent: 'purple',
    blurb: 'Everything, unlimited.',
    features: ['Unlimited rooms & messages', 'Video calls', 'Screen sharing (desktop only)', 'Inco AI assistant', 'Up to 40MB files', 'Everything in Basic'],
  },
];

// Per-tier accent tokens. The card lift/glow is what fixes the "flat in dark mode"
// problem: a neutral `shadow-xl` is invisible on a near-black background, so each
// tier instead carries a COLORED glow (`hover:shadow-<color>/NN`) plus a border
// shift — both read clearly in dark mode. NB: a *black* dark glow is also invisible
// on slate-950, so the Free card uses a light slate-tinted halo (`shadow-slate-400/10`).
const ACCENT = {
  slate: {
    iconWrap: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    check: 'text-slate-500 dark:text-slate-400',
    btn: 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 focus-visible:ring-slate-500',
    cardHover: 'border-slate-100 dark:border-slate-800 shadow-sm hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-xl hover:shadow-slate-900/[0.06] dark:hover:shadow-slate-400/10',
  },
  blue: {
    iconWrap: 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/30',
    check: 'text-blue-500',
    btn: 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-500/30 focus-visible:ring-blue-500',
    cardHover: '', // featured card styles itself below
  },
  purple: {
    // fuchsia-700 (not -600) so white text clears WCAG AA contrast across the whole gradient.
    iconWrap: 'bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-lg shadow-purple-500/30',
    check: 'text-purple-500 dark:text-purple-400',
    btn: 'bg-gradient-to-r from-fuchsia-700 to-purple-600 text-white hover:from-fuchsia-600 hover:to-purple-500 shadow-lg shadow-purple-500/30 focus-visible:ring-fuchsia-500',
    cardHover: 'border-slate-100 dark:border-slate-800 shadow-sm hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-2xl hover:shadow-purple-500/20',
  },
} as const;

const PricingSection: React.FC<PricingSectionProps> = ({ onStartFree, onChoosePlan }) => {
  const { prices, loading } = usePrices();

  const priceLabel = (key: PlanCard['key']) => {
    if (key === 'free') return { big: '€0', small: 'forever' };
    const p = key === 'basic' ? prices?.basic ?? null : prices?.ultra ?? null;
    return { big: loading ? '…' : formatPrice(p), small: `/ ${p?.interval ?? 'month'}` };
  };

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="relative max-w-6xl mx-auto px-6 py-12 lg:py-20">
      {/* Soft background glow behind the featured card — gives the section depth on
          both themes. Self-clipped + pointer-events-none so it never affects layout. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-72 w-[44rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-600/[0.12]" />
      </div>

      <div className="relative z-10">
        <div className="text-center mb-12 lg:mb-16">
          <span className="inline-flex items-center rounded-full border border-blue-200/70 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-700 dark:border-blue-800/60 dark:bg-blue-900/20 dark:text-blue-300">
            Plans
          </span>
          <h2 id="pricing-title" className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">Simple, honest pricing</h2>
          <p className="mt-3 text-slate-500 dark:text-slate-400">Start free. Upgrade when you need more. Cancel anytime.</p>
        </div>

        <div role="list" className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-stretch">
          {PLANS.map((plan) => {
            const a = ACCENT[plan.accent];
            const price = priceLabel(plan.key);
            const cardCls = plan.highlight
              ? 'border-blue-300 ring-2 ring-blue-500/50 shadow-2xl shadow-blue-500/20 dark:border-blue-700 dark:shadow-blue-500/25 lg:scale-105 lg:z-10 hover:shadow-blue-500/40'
              : a.cardHover;
            return (
              <div
                key={plan.key}
                role="listitem"
                className={`group relative flex h-full flex-col rounded-3xl border bg-white p-8 transition-all duration-300 hover:-translate-y-1.5 dark:bg-slate-900 ${cardCls}`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 py-1 text-xs font-bold text-white shadow-lg shadow-blue-500/40">
                    <Sparkles size={12} /> Most popular
                  </span>
                )}

                {/* Icon on the LEFT, name + blurb to its right. flex-row wraps text
                    naturally; on a narrow card the text column shrinks (min-w-0). */}
                <div className="mb-5 flex items-start gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110 ${a.iconWrap}`}>
                    {plan.icon}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">{plan.name}</h3>
                    {/* min-height keeps the price row on a shared baseline across all three
                        cards, regardless of whether the blurb wraps to one line or two. */}
                    <p className="mt-1 min-h-[2.5rem] text-sm text-slate-500 dark:text-slate-400">{plan.blurb}</p>
                  </div>
                </div>

                <div className="mb-6 flex flex-wrap items-end gap-x-1.5" aria-busy={plan.key !== 'free' && loading}>
                  {plan.key !== 'free' && loading ? (
                    <span className="h-10 w-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800 lg:h-11" aria-label="Loading price" />
                  ) : (
                    <>
                      <span className="text-4xl font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-white lg:text-5xl">{price.big}</span>
                      <span className="mb-1 whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400 lg:mb-1.5">{price.small}</span>
                    </>
                  )}
                </div>

                <ul className="mb-8 flex-1 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                      <Check size={18} className={`mt-0.5 shrink-0 ${a.check}`} aria-hidden="true" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => (plan.key === 'free' ? onStartFree() : onChoosePlan(plan.key))}
                  className={`mt-auto w-full rounded-2xl py-3 font-bold transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 ${a.btn}`}
                >
                  {plan.key === 'free' ? 'Get started' : `Choose ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>

        <p className="mx-auto mt-8 max-w-md text-center text-xs text-slate-400 dark:text-slate-500">
          Paid plans require a Google sign-in · Prices shown in your local currency · Billed monthly, cancel anytime.
        </p>
      </div>
    </section>
  );
};

export default PricingSection;
