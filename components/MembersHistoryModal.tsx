import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, Users, Clock, Trash2, UserMinus } from 'lucide-react';
import { supabase } from '../services/supabase';
import { safeAvatarUrl } from '../utils/helpers';
import { useModalA11y } from '../hooks/useModalA11y';

interface MemberRow { uid: string; username: string; joined_at: string; avatar_url: string | null; }

interface MembersHistoryModalProps {
  show: boolean;
  onClose: () => void;
  roomKey: string;
  onlineUids: string[]; // uids currently present (status === 'active')
  selfUid?: string;
  canClear?: boolean;                       // owner-only: show the Clear button + per-member remove
  onClearMembers?: () => Promise<boolean>;  // wipes membership (owner re-subscribed by caller)
  onRemoveMember?: (uid: string, username: string) => Promise<boolean>; // owner-only: remove one member
}

// Compact relative time, e.g. "5m ago", "3d ago". App code (Date.now allowed).
function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// History of everyone who has joined this room (the `subscribers` membership
// records). The subscribers SELECT RLS is self-only, so the list comes from the
// `room_members` SECURITY DEFINER RPC (gated to current members; excludes email).
const MembersHistoryModal: React.FC<MembersHistoryModalProps> = ({ show, onClose, roomKey, onlineUids, selfUid, canClear, onClearMembers, onRemoveMember }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set()); // uids whose avatar img failed
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<MemberRow | null>(null); // row awaiting remove confirm
  const [removingUid, setRemovingUid] = useState<string | null>(null);        // remove in flight

  useEffect(() => {
    if (!show || !roomKey) return;
    let alive = true;
    setMembers(null);
    setError(false);
    setConfirming(false);
    setPendingRemove(null);
    setFailed(new Set());
    supabase.rpc('room_members', { p_room_key: roomKey }).then(({ data, error: err }) => {
      if (!alive) return;
      if (err) { console.error('room_members failed', err); setError(true); return; }
      setMembers((data as MemberRow[]) ?? []);
    });
    return () => { alive = false; };
  }, [show, roomKey, reload]);

  if (!show) return null;

  const online = new Set(onlineUids);

  const handleClear = async () => {
    if (!onClearMembers) return;
    setClearing(true);
    const ok = await onClearMembers();
    setClearing(false);
    setConfirming(false);
    if (ok) setReload((r) => r + 1);
  };

  const handleRemove = async (m: MemberRow) => {
    if (!onRemoveMember) return;
    setRemovingUid(m.uid);
    const ok = await onRemoveMember(m.uid, m.username);
    setRemovingUid(null);
    setPendingRemove(null);
    if (ok) setReload((r) => r + 1);
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex sm:items-center sm:justify-center sm:p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Members"
        onClick={(e) => e.stopPropagation()}
        className="outline-none bg-white dark:bg-slate-900 w-full h-[100dvh] sm:h-auto sm:max-h-[80vh] sm:max-w-md sm:rounded-3xl shadow-2xl border border-white/10 dark:border-slate-800 overflow-y-auto flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
      >
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 pt-[calc(0.625rem+env(safe-area-inset-top))]">
          <button onClick={onClose} aria-label="Back" className="p-2 -ml-1 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition sm:hidden">
            <ChevronLeft size={22} />
          </button>
          <h3 className="font-bold text-slate-800 dark:text-white text-sm">Members{members ? ` · ${members.length}` : ''}</h3>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-1 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition max-sm:hidden">
            <X size={20} />
          </button>
          <span className="w-8 sm:hidden" />
        </div>

        <p className="px-4 pt-3 pb-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">Everyone who has joined this room</p>

        {/* Loading skeleton */}
        {members === null && !error && (
          <div className="p-3 space-y-2" role="status" aria-label="Loading members">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-1 py-2 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="h-2.5 w-1/4 rounded bg-slate-100 dark:bg-slate-800/60" />
                </div>
              </div>
            ))}
            <span className="sr-only">Loading members…</span>
          </div>
        )}

        {error && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 text-slate-400">
            <Users size={32} className="mb-2 opacity-40" />
            <p className="text-sm font-medium">Couldn't load members. Please try again.</p>
          </div>
        )}

        {members && members.length === 0 && !error && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 text-slate-400">
            <Users size={32} className="mb-2 opacity-40" />
            <p className="text-sm font-medium">No members yet.</p>
          </div>
        )}

        {members && members.length > 0 && (
          <ul className="px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            {members.map((m) => {
              const isOnline = online.has(m.uid);
              const isSelf = !!selfUid && m.uid === selfUid;
              return (
                <li key={m.uid} className="flex items-center gap-3 px-2 py-2.5 rounded-xl">
                  <div className="relative shrink-0">
                    {m.avatar_url && !failed.has(m.uid) ? (
                      <img
                        src={safeAvatarUrl(m.avatar_url)}
                        alt=""
                        loading="lazy"
                        onError={() => setFailed((f) => { const n = new Set(f); n.add(m.uid); return n; })}
                        className="w-10 h-10 rounded-full object-cover bg-slate-200 dark:bg-slate-800"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                        {m.username.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    {isOnline && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 ring-2 ring-white dark:ring-slate-900" title="Online" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">
                      {m.username}{isSelf && <span className="ml-1.5 text-[10px] font-bold text-blue-500">You</span>}
                    </p>
                    <p className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                      <Clock size={10} /> joined {timeAgo(m.joined_at)}
                      {isOnline && <span className="ml-1 font-semibold text-green-500">· Online</span>}
                    </p>
                  </div>

                  {/* Owner-only per-member remove (kick). Hidden on self; the
                      server RPC re-checks ownership and refuses self-removal. */}
                  {canClear && !isSelf && onRemoveMember && (
                    pendingRemove?.uid === m.uid ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => setPendingRemove(null)}
                          disabled={removingUid === m.uid}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleRemove(m)}
                          disabled={removingUid === m.uid}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-500 transition active:scale-95 disabled:opacity-60"
                        >
                          {removingUid === m.uid ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPendingRemove(m)}
                        aria-label={`Remove ${m.username}`}
                        title="Remove member"
                        className="shrink-0 p-2 rounded-full text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition"
                      >
                        <UserMinus size={16} />
                      </button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Owner-only: wipe the room's membership. Removed members can rejoin
            with the PIN; the caller re-subscribes the owner so their session
            keeps working. */}
        {canClear && (members?.length ?? 0) > 0 && (
          <div className="sticky bottom-0 mt-auto border-t border-slate-100 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition active:scale-[0.99]"
              >
                <Trash2 size={16} /> Clear members
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-center text-xs text-slate-500 dark:text-slate-400">Remove all members? Everyone can rejoin with the PIN.</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirming(false)} disabled={clearing} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50">Cancel</button>
                  <button onClick={handleClear} disabled={clearing} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-500 transition active:scale-95 disabled:opacity-60">{clearing ? 'Clearing…' : 'Clear all'}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default MembersHistoryModal;
