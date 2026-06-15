import React from 'react';
import { Check, Sparkles, Zap, Shield } from 'lucide-react';
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
    key: 'free', name: 'Free', icon: <Shield size={22} />, accent: 'slate',
    blurb: 'For quick, private conversations.',
    features: ['1 active room', '10 messages/day per room', 'Rooms expire after 24h', 'Up to 10MB files', 'Private, PIN-locked rooms'],
  },
  {
    key: 'basic', name: 'Basic', icon: <Zap size={22} />, accent: 'blue', highlight: true,
    blurb: 'More room, more messages, audio calls.',
    features: ['10 rooms', '100 messages/day per room', 'Rooms never expire', 'Audio calls', 'Room appearance & disappearing messages', 'Up to 10MB files'],
  },
  {
    key: 'ultra', name: 'Ultra', icon: <Sparkles size={22} />, accent: 'purple',
    blurb: 'Everything, unlimited.',
    features: ['Unlimited rooms & messages', 'Video calls & screen sharing', 'Inco AI assistant', 'Up to 40MB files', 'Everything in Basic'],
  },
];

const ACCENT = {
  slate: { ring: 'border-slate-200 dark:border-slate-800', chip: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300', btn: 'bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white', check: 'text-slate-400' },
  blue: { ring: 'border-blue-300 dark:border-blue-800 ring-2 ring-blue-500/40', chip: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', btn: 'bg-blue-600 hover:bg-blue-700 text-white', check: 'text-blue-500' },
  purple: { ring: 'border-purple-300 dark:border-purple-800', chip: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400', btn: 'bg-purple-600 hover:bg-purple-700 text-white', check: 'text-purple-500' },
} as const;

const PricingSection: React.FC<PricingSectionProps> = ({ onStartFree, onChoosePlan }) => {
  const { prices, loading } = usePrices();

  const priceLabel = (key: PlanCard['key']) => {
    if (key === 'free') return { big: '€0', small: 'forever' };
    const p = key === 'basic' ? prices?.basic ?? null : prices?.ultra ?? null;
    return { big: loading ? '…' : formatPrice(p), small: `/ ${p?.interval ?? 'month'}` };
  };

  return (
    <section aria-labelledby="pricing-title" className="max-w-6xl mx-auto px-6 py-12 lg:py-20">
      <h2 id="pricing-title" className="text-3xl font-bold text-center mb-3">Simple, honest pricing</h2>
      <p className="text-center text-slate-500 dark:text-slate-400 mb-10 lg:mb-14">Start free. Upgrade when you need more. Cancel anytime.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {PLANS.map((plan) => {
          const a = ACCENT[plan.accent];
          const price = priceLabel(plan.key);
          return (
            <div key={plan.key} className={`relative h-full flex flex-col bg-white dark:bg-slate-900 p-8 rounded-3xl border shadow-sm hover:shadow-xl transition-all duration-300 ${a.ring}`}>
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-xs font-bold rounded-full bg-blue-600 text-white shadow">Most popular</span>
              )}
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${a.chip}`}>{plan.icon}</div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{plan.name}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-4">{plan.blurb}</p>
              <div className="flex items-end gap-1 mb-6">
                <span className="text-4xl font-extrabold text-slate-900 dark:text-white">{price.big}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400 mb-1">{price.small}</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                    <Check size={18} className={`shrink-0 mt-0.5 ${a.check}`} /> <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => (plan.key === 'free' ? onStartFree() : onChoosePlan(plan.key))}
                className={`w-full py-3 rounded-xl font-bold transition active:scale-[0.98] ${a.btn}`}
              >
                {plan.key === 'free' ? 'Get started' : `Choose ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">Paid plans require a Google sign-in. Prices in your local currency, billed monthly.</p>
    </section>
  );
};

export default PricingSection;
