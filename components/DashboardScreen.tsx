
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { User, ChatConfig, Room } from '../types';
import { generateRoomKey, compressImage } from '../utils/helpers';
import { 
  LogOut, Trash2, ArrowRight, Loader2, 
  Camera, 
  RefreshCw, Save, X, Edit2, Mail, LogIn, BellRing
} from 'lucide-react';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
  // Room State
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPin, setNewRoomPin] = useState('');
  const [creating, setCreating] = useState(false);
  
  // Notification State
  const [unreadRooms, setUnreadRooms] = useState<Set<string>>(new Set());

  // Profile State
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  // Avatar Editing State
  const [tempAvatarUrl, setTempAvatarUrl] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load User Data & Rooms
  useEffect(() => {
    const initData = async () => {
      // 1. Fetch latest user metadata from Supabase
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (authUser) {
          const meta = authUser.user_metadata || {};
          
          const finalName = meta.display_name || meta.full_name || meta.name || localStorage.getItem('chatUsername') || user.email?.split('@')[0] || 'User';
          
          const finalAvatar = meta.custom_avatar || meta.avatar_url || meta.picture || localStorage.getItem('chatAvatarURL') || `https://ui-avatars.com/api/?name=${finalName}&background=random`;
          
          setDisplayName(finalName);
          setAvatarUrl(finalAvatar);
          setTempAvatarUrl(finalAvatar);

          localStorage.setItem('chatUsername', finalName);
          localStorage.setItem('chatAvatarURL', finalAvatar);
      }

      // 2. Fetch Rooms (Created AND Joined)
      try {
        // A. Fetch Created Rooms
        const { data: createdRooms, error: createdError } = await supabase
          .from('rooms')
          .select('*')
          .eq('created_by', user.uid);

        if (createdError) throw createdError;

        // B. Fetch Joined Rooms (via subscribers table)
        const { data: subscriptions, error: subError } = await supabase
          .from('subscribers')
          .select('room_key')
          .eq('uid', user.uid);
        
        if (subError) throw subError;

        let joinedRooms: Room[] = [];
        if (subscriptions && subscriptions.length > 0) {
            const keys = subscriptions.map(s => s.room_key);
            // Fetch room details for these keys (this automatically filters out deleted rooms)
            const { data: foundJoinedRooms, error: joinedRoomsError } = await supabase
                .from('rooms')
                .select('*')
                .in('room_key', keys);
            
            if (joinedRoomsError) throw joinedRoomsError;
            joinedRooms = foundJoinedRooms || [];
        }

        // C. Merge and Deduplicate based on room_key
        const roomMap = new Map<string, Room>();
        (createdRooms || []).forEach(r => roomMap.set(r.room_key, r));
        (joinedRooms || []).forEach(r => roomMap.set(r.room_key, r));
        
        const allRooms = Array.from(roomMap.values());

        // D. Sort by created_at descending
        allRooms.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        setRooms(allRooms);
        
        // E. Check for unread messages
        checkUnreadMessages(allRooms);

      } catch (error) {
        console.error('Error fetching rooms:', error);
      } finally {
        setLoadingRooms(false);
      }
    };

    initData();
  }, [user.uid, user.email]);

  // Realtime subscription for new messages to update badges live
  useEffect(() => {
    const channel = supabase.channel('dashboard-notifications')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            (payload) => {
                const newMsg = payload.new;
                // If I am the sender, don't mark as unread
                if (newMsg.uid === user.uid) return;

                // Check if we have this room in our list
                const hasRoom = rooms.some(r => r.room_key === newMsg.room_key);
                if (hasRoom) {
                    setUnreadRooms(prev => new Set(prev).add(newMsg.room_key));
                }
            }
        )
        .subscribe();

    return () => {
        supabase.removeChannel(channel);
    };
  }, [rooms, user.uid]);

  const checkUnreadMessages = async (currentRooms: Room[]) => {
      if (currentRooms.length === 0) return;

      const newUnreadSet = new Set<string>();
      
      // We process checks in parallel
      await Promise.all(currentRooms.map(async (room) => {
          try {
              // 1. Get the last time the user opened this room from LocalStorage
              const lastReadTimestamp = localStorage.getItem(`lastRead_${room.room_key}`);
              const lastReadTime = lastReadTimestamp ? parseInt(lastReadTimestamp) : 0;

              // 2. Fetch the MOST RECENT message for this room from Supabase
              const { data: latestMsg, error } = await supabase
                  .from('messages')
                  .select('created_at')
                  .eq('room_key', room.room_key)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
              
              if (!error && latestMsg) {
                  const msgTime = new Date(latestMsg.created_at).getTime();
                  // 3. Compare: If message is newer than last read time, mark unread
                  if (msgTime > lastReadTime) {
                      newUnreadSet.add(room.room_key);
                  }
              }
          } catch (err) {
              console.error(`Error checking unread for ${room.room_name}`, err);
          }
      }));

      setUnreadRooms(newUnreadSet);
  };


  // --- Profile Management Functions ---

  const handleSaveProfile = async () => {
      if (!displayName.trim()) {
          alert("Display name cannot be empty");
          return;
      }
      setIsSavingProfile(true);

      try {
          const updates = {
              display_name: displayName,
              full_name: displayName, 
              custom_avatar: tempAvatarUrl,
              avatar_url: tempAvatarUrl
          };

          const { error } = await supabase.auth.updateUser({
              data: updates
          });

          if (error) throw error;

          setAvatarUrl(tempAvatarUrl);
          localStorage.setItem('chatUsername', displayName);
          localStorage.setItem('chatAvatarURL', tempAvatarUrl);
          
          setIsEditingProfile(false);
      } catch (e: any) {
          console.error("Profile update failed", e);
          alert("Failed to update profile: " + e.message);
      } finally {
          setIsSavingProfile(false);
      }
  };

  const handleGenerateRandomAvatar = () => {
      const seed = Math.random().toString(36).substring(7);
      const randomUrl = `https://api.dicebear.com/9.x/bottts/svg?seed=${seed}`;
      setTempAvatarUrl(randomUrl);
  };

  const handleLinkAvatar = () => {
      if (linkInput.trim().startsWith('http')) {
          setTempAvatarUrl(linkInput.trim());
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

          const { error: uploadError } = await supabase.storage
              .from('attachments') 
              .upload(filePath, compressed);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
              .from('attachments')
              .getPublicUrl(filePath);

          setTempAvatarUrl(publicUrl);
      } catch (err: any) {
          console.error("Avatar upload failed", err);
          alert("Failed to upload image.");
      }
  };

  // --- Room Management Functions ---

  const handleJoin = (room: Room) => {
    // Mark room as read by updating the timestamp in localStorage
    localStorage.setItem(`lastRead_${room.room_key}`, Date.now().toString());
    
    // Update local state to remove the red dot immediately
    const newUnread = new Set(unreadRooms);
    newUnread.delete(room.room_key);
    setUnreadRooms(newUnread);

    const config: ChatConfig = {
        username: displayName,
        avatarURL: avatarUrl,
        roomName: room.room_name,
        pin: room.pin,
        roomKey: room.room_key
    };
    onJoinRoom(config);
  };

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    const room = rooms.find(r => r.id === roomId || r.room_name === roomName);
    if (!room) return;

    // Check if the current user is the creator
    const isOwner = room.created_by === user.uid;
    const message = isOwner 
        ? `Are you sure you want to delete "${roomName}"? This will remove it for everyone and cannot be undone.`
        : `Are you sure you want to remove "${roomName}" from your history?`;

    if (!window.confirm(message)) return;

    try {
        if (!isOwner) {
             // If not creator, just remove subscription (leave room)
             await supabase.from('subscribers')
                .delete()
                .eq('room_key', room.room_key)
                .eq('uid', user.uid);
             
             // Remove from local list
             setRooms(rooms.filter(r => r.room_key !== room.room_key));
             return;
        }

        // If creator, perform full delete
        const roomKey = room.room_key;

        // Cleanup associated data
        await supabase.from('messages').delete().eq('room_key', roomKey);
        await supabase.from('subscribers').delete().eq('room_key', roomKey);

        const { data: files } = await supabase.storage.from('attachments').list(roomKey);
        if (files && files.length > 0) {
            const filesToRemove = files.map(x => `${roomKey}/${x.name}`);
            await supabase.storage.from('attachments').remove(filesToRemove);
        }

        const { error } = await supabase.from('rooms').delete().eq('room_key', roomKey);
        
        if (error) throw error;
        setRooms(rooms.filter(r => r.room_key !== roomKey));
    } catch (e: any) {
        console.error("Delete/Leave room failed:", e);
        alert('Operation failed: ' + (e.message || "Unknown error"));
    }
  };

  const handleCreateOrJoinRoom = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newRoomName || !newRoomPin) return;

      setCreating(true);
      const roomKey = generateRoomKey(newRoomPin, newRoomName);
      
      try {
           // 1. Check if room exists
           const { data: existingRoom, error: fetchError } = await supabase
            .from('rooms')
            .select('*')
            .eq('room_key', roomKey)
            .maybeSingle();

           if (fetchError) throw fetchError;
            
           if (existingRoom) {
               // --- JOIN EXISTING ROOM ---
               // Auto-subscribe user to this room if not already
               const { error: subError } = await supabase.from('subscribers').upsert({
                   room_key: roomKey,
                   uid: user.uid,
                   username: displayName,
                   email: user.email || ''
               }, { onConflict: 'room_key, uid' });

               if (subError) console.error("Subscription warning:", subError);

               // Mark as read immediately on join
               localStorage.setItem(`lastRead_${existingRoom.room_key}`, Date.now().toString());

               const config: ChatConfig = {
                   username: displayName,
                   avatarURL: avatarUrl,
                   roomName: existingRoom.room_name,
                   pin: existingRoom.pin,
                   roomKey: existingRoom.room_key
               };
               onJoinRoom(config);
           } else {
               // --- CREATE NEW ROOM ---
               const { data, error } = await supabase.from('rooms').insert({
                   room_key: roomKey,
                   room_name: newRoomName,
                   pin: newRoomPin,
                   created_by: user.uid
               }).select().single();

               if (error) throw error;
               
               if (data) {
                   // Mark as read immediately on creation
                   localStorage.setItem(`lastRead_${data.room_key}`, Date.now().toString());

                   // Add new room to list if it's not there
                   if (!rooms.find(r => r.room_key === data.room_key)) {
                        setRooms([data, ...rooms]);
                   }
                   setNewRoomName('');
                   setNewRoomPin('');
                   setShowCreate(false);
               }
           }
      } catch (e: any) {
          console.error("Operation failed", e);
          alert("Failed to create or join room: " + e.message);
      } finally {
          setCreating(false);
      }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white transition-colors duration-300">
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            
            {/* Header / Top Bar */}
            <header className="flex justify-between items-center mb-8 pb-6 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    <img 
                        src="https://konskall.github.io/incognitochat/favicon-96x96.png" 
                        alt="Incognito Chat" 
                        className="w-10 h-10 rounded-xl shadow-lg shadow-blue-500/20"
                    />
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Welcome back to your secure space</p>
                    </div>
                </div>
                <button 
                    onClick={onLogout} 
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
                >
                    <LogOut size={16} />
                    <span className="hidden sm:inline">Logout</span>
                </button>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* Left Column: Compact Profile Card */}
                <div className="lg:col-span-4 xl:col-span-3 space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 transition-all duration-300">
                        
                        {isEditingProfile ? (
                            // --- EDIT MODE ---
                            <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
                                    {/* Avatar Edit */}
                                    <div className="relative group flex-shrink-0">
                                        <img 
                                            src={tempAvatarUrl} 
                                            alt="Preview" 
                                            className="w-20 h-20 rounded-full object-cover border-4 border-slate-100 dark:border-slate-800 bg-slate-100"
                                        />
                                        <label className="absolute -bottom-1 -right-1 p-2 bg-blue-600 text-white rounded-full cursor-pointer hover:bg-blue-700 transition shadow-lg ring-2 ring-white dark:ring-slate-900">
                                            <Camera size={14} />
                                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
                                        </label>
                                    </div>
                                    
                                    {/* Fields */}
                                    <div className="flex-1 w-full space-y-3">
                                        <div>
                                            <label className="text-[10px] uppercase font-bold text-slate-400 ml-1 mb-1 block">Display Name</label>
                                            <input 
                                                type="text" 
                                                value={displayName} 
                                                onChange={(e) => setDisplayName(e.target.value)}
                                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                                placeholder="Display Name"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-400 ml-1 mb-1 block">Avatar Options</label>
                                    <div className="flex gap-2">
                                            <button 
                                            onClick={handleGenerateRandomAvatar}
                                            className="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition flex items-center gap-2"
                                            title="Generate Random Avatar"
                                            >
                                            <RefreshCw size={14} /> Random
                                            </button>
                                            <div className="flex-1 flex relative">
                                            <input 
                                                type="text" 
                                                value={linkInput}
                                                onChange={(e) => setLinkInput(e.target.value)}
                                                placeholder="Paste image URL..."
                                                className="w-full pl-3 pr-9 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                            <button 
                                                onClick={handleLinkAvatar} 
                                                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-200 transition"
                                            >
                                                <ArrowRight size={12} />
                                            </button>
                                            </div>
                                    </div>
                                </div>
                                
                                <div className="flex gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 mt-2">
                                    <button 
                                        onClick={() => setIsEditingProfile(false)}
                                        className="flex-1 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={handleSaveProfile}
                                        disabled={isSavingProfile}
                                        className="flex-1 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg shadow-md hover:bg-blue-700 transition flex items-center justify-center gap-2"
                                    >
                                        {isSavingProfile ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                                        Save
                                    </button>
                                </div>
                            </div>
                        ) : (
                            // --- VIEW MODE (Compact Horizontal) ---
                            <div className="flex items-center gap-5 animate-in fade-in zoom-in-95 duration-300">
                                <div className="relative flex-shrink-0 group">
                                    <img 
                                        src={avatarUrl} 
                                        alt="Profile" 
                                        className="w-20 h-20 rounded-full object-cover border-4 border-slate-100 dark:border-slate-800 shadow-sm bg-slate-100"
                                    />
                                    <button 
                                        onClick={() => {
                                            setTempAvatarUrl(avatarUrl);
                                            setIsEditingProfile(true);
                                        }}
                                        className="absolute bottom-0 right-0 p-2 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-full shadow-lg border border-slate-200 dark:border-slate-600 hover:text-blue-600 hover:scale-110 transition-all"
                                        title="Edit Profile"
                                    >
                                        <Edit2 size={14} />
                                    </button>
                                </div>
                                
                                <div className="flex-1 min-w-0 overflow-hidden">
                                    <h3 className="text-2xl font-bold text-slate-800 dark:text-white truncate" title={displayName}>
                                        {displayName}
                                    </h3>
                                    <div className="flex items-center gap-2 mt-1 text-slate-500 dark:text-slate-400">
                                        <Mail size={14} className="flex-shrink-0" />
                                        <span className="text-sm truncate" title={user.email}>{user.email}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Room Management */}
                <div className="lg:col-span-8 xl:col-span-9 space-y-6">
                    
                    {/* Create Room Card */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                         <div className="p-6">
                            {!showCreate ? (
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Join or Create Room</h3>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">Enter a room name and PIN to connect</p>
                                    </div>
                                    <button 
                                        onClick={() => setShowCreate(true)}
                                        className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"
                                    >
                                        <LogIn size={20} />
                                        Enter / Create Room
                                    </button>
                                </div>
                            ) : (
                                <form onSubmit={handleCreateOrJoinRoom} className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
                                        <h3 className="font-semibold text-lg">Room Access</h3>
                                        <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                                            <X size={20} />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Room Name</label>
                                            <input 
                                                type="text" 
                                                value={newRoomName}
                                                onChange={e => setNewRoomName(e.target.value)}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none transition"
                                                placeholder="e.g. Project Alpha"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Access PIN</label>
                                            <input 
                                                type="text" 
                                                value={newRoomPin}
                                                onChange={e => setNewRoomPin(e.target.value)}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none transition"
                                                placeholder="Secret Key"
                                                required
                                            />
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center pt-2">
                                        <p className="text-xs text-slate-500 italic">If the room exists, you will join it. Otherwise, a new room will be created.</p>
                                        <button 
                                            type="submit" 
                                            disabled={creating}
                                            className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {creating ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
                                            Enter Room
                                        </button>
                                    </div>
                                </form>
                            )}
                         </div>
                    </div>

                    {/* Rooms List */}
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 px-1">Your Rooms</h3>
                        
                        {loadingRooms ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="animate-spin text-slate-400" size={32} />
                            </div>
                        ) : rooms.length === 0 ? (
                            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800">
                                <p className="text-slate-500 dark:text-slate-400">You haven't created or joined any rooms yet.</p>
                                <button onClick={() => setShowCreate(true)} className="text-blue-500 font-semibold mt-2 hover:underline">Create or Join one now</button>
                            </div>
                        ) : (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
                                {rooms.map(room => (
                                    <div key={room.id} className="group bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-800 transition-all duration-300 flex flex-col justify-between relative overflow-hidden">
                                        <div className="mb-4 relative z-10">
                                            <div className="flex justify-between items-start mb-2">
                                                <h4 className="font-bold text-lg text-slate-800 dark:text-slate-100 truncate pr-2 flex items-center gap-2">
                                                    {room.room_name}
                                                    {unreadRooms.has(room.room_key) && (
                                                        <span className="flex h-2.5 w-2.5 relative">
                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                                                        </span>
                                                    )}
                                                </h4>
                                                <button 
                                                    onClick={() => handleDeleteRoom(room.id, room.room_name)}
                                                    className="text-slate-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition opacity-0 group-hover:opacity-100"
                                                    title={room.created_by === user.uid ? "Delete Room" : "Remove from History"}
                                                >
                                                    {room.created_by === user.uid ? <Trash2 size={16} /> : <X size={16} />}
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                                <span className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md font-mono border border-slate-200 dark:border-slate-700">PIN: {room.pin}</span>
                                                {room.created_by === user.uid && (
                                                    <>
                                                        <span>•</span>
                                                        <span className="text-blue-500 font-medium">Owner</span>
                                                    </>
                                                )}
                                                <span>•</span>
                                                <span>{new Date(room.created_at).toLocaleDateString()}</span>
                                            </div>
                                            
                                            {/* Unread Message Indicator Text */}
                                            {unreadRooms.has(room.room_key) && (
                                                <div className="mt-3 flex items-center gap-1.5 text-xs font-bold text-red-500 dark:text-red-400 animate-pulse">
                                                    <BellRing size={14} />
                                                    <span>New messages</span>
                                                </div>
                                            )}
                                        </div>
                                        
                                        <button 
                                            onClick={() => handleJoin(room)}
                                            className={`w-full py-2.5 font-semibold rounded-xl transition flex items-center justify-center gap-2 z-10 
                                                ${unreadRooms.has(room.room_key) 
                                                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 group-hover:bg-red-500 group-hover:text-white group-hover:border-red-500' 
                                                    : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-600 dark:group-hover:text-white'
                                                }`}
                                        >
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
  );
};

export default DashboardScreen;
