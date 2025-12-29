
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabase';
import { User, ChatConfig, Room } from '../types';
import { generateRoomKey, compressImage } from '../utils/helpers';
import { 
  LogOut, Trash2, ArrowRight, Loader2, 
  Upload, RotateCcw,
  RefreshCw, Save, X, Edit2, Mail, LogIn, BellRing, Link as LinkIcon, AlertCircle, Eye, EyeOff, GripVertical
} from 'lucide-react';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

const RoomDeleteToast: React.FC<{ 
    roomName: string; 
    isOwner: boolean; 
    onConfirm: () => void; 
    onCancel: () => void; 
    isDeleting: boolean;
}> = ({ roomName, isOwner, onConfirm, onCancel, isDeleting }) => {
    return createPortal(
        <div className="fixed bottom-6 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-auto z-[100] animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-6 p-4 bg-slate-900/90 dark:bg-white/10 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl text-white ring-1 ring-black/10">
                <div className="flex flex-col items-center sm:items-start text-center sm:text-left w-full sm:w-auto min-w-[200px]">
                    <span className="text-sm font-bold flex items-center justify-center sm:justify-start gap-2 text-white">
                        <AlertCircle size={18} className="text-red-400 shrink-0" />
                        <span>{isOwner ? 'Delete Room;' : 'Remove from History;'}</span>
                    </span>
                    <span className="text-[11px] text-white/60 mt-0.5">
                        {isOwner 
                            ? `The "${roomName}" will be permanently deleted.` 
                            : `Removing "${roomName}" from the list.`}
                    </span>
                </div>
                <div className="hidden sm:block h-8 w-px bg-white/10"></div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <button onClick={onCancel} disabled={isDeleting} className="flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors text-center border border-white/5">Cancel</button>
                    <button onClick={onConfirm} disabled={isDeleting} className="flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-lg shadow-red-500/20 transition-all active:scale-95 flex items-center justify-center gap-1.5">
                        {isDeleting ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14} />}
                        <span>{isOwner ? 'Delete' : 'Remove'}</span>
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPin, setNewRoomPin] = useState('');
  const [creating, setCreating] = useState(false);
  const [unreadRooms, setUnreadRooms] = useState<Set<string>>(new Set());
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [googleAvatarUrl, setGoogleAvatarUrl] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [tempAvatarUrl, setTempAvatarUrl] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [roomToDelete, setRoomToDelete] = useState<{name: string, key: string, isOwner: boolean} | null>(null);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);

  // New States for PIN and Drag
  const [revealedPins, setRevealedPins] = useState<Set<string>>(new Set());
  const [draggedRoomIndex, setDraggedRoomIndex] = useState<number | null>(null);

  useEffect(() => {
    const initData = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
          const meta = authUser.user_metadata || {};
          const finalName = meta.display_name || meta.full_name || meta.name || localStorage.getItem('chatUsername') || user.email?.split('@')[0] || 'User';
          const original = meta.picture || meta.avatar_url || `https://ui-avatars.com/api/?name=${finalName}&background=random`;
          setGoogleAvatarUrl(original);
          const finalAvatar = meta.custom_avatar || localStorage.getItem('chatAvatarURL') || original;
          setDisplayName(finalName);
          setAvatarUrl(finalAvatar);
          setTempAvatarUrl(finalAvatar);
          localStorage.setItem('chatUsername', finalName);
          localStorage.setItem('chatAvatarURL', finalAvatar);
      }

      try {
        const { data: createdRooms, error: createdError } = await supabase.from('rooms').select('*').eq('created_by', user.uid);
        if (createdError) throw createdError;
        const { data: subscriptions, error: subError } = await supabase.from('subscribers').select('room_key').eq('uid', user.uid);
        if (subError) throw subError;

        let joinedRooms: Room[] = [];
        if (subscriptions && subscriptions.length > 0) {
            const keys = subscriptions.map(s => s.room_key);
            const { data: foundJoinedRooms, error: joinedRoomsError } = await supabase.from('rooms').select('*').in('room_key', keys);
            if (joinedRoomsError) throw joinedRoomsError;
            joinedRooms = foundJoinedRooms || [];
        }

        const roomMap = new Map<string, Room>();
        (createdRooms || []).forEach(r => roomMap.set(r.room_key, r));
        (joinedRooms || []).forEach(r => roomMap.set(r.room_key, r));
        
        const allRooms = Array.from(roomMap.values());
        
        // Load custom order from localStorage if exists
        const savedOrder = localStorage.getItem(`roomOrder_${user.uid}`);
        if (savedOrder) {
            const orderKeys = JSON.parse(savedOrder);
            allRooms.sort((a, b) => {
                const indexA = orderKeys.indexOf(a.room_key);
                const indexB = orderKeys.indexOf(b.room_key);
                if (indexA === -1 && indexB === -1) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            });
        } else {
            allRooms.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        }

        setRooms(allRooms);
        checkUnreadMessages(allRooms);
      } catch (error) {
        console.error('Error fetching rooms:', error);
      } finally {
        setLoadingRooms(false);
      }
    };
    initData();
  }, [user.uid, user.email]);

  useEffect(() => {
    const channel = supabase.channel('dashboard-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
                const newMsg = payload.new;
                if (newMsg.uid === user.uid || newMsg.type === 'system') return;
                const hasRoom = rooms.some(r => r.room_key === newMsg.room_key);
                if (hasRoom) {
                    setUnreadRooms(prev => new Set(prev).add(newMsg.room_key));
                }
            }
        ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rooms, user.uid]);

  const checkUnreadMessages = async (currentRooms: Room[]) => {
      if (currentRooms.length === 0) return;
      const newUnreadSet = new Set<string>();
      await Promise.all(currentRooms.map(async (room) => {
          try {
              const lastReadTimestamp = localStorage.getItem(`lastRead_${room.room_key}`);
              const lastReadTime = lastReadTimestamp ? parseInt(lastReadTimestamp) : Date.now();
              const { data: latestMsg, error } = await supabase.from('messages').select('created_at').eq('room_key', room.room_key).neq('type', 'system').order('created_at', { ascending: false }).limit(1).maybeSingle();
              if (!error && latestMsg) {
                  const msgTime = new Date(latestMsg.created_at).getTime();
                  if (msgTime > lastReadTime) newUnreadSet.add(room.room_key);
              }
          } catch (err) {
              console.error(`Error checking unread for ${room.room_name}`, err);
          }
      }));
      setUnreadRooms(newUnreadSet);
  };

  const handleSaveProfile = async () => {
      if (!displayName.trim()) { alert("Display name cannot be empty"); return; }
      setIsSavingProfile(true);
      try {
          const updates = { display_name: displayName, full_name: displayName, custom_avatar: tempAvatarUrl, avatar_url: tempAvatarUrl };
          const { error } = await supabase.auth.updateUser({ data: updates });
          if (error) throw error;
          setAvatarUrl(tempAvatarUrl);
          localStorage.setItem('chatUsername', displayName);
          localStorage.setItem('chatAvatarURL', tempAvatarUrl);
          setIsEditingProfile(false);
          setShowLinkInput(false);
      } catch (e: any) {
          alert("Failed to update profile: " + e.message);
      } finally {
          setIsSavingProfile(false);
      }
  };

  const handleGenerateRandomAvatar = () => {
      const seed = Math.random().toString(36).substring(7);
      setTempAvatarUrl(`https://api.dicebear.com/9.x/bottts/svg?seed=${seed}`);
  };

  const handleRestoreGoogleAvatar = () => { if (googleAvatarUrl) setTempAvatarUrl(googleAvatarUrl); };

  const handleLinkAvatar = () => {
      if (linkInput.trim().startsWith('http')) {
          setTempAvatarUrl(linkInput.trim());
          setShowLinkInput(false);
      }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || !e.target.files[0]) return;
      const file = e.target.files[0];
      try {
          const compressed = await compressImage(file);
          const fileExt = compressed.name.split('.').pop();
          const fileName = `avatar_${Date.now()}.${fileExt}`;
          const filePath = `profiles/${user.uid}/${fileName}`;
          const { error: uploadError } = await supabase.storage.from('attachments').upload(filePath, compressed);
          if (uploadError) throw uploadError;
          const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(filePath);
          setTempAvatarUrl(publicUrl);
      } catch (err: any) {
          alert("Failed to upload image.");
      }
  };

  const handleJoin = (room: Room) => {
    localStorage.setItem(`lastRead_${room.room_key}`, Date.now().toString());
    const newUnread = new Set(unreadRooms);
    newUnread.delete(room.room_key);
    setUnreadRooms(newUnread);
    onJoinRoom({ username: displayName, avatarURL: avatarUrl, roomName: room.room_name, pin: room.pin, roomKey: room.room_key });
  };

  const onRequestDeleteRoom = (roomName: string, roomKey: string, createdBy: string) => {
      setRoomToDelete({ name: roomName, key: roomKey, isOwner: createdBy === user.uid });
  };

  const handleConfirmDeleteRoom = async () => {
    if (!roomToDelete) return;
    setIsDeletingRoom(true);
    const { key, isOwner } = roomToDelete;
    try {
        if (!isOwner) {
             await supabase.from('subscribers').delete().eq('room_key', key).eq('uid', user.uid);
             setRooms(rooms.filter(r => r.room_key !== key));
        } else {
             await supabase.from('messages').delete().eq('room_key', key);
             await supabase.from('subscribers').delete().eq('room_key', key);
             const { data: files } = await supabase.storage.from('attachments').list(key);
             if (files && files.length > 0) {
                 const filesToRemove = files.map(x => `${key}/${x.name}`);
                 await supabase.storage.from('attachments').remove(filesToRemove);
             }
             const { error } = await supabase.from('rooms').delete().eq('room_key', key);
             if (error) throw error;
             setRooms(rooms.filter(r => r.room_key !== key));
        }
    } catch (e: any) {
        alert('Operation failed: ' + (e.message || "Unknown error"));
    } finally {
        setIsDeletingRoom(false);
        setRoomToDelete(null);
    }
  };

  const handleCreateOrJoinRoom = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newRoomName || !newRoomPin) return;
      setCreating(true);
      const roomKey = generateRoomKey(newRoomPin, newRoomName);
      try {
           const { data: existingRoom, error: fetchError } = await supabase.from('rooms').select('*').eq('room_key', roomKey).maybeSingle();
           if (fetchError) throw fetchError;
           if (existingRoom) {
               await supabase.from('subscribers').upsert({ room_key: roomKey, uid: user.uid, username: displayName, email: '' }, { onConflict: 'room_key, uid' });
               localStorage.setItem(`lastRead_${existingRoom.room_key}`, Date.now().toString());
               onJoinRoom({ username: displayName, avatarURL: avatarUrl, roomName: existingRoom.room_name, pin: existingRoom.pin, roomKey: existingRoom.room_key });
           } else {
               const { data, error } = await supabase.from('rooms').insert({ room_key: roomKey, room_name: newRoomName, pin: newRoomPin, created_by: user.uid }).select().single();
               if (error) throw error;
               if (data) {
                   localStorage.setItem(`lastRead_${data.room_key}`, Date.now().toString());
                   setRooms([data, ...rooms]);
                   setNewRoomName('');
                   setNewRoomPin('');
                   setShowCreate(false);
               }
           }
      } catch (e: any) {
          alert("Failed to create or join room: " + e.message);
      } finally {
          setCreating(false);
      }
  };

  // --- PIN Visibility Toggle ---
  const togglePinVisibility = (e: React.MouseEvent, roomKey: string) => {
    e.stopPropagation();
    setRevealedPins(prev => {
        const next = new Set(prev);
        if (next.has(roomKey)) next.delete(roomKey);
        else next.add(roomKey);
        return next;
    });
  };

  // --- Drag and Drop Logic ---
  const onDragStart = (index: number) => {
    setDraggedRoomIndex(index);
  };

  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedRoomIndex === null || draggedRoomIndex === index) return;
    
    const newRooms = [...rooms];
    const draggedItem = newRooms[draggedRoomIndex];
    newRooms.splice(draggedRoomIndex, 1);
    newRooms.splice(index, 0, draggedItem);
    
    setDraggedRoomIndex(index);
    setRooms(newRooms);
  };

  const onDragEnd = () => {
    setDraggedRoomIndex(null);
    // Save order to localStorage
    const orderKeys = rooms.map(r => r.room_key);
    localStorage.setItem(`roomOrder_${user.uid}`, JSON.stringify(orderKeys));
  };

  return (
    <>
    {roomToDelete && (
        <RoomDeleteToast
            roomName={roomToDelete.name}
            isOwner={roomToDelete.isOwner}
            onConfirm={handleConfirmDeleteRoom}
            onCancel={() => setRoomToDelete(null)}
            isDeleting={isDeletingRoom}
        />
    )}

    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white transition-colors duration-300">
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            <header className="flex justify-between items-center mb-8 pb-6 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    <img src="https://konskall.github.io/incognitochat/favicon-96x96.png" alt="Incognito Chat" className="w-10 h-10 rounded-xl shadow-lg shadow-blue-500/20"/>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Welcome back to your secure space</p>
                    </div>
                </div>
                <button onClick={onLogout} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm">
                    <LogOut size={16} />
                    <span className="hidden sm:inline">Logout</span>
                </button>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-4 xl:col-span-3 space-y-6">
                    <div className="bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-950 rounded-2xl shadow-lg shadow-slate-200/50 dark:shadow-none border border-slate-200/60 dark:border-slate-800 p-5 transition-all duration-300 relative overflow-hidden group">
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none group-hover:bg-blue-500/20 transition-all duration-500"></div>
                        {isEditingProfile ? (
                            <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300 relative z-10">
                                <div className="flex flex-col items-center gap-4">
                                    <div className="relative group/edit-avatar">
                                        <img src={tempAvatarUrl} alt="Preview" className="w-24 h-24 rounded-full object-cover border-4 border-white dark:border-slate-800 shadow-md ring-1 ring-slate-100 dark:ring-slate-700"/>
                                        <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover/edit-avatar:opacity-100 transition-opacity">
                                            <span className="text-white text-xs font-bold">Preview</span>
                                        </div>
                                    </div>
                                    <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full text-center px-3 py-2 border-b-2 border-slate-200 dark:border-slate-700 bg-transparent focus:border-blue-500 outline-none transition-all font-bold text-lg text-slate-800 dark:text-white placeholder:font-normal" placeholder="Display Name"/>
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                    <label className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Upload Photo">
                                        <Upload size={18} className="text-blue-600 dark:text-blue-400" />
                                        <span className="text-[9px] font-bold text-slate-500 uppercase">Upload</span>
                                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
                                    </label>
                                    <button onClick={handleGenerateRandomAvatar} className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Random Avatar">
                                        <RefreshCw size={18} className="text-purple-600 dark:text-purple-400" />
                                        <span className="text-[9px] font-bold text-slate-500 uppercase">Random</span>
                                    </button>
                                    <button onClick={() => setShowLinkInput(!showLinkInput)} className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Link URL">
                                        <LinkIcon size={18} className="text-orange-600 dark:text-orange-400" />
                                        <span className="text-[9px] font-bold text-slate-500 uppercase">Link</span>
                                    </button>
                                    <button onClick={handleRestoreGoogleAvatar} className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Restore Original">
                                        <RotateCcw size={18} className="text-green-600 dark:text-green-400" />
                                        <span className="text-[9px] font-bold text-slate-500 uppercase">Reset</span>
                                    </button>
                                </div>
                                {showLinkInput && (
                                    <div className="flex relative animate-in slide-in-from-top-2 fade-in">
                                        <input type="text" value={linkInput} onChange={(e) => setLinkInput(e.target.value)} placeholder="https://image-url.png" className="w-full pl-3 pr-9 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"/>
                                        <button onClick={handleLinkAvatar} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-200 transition">
                                            <ArrowRight size={12} />
                                        </button>
                                    </div>
                                )}
                                <div className="flex gap-3 pt-2">
                                    <button onClick={() => { setIsEditingProfile(false); setShowLinkInput(false); }} className="flex-1 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition">Cancel</button>
                                    <button onClick={handleSaveProfile} disabled={isSavingProfile} className="flex-1 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg shadow-md hover:bg-blue-700 transition flex items-center justify-center gap-2">{isSavingProfile ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}Save Changes</button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-5 animate-in fade-in zoom-in-95 duration-300 relative z-10">
                                <div className="relative flex-shrink-0 group/avatar">
                                    <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full opacity-0 group-hover/avatar:opacity-100 transition duration-500 blur-sm"></div>
                                    <img src={avatarUrl} alt="Profile" className="relative w-20 h-20 rounded-full object-cover border-4 border-white dark:border-slate-900 shadow-lg"/>
                                    <button onClick={() => { setTempAvatarUrl(avatarUrl); setIsEditingProfile(true); }} className="absolute bottom-0 right-0 p-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-full shadow-md border border-slate-100 dark:border-slate-700 hover:text-blue-600 hover:scale-110 transition-all z-20" title="Edit Profile"><Edit2 size={12} /></button>
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-center h-20">
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white truncate tracking-tight" title={displayName}>{displayName}</h3>
                                    <div className="flex items-center gap-2 mt-1 text-slate-500 dark:text-slate-400">
                                        <div className="p-1 bg-slate-100 dark:bg-slate-800 rounded-md"><Mail size={10} className="flex-shrink-0" /></div>
                                        <span className="text-xs font-medium truncate opacity-80" title={user.email}>{user.email}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="lg:col-span-8 xl:col-span-9 space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                         <div className="p-6">
                            {!showCreate ? (
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Join or Create Room</h3>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">Enter a room name and PIN to connect</p>
                                    </div>
                                    <button onClick={() => setShowCreate(true)} className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"><LogIn size={20} />Enter / Create Room</button>
                                </div>
                            ) : (
                                <form onSubmit={handleCreateOrJoinRoom} className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
                                        <h3 className="font-semibold text-lg">Room Access</h3>
                                        <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition"><X size={20} /></button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Room Name</label>
                                            <input type="text" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none transition" placeholder="e.g. Project Alpha" required/>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Access PIN</label>
                                            <input type="text" value={newRoomPin} onChange={e => setNewRoomPin(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none transition" placeholder="Secret Key" required/>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center pt-2">
                                        <p className="text-xs text-slate-500 italic">If the room exists, you will join it. Otherwise, a new room will be created.</p>
                                        <button type="submit" disabled={creating} className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2">{creating ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}Enter Room</button>
                                    </div>
                                </form>
                            )}
                         </div>
                    </div>

                    <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 px-1">Your Rooms</h3>
                        {loadingRooms ? (
                            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-400" size={32} /></div>
                        ) : rooms.length === 0 ? (
                            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800">
                                <p className="text-slate-500 dark:text-slate-400">You haven't created or joined any rooms yet.</p>
                                <button onClick={() => setShowCreate(true)} className="text-blue-500 font-semibold mt-2 hover:underline">Create or Join one now</button>
                            </div>
                        ) : (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
                                {rooms.map((room, index) => (
                                    <div 
                                        key={room.id} 
                                        draggable
                                        onDragStart={() => onDragStart(index)}
                                        onDragOver={(e) => onDragOver(e, index)}
                                        onDragEnd={onDragEnd}
                                        className={`group bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-800 transition-all duration-300 flex flex-col justify-between relative overflow-hidden cursor-grab active:cursor-grabbing ${draggedRoomIndex === index ? 'opacity-40 scale-95 border-blue-500' : ''}`}
                                    >
                                        <div className="mb-4 relative z-10">
                                            <div className="flex justify-between items-start mb-2">
                                                <h4 className="font-bold text-lg text-slate-800 dark:text-slate-100 truncate pr-2 flex items-center gap-2">
                                                    <GripVertical size={16} className="text-slate-300 dark:text-slate-600 shrink-0" />
                                                    {room.room_name}
                                                    {unreadRooms.has(room.room_key) && (
                                                        <span className="flex h-2.5 w-2.5 relative">
                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                                                        </span>
                                                    )}
                                                </h4>
                                                <button onClick={() => onRequestDeleteRoom(room.room_name, room.room_key, room.created_by)} className="text-slate-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition opacity-0 group-hover:opacity-100" title={room.created_by === user.uid ? "Delete Room" : "Remove from History"}>
                                                    {room.created_by === user.uid ? <Trash2 size={16} /> : <X size={16} />}
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                                <div 
                                                    onClick={(e) => togglePinVisibility(e, room.room_key)}
                                                    className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md font-mono border border-slate-200 dark:border-slate-700 hover:border-blue-300 transition-colors cursor-pointer select-none"
                                                    title="Click to reveal PIN"
                                                >
                                                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">PIN:</span>
                                                    <span className="font-bold text-slate-700 dark:text-blue-400 min-w-[32px] text-center">
                                                        {revealedPins.has(room.room_key) ? room.pin : '••••'}
                                                    </span>
                                                    {revealedPins.has(room.room_key) ? <EyeOff size={12} className="text-blue-500" /> : <Eye size={12} className="text-slate-400" />}
                                                </div>
                                                {room.created_by === user.uid && <span className="text-blue-500 font-medium">Owner</span>}
                                                <span>•</span>
                                                <span>{new Date(room.created_at).toLocaleDateString()}</span>
                                            </div>
                                            {unreadRooms.has(room.room_key) && (
                                                <div className="mt-3 flex items-center gap-1.5 text-xs font-bold text-red-500 dark:text-red-400 animate-pulse">
                                                    <BellRing size={14} />
                                                    <span>New messages</span>
                                                </div>
                                            )}
                                        </div>
                                        <button onClick={() => handleJoin(room)} className={`w-full py-2.5 font-semibold rounded-xl transition flex items-center justify-center gap-2 z-10 ${unreadRooms.has(room.room_key) ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 group-hover:bg-red-500 group-hover:text-white group-hover:border-red-500' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-600 dark:group-hover:text-white'}`}>
                                            Enter Room <ArrowRight size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    </div>
    </>
  );
};

export default DashboardScreen;
