
import React from 'react';
import { ShieldAlert, Mail, X } from 'lucide-react';

interface DeleteModalProps {
  show: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

interface EmailModalProps {
  show: boolean;
  onCancel: () => void;
  onSave: () => void;
  isSaving: boolean;
  emailAlertsEnabled: boolean;
  onToggleOff: () => void;
  emailAddress: string;
  setEmailAddress: (email: string) => void;
}

export const DeleteChatModal: React.FC<DeleteModalProps> = ({ show, onCancel, onConfirm, isDeleting }) => {
  if (!show) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-sm w-full shadow-2xl scale-100 animate-in zoom-in-95 duration-200 border border-white/10 dark:border-slate-800">
            <div className="flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center text-red-500">
                    <ShieldAlert size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">Delete Conversation?</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                    Permanently delete the room and all messages for everyone?
                </p>
                <div className="flex gap-3 w-full mt-2">
                    <button 
                        onClick={onCancel}
                        className="flex-1 py-3 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={onConfirm}
                        disabled={isDeleting}
                        className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl shadow-lg shadow-red-500/30 transition"
                    >
                        {isDeleting ? 'Deleting...' : 'Delete All'}
                    </button>
                </div>
            </div>
        </div>
    </div>
  );
};

export const EmailAlertModal: React.FC<EmailModalProps> = ({ 
    show, 
    onCancel, 
    onSave, 
    isSaving, 
    emailAlertsEnabled, 
    onToggleOff, 
    emailAddress, 
    setEmailAddress 
}) => {
  if (!show) return null;

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-sm w-full shadow-2xl scale-100 animate-in zoom-in-95 duration-200 border border-white/10 dark:border-slate-800">
              <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                          <Mail size={20} className="text-blue-500"/>
                          Email Alerts
                      </h3>
                      <button onClick={onCancel} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
                          <X size={18} className="text-slate-400"/>
                      </button>
                  </div>
                  
                  {emailAlertsEnabled ? (
                      <div className="space-y-3">
                          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-sm border border-blue-100 dark:border-blue-800">
                              <p className="text-slate-600 dark:text-slate-300">You are receiving alerts at:</p>
                              <p className="font-semibold text-blue-600 dark:text-blue-400 mt-1 truncate">{emailAddress}</p>
                          </div>
                          <button 
                              onClick={onToggleOff}
                              className="w-full py-2.5 text-red-500 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 rounded-xl font-semibold text-sm transition"
                          >
                              Turn Off Alerts
                          </button>
                      </div>
                  ) : (
                      <div className="space-y-3">
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                              Get notified when someone sends a message or deletes this room.
                          </p>
                          <input 
                              type="email" 
                              value={emailAddress}
                              onChange={(e) => setEmailAddress(e.target.value)}
                              placeholder="your@email.com"
                              className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 focus:border-blue-500 outline-none text-slate-900 dark:text-slate-100"
                          />
                          <button 
                              onClick={onSave}
                              disabled={isSaving}
                              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-500/30 transition disabled:opacity-50"
                          >
                              {isSaving ? 'Saving...' : 'Subscribe'}
                          </button>
                      </div>
                  )}
              </div>
          </div>
      </div>
  );
};
