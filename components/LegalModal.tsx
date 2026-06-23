import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Shield, UserCog, FileText, CreditCard, Flag, Mail } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';

interface LegalModalProps {
  show: boolean;
  onClose: () => void;
}

const CONTACT = 'info@incognitochat.gr';
const LAST_UPDATED = '23 June 2026';

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <section className="border-t border-slate-100 dark:border-slate-800 pt-5 first:border-t-0 first:pt-0">
    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white mb-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 shrink-0">{icon}</span>
      {title}
    </h3>
    <div className="text-sm leading-relaxed text-slate-500 dark:text-slate-400 space-y-2">{children}</div>
  </section>
);

// Privacy / Terms / GDPR / billing / abuse baseline for a live, paid, EU-operated
// service. Shown from the landing footer. NOTE: this is a sensible starting point —
// have it reviewed by a professional for your jurisdiction.
const LegalModal: React.FC<LegalModalProps> = ({ show, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);
  if (!show) return null;

  const mailto = (
    <a href={`mailto:${CONTACT}`} className="font-semibold text-blue-600 dark:text-blue-400 hover:underline break-all">{CONTACT}</a>
  );

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Privacy and Terms"
        className="outline-none flex flex-col w-full max-w-2xl max-h-[88vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">Privacy &amp; Terms</h2>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Last updated: {LAST_UPDATED}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition shrink-0">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          <Section icon={<Shield size={15} />} title="Privacy">
            <p>Incognito Chat is built to collect as little as possible. We never sell your data or use it for advertising.</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><b>Account:</b> if you chat anonymously we store only a random anonymous ID. If you sign in with Google we store your Google account ID, email, name and profile picture, so we can save your rooms.</li>
              <li><b>Rooms &amp; messages:</b> room names, your membership and your messages (including attachments, voice notes, polls and shared locations) are stored on our servers so conversations work across devices. Access to a room's content is controlled by the room PIN and membership — it is not marketed as end-to-end encrypted.</li>
              <li><b>Notifications:</b> if you enable them we store a push subscription and/or your choice to receive email alerts. Alerts never contain your message content.</li>
              <li><b>Payments:</b> paid plans are handled by Stripe; we store your Stripe customer ID and current plan, never your card details.</li>
              <li><b>Technical:</b> standard server logs needed to run and secure the service.</li>
            </ul>
            <p>We rely on these processors: <b>Supabase</b> (hosting, database, file storage), <b>Stripe</b> (payments), <b>Google</b> (optional sign-in and the AI assistant), and infrastructure providers for map tiles, avatar generation, call relay and email delivery.</p>
          </Section>

          <Section icon={<UserCog size={15} />} title="Your data &amp; your rights">
            <p>You can ask us to access, correct, export or delete your personal data at any time by emailing {mailto}. On request we delete your account, the rooms you own, your messages and your subscriber records. Rooms can also be set to auto-delete and messages to disappear on a timer — when a room is deleted, its messages and files are removed.</p>
            <p>You must be at least <b>16 years old</b> to use Incognito Chat.</p>
          </Section>

          <Section icon={<FileText size={15} />} title="Acceptable use">
            <p>By using Incognito Chat you agree to use it lawfully and to not post illegal, abusive, infringing or harmful content, and not to harass others. Rooms are created by users and are not pre-moderated; you are responsible for the content you share.</p>
            <p>The AI assistant (“inco”) can be wrong — don't rely on it for important decisions. The service is provided “as is”, without warranties, to the fullest extent permitted by law.</p>
          </Section>

          <Section icon={<CreditCard size={15} />} title="Subscriptions &amp; billing">
            <p>Basic and Ultra are recurring subscriptions billed through Stripe. You can view invoices and change or cancel your plan anytime from the billing portal in the app. Cancelling stops future charges; your plan stays active until the end of the paid period. For refund requests, contact us.</p>
          </Section>

          <Section icon={<Flag size={15} />} title="Reporting abuse or illegal content">
            <p>To report abuse, harassment or illegal content, email {mailto} with the room name and details. We review reports and may remove content or restrict access.</p>
          </Section>

          <Section icon={<Mail size={15} />} title="Contact">
            <p>Questions, data requests and reports: {mailto}.</p>
          </Section>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition active:scale-[0.98]">Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default LegalModal;
