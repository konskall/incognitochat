
import React from 'react';
import { X, Calendar, Clock, ShieldCheck, Activity } from 'lucide-react';
import { Presence, Subscriber } from '../types';

interface UserProfileModalProps {
  user: Presence | null;
  subscriberInfo?: Subscriber | null;
  isRoomOwner: boolean;
  onClose: () => void;
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({ user, subscriberInfo, isRoomOwner, onClose }) => {
  if (!user) return null;

  const lastSeen = user.onlineAt ? new Date(user.onlineAt).toLocaleString('el-GR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  }) : 'Άγνωστο';

  const joinedAt = subscriberInfo?.created_at ? new Date(subscriberInfo.created_at).toLocaleDateString('el-GR', {
    day: 'numeric', month: 'long', year: 'numeric'
  }) : 'Πρόσφατα';

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-[320px] overflow-hidden shadow-2xl border border-white/20 dark:border-slate-800 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header - Πιο χαμηλό ύψος για λιγότερο κενό */}
        <div className="relative h-24 bg-gradient-to-br from-blue-600 to-indigo-700">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 bg-black/20 hover:bg-black/40 text-white rounded-full transition-colors backdrop-blur-md z-10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Area */}
        <div className="relative px-5 pb-8">
          {/* Avatar - Τοποθέτηση που δεν κρύβει το όνομα */}
          <div className="flex justify-center -mt-12 mb-4">
            <div className="relative inline-block">
              <img 
                src={user.avatar} 
                alt={user.username} 
                className="w-28 h-28 rounded-3xl object-cover border-4 border-white dark:bg-slate-900 shadow-lg bg-slate-200"
              />
              <div className={`absolute bottom-1 right-1 w-4 h-4 border-2 border-white dark:border-slate-900 rounded-full ${user.status === 'active' ? 'bg-green-500' : 'bg-orange-500'}`}></div>
            </div>
          </div>

          {/* User Info - Σωστή στοίχιση ονόματος */}
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-1.5 leading-tight">
              {user.username}
              {isRoomOwner && <span title="Room Owner"><ShieldCheck size={18} className="text-yellow-500 fill-yellow-500/10" /></span>}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold mt-0.5">
              {user.status === 'active' ? 'Ενεργός τώρα' : 'Εκτός σύνδεσης'}
            </p>
          </div>

          {/* Info Rows - Πιο μαζεμένο design */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800/60">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
                <Calendar size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Μέλος από</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{joinedAt}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800/60">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl">
                <Clock size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Δραστηριότητα</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{lastSeen}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800/60">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-xl">
                <Activity size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Κατάσταση</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                  {user.status === 'active' ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfileModal;
