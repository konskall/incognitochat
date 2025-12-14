
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabase';
import { User, ChatConfig, Room } from '../types';
import { generateRoomKey, compressImage } from '../utils/helpers';
import { 
  LogOut, Trash2, ArrowRight, Loader2, 
  Upload, RotateCcw,
  RefreshCw, Save, X, Edit2, Mail, LogIn, BellRing, Link as LinkIcon, AlertCircle, ImageIcon,
  Palette, Box, Grip, Zap, Circle
} from 'lucide-react';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

// -- Professional SVG Pattern Generator (Bolder & Fixed Color) --
const getPattern = (type: string, colorHex: string) => {
    // Manually replace # with %23 for SVG data URI compatibility
    const color = colorHex.replace('#', '%23');
    // Increased opacity for better visibility
    const opacity = "0.3"; 
    const strokeWidth = "2";

    switch (type) {
        case 'cubes': // 3D Isometric Cubes
            return `url("data:image/svg+xml,%3Csvg width='30' height='30' viewBox='0 0 30 30' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='${color}' stroke-opacity='${opacity}' stroke-width='${strokeWidth}'%3E%3Cpath d='M15 0 L30 8 L30 23 L15 30 L0 23 L0 8 Z' /%3E%3Cpath d='M15 0 L15 15 L30 23' /%3E%3Cpath d='M0 8 L15 15' /%3E%3C/g%3E%3C/svg%3E")`;
        case 'rhombus': // Geometric Diamond Grid
            return `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='${color}' stroke-opacity='${opacity}' stroke-width='${strokeWidth}'%3E%3Cpath d='M0 10 L10 0 L20 10 L10 20 Z' /%3E%3C/g%3E%3C/svg%3E")`;
        case 'zigzag': // Sharp ZigZag Lines
            return `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='${color}' stroke-opacity='${opacity}' stroke-width='${strokeWidth}'%3E%3Cpath d='M0 20 L10 10 L20 20 L30 10 L40 20' /%3E%3Cpath d='M0 40 L10 30 L20 40 L30 30 L40 40' /%3E%3Cpath d='M0 0 L10 -10 L20 0 L30 -10 L40 0' /%3E%3C/g%3E%3C/svg%3E")`;
        case 'circles': // Overlapping Circles
            return `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='${color}' stroke-opacity='${opacity}' stroke-width='${strokeWidth}'%3E%3Ccircle cx='20' cy='20' r='10' /%3E%3Ccircle cx='0' cy='0' r='10' /%3E%3Ccircle cx='40' cy='0' r='10' /%3E%3Ccircle cx='0' cy='40' r='10' /%3E%3Ccircle cx='40' cy='40' r='10' /%3E%3C/g%3E%3C/svg%3E")`;
        default:
            return '';
    }
};

const PATTERN_OPTIONS = [
    { id: 'cubes', label: 'Cubes', icon: Box },
    { id: 'rhombus', label: 'Rhombus', icon: Grip },
    { id: 'zigzag', label: 'ZigZag', icon: Zap },
    { id: 'circles', label: 'Circles', icon: Circle },
];

// -- Custom Room Delete Toast (Glassmorphism) --
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
                        <span>{isOwner ? 'Διαγραφή Δωματίου;' : 'Αφαίρεση από Ιστορικό;'}</span>
                    </span>
                    <span className="text-[11px] text-white/60 mt-0.5">
                        {isOwner 
                            ? `Το "${roomName}" θα διαγραφεί μόνιμα.` 
                            : `Αφαίρεση του "${roomName}" από τη λίστα.`}
                    </span>
                </div>
                <div className="hidden sm:block h-8 w-px bg-white/10"></div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <button 
                        onClick={onCancel}
                        disabled={isDeleting}
                        className="flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors text-center border border-white/5"
                    >
                        Ακύρωση
                    </button>
                    <button 
                        onClick={onConfirm}
                        disabled={isDeleting}
                        className="flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-lg shadow-red-500/20 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                        {isDeleting ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14} />}
                        <span>{isOwner ? 'Διαγραφή' : 'Αφαίρεση'}</span>
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

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
  const [googleAvatarUrl, setGoogleAvatarUrl] = useState('');
  
  // Theme State
  const [selectedTargetRoom, setSelectedTargetRoom] = useState<string>('global'); // 'global' or roomKey
  const [themeColor, setThemeColor] = useState('#3b82f6'); // Default Blue
  const [themePattern, setThemePattern] = useState<string>('none');
  const [customBgImage, setCustomBgImage] = useState<string>('');
  
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  // Avatar Editing State
  const [tempAvatarUrl, setTempAvatarUrl] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Background Upload State
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  // Delete Room State
  const [roomToDelete, setRoomToDelete] = useState<{name: string, key: string, isOwner: boolean} | null>(null);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);

  // Load User Data & Rooms
  useEffect(() => {
    const initData = async () => {
      // 1. Fetch latest user metadata from Supabase
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

      // 2. Fetch Rooms (Created AND Joined)
      try {
        const { data: createdRooms, error: createdError } = await supabase
          .from('rooms')
          .select('*')
          .eq('created_by', user.uid);

        if (createdError) throw createdError;

        const { data: subscriptions, error: subError } = await supabase
          .from('subscribers')
          .select('room_key')
          .eq('uid', user.uid);
        
        if (subError) throw subError;

        let joinedRooms: Room[] = [];
        if (subscriptions && subscriptions.length > 0) {
            const keys = subscriptions.map(s => s.room_key);
            const { data: foundJoinedRooms, error: joinedRoomsError } = await supabase
                .from('rooms')
                .select('*')
                .in('room_key', keys);
            
            if (joinedRoomsError) throw joinedRoomsError;
            joinedRooms = foundJoinedRooms || [];
        }

        const roomMap = new Map<string, Room>();
        (createdRooms || []).forEach(r => roomMap.set(r.room_key, r));
        (joinedRooms || []).forEach(r => roomMap.set(r.room_key, r));
        
        const allRooms = Array.from(roomMap.values());
        allRooms.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

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

  // Realtime subscription
  useEffect(() => {
    const channel = supabase.channel('dashboard-notifications')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            (payload) => {
                const newMsg = payload.new;
                if (newMsg.uid === user.uid || newMsg.type === 'system') return;
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
      await Promise.all(currentRooms.map(async (room) => {
          try {
              const lastReadTimestamp = localStorage.getItem(`lastRead_${room.room_key}`);
              const lastReadTime = lastReadTimestamp ? parseInt(lastReadTimestamp) : Date.now();
              const { data: latestMsg, error } = await supabase
                  .from('messages')
                  .select('created_at')
                  .eq('room_key', room.room_key)
                  .neq('type', 'system') 
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
              if (!error && latestMsg) {
                  const msgTime = new Date(latestMsg.created_at).getTime();
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
          // Construct the CSS string for background
          let finalBackgroundStr = '';
          if (themePattern === 'image' && customBgImage) {
               finalBackgroundStr = customBgImage; // Should be URL
          } else if (themePattern !== 'none') {
               // Combine pattern and color
               finalBackgroundStr = getPattern(themePattern, themeColor); 
          }
          
          // Get current metadata first to avoid overwriting
          const { data: { user: currUser } } = await supabase.auth.getUser();
          const currentMeta = currUser?.user_metadata || {};
          
          const updates: any = {
              display_name: displayName,
              full_name: displayName, 
              custom_avatar: tempAvatarUrl,
              avatar_url: tempAvatarUrl,
          };

          // Handle Theme Saving based on scope
          if (selectedTargetRoom === 'global') {
               updates.global_theme = finalBackgroundStr;
          } else {
               // Update specific room entry in the map
               const roomThemes = currentMeta.room_themes || {};
               roomThemes[selectedTargetRoom] = finalBackgroundStr;
               updates.room_themes = roomThemes;
          }

          const { error } = await supabase.auth.updateUser({
              data: updates
          });

          if (error) throw error;

          setAvatarUrl(tempAvatarUrl);
          localStorage.setItem('chatUsername', displayName);
          localStorage.setItem('chatAvatarURL', tempAvatarUrl);
          
          setIsEditingProfile(false);
          setShowLinkInput(false);
          
          // Reset theme states to default to encourage new selection or just reset
          setThemePattern('none');
          setCustomBgImage('');
          setSelectedTargetRoom('global');

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

  const handleRestoreGoogleAvatar = () => {
      if (googleAvatarUrl) {
          setTempAvatarUrl(googleAvatarUrl);
      }
  };

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
          console.error("Avatar upload failed", err);
          alert("Failed to upload image.");
      }
  };

  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || !e.target.files[0]) return;
      const file = e.target.files[0];
      try {
          const compressed = await compressImage(file);
          const fileExt = compressed.name.split('.').pop();
          const fileName = `bg_${Date.now()}.${fileExt}`;
          const filePath = `profiles/${user.uid}/backgrounds/${fileName}`;
          const { error: uploadError } = await supabase.storage.from('attachments').upload(filePath, compressed);
          if (uploadError) throw uploadError;
          const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(filePath);
          
          setThemePattern('image');
          setCustomBgImage(publicUrl);
      } catch (err: any) {
          console.error("Background upload failed", err);
          alert("Failed to upload background.");
      }
  };

  // --- Room Management Functions ---

  const handleJoin = async (room: Room) => {
    localStorage.setItem(`lastRead_${room.room_key}`, Date.now().toString());
    
    // Fetch latest metadata to get up-to-date preference
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const meta = currentUser?.user_metadata || {};
    
    // Resolve background: Room Specific > Global > None
    let bg = '';
    if (meta.room_themes && meta.room_themes[room.room_key]) {
        bg = meta.room_themes[room.room_key];
    } else if (meta.global_theme) {
        bg = meta.global_theme;
    }

    const newUnread = new Set(unreadRooms);
    newUnread.delete(room.room_key);
    setUnreadRooms(newUnread);

    const config: ChatConfig = {
        username: displayName,
        avatarURL: avatarUrl,
        roomName: room.room_name,
        pin: room.pin,
        roomKey: room.room_key,
        backgroundImage: bg
    };
    onJoinRoom(config);
  };

  const onRequestDeleteRoom = (roomName: string, roomKey: string, createdBy: string) => {
      setRoomToDelete({
          name: roomName,
          key: roomKey,
          isOwner: createdBy === user.uid
      });
  };

  const handleConfirmDeleteRoom = async () => {
    if (!roomToDelete) return;

    setIsDeletingRoom(true);
    const { key, isOwner } = roomToDelete;

    try {
        if (!isOwner) {
             await supabase.from('subscribers')
                .delete()
                .eq('room_key', key)
                .eq('uid', user.uid);
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
        console.error("Delete/Leave room failed:", e);
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
           const { data: existingRoom, error: fetchError } = await supabase
            .from('rooms')
            .select('*')
            .eq('room_key', roomKey)
            .maybeSingle();

           if (fetchError) throw fetchError;
            
           if (existingRoom) {
               const { error: subError } = await supabase.from('subscribers').upsert({
                   room_key: roomKey,
                   uid: user.uid,
                   username: displayName,
                   email: '' 
               }, { onConflict: 'room_key, uid' });

               if (subError) console.error("Subscription warning:", subError);
               localStorage.setItem(`lastRead_${existingRoom.room_key}`, Date.now().toString());

               // Fetch metadata to apply background
               const { data: { user: curr } } = await supabase.auth.getUser();
               const meta = curr?.user_metadata || {};
               let bg = meta.room_themes?.[existingRoom.room_key] || meta.global_theme || '';

               onJoinRoom({
                   username: displayName,
                   avatarURL: avatarUrl,
                   roomName: existingRoom.room_name,
                   pin: existingRoom.pin,
                   roomKey: existingRoom.room_key,
                   backgroundImage: bg
               });
           } else {
               const { data, error } = await supabase.from('rooms').insert({
                   room_key: roomKey,
                   room_name: newRoomName,
                   pin: newRoomPin,
                   created_by: user.uid
               }).select().single();

               if (error) throw error;
               
               if (data) {
                   localStorage.setItem(`lastRead_${data.room_key}`, Date.now().toString());
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
            
            {/* Header */}
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
                
                {/* Left Column: Profile & Settings */}
                <div className="lg:col-span-4 xl:col-span-4 space-y-6">
                    <div className="bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-950 rounded-2xl shadow-lg shadow-slate-200/50 dark:shadow-none border border-slate-200/60 dark:border-slate-800 p-5 transition-all duration-300 relative overflow-hidden group">
                        
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none group-hover:bg-blue-500/20 transition-all duration-500"></div>

                        {isEditingProfile ? (
                            // --- EDIT MODE ---
                            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300 relative z-10">
                                
                                {/* 1. Basic Info */}
                                <div className="space-y-4">
                                    <div className="flex flex-col items-center gap-4">
                                        <div className="relative group/edit-avatar">
                                            <img 
                                                src={tempAvatarUrl} 
                                                alt="Preview" 
                                                className="w-20 h-20 rounded-full object-cover border-4 border-white dark:border-slate-800 shadow-md ring-1 ring-slate-100 dark:ring-slate-700"
                                            />
                                            <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover/edit-avatar:opacity-100 transition-opacity">
                                                <span className="text-white text-xs font-bold">Preview</span>
                                            </div>
                                        </div>
                                        
                                        <input 
                                            type="text" 
                                            value={displayName} 
                                            onChange={(e) => setDisplayName(e.target.value)}
                                            className="w-full text-center px-3 py-2 border-b-2 border-slate-200 dark:border-slate-700 bg-transparent focus:border-blue-500 outline-none transition-all font-bold text-lg text-slate-800 dark:text-white placeholder:font-normal"
                                            placeholder="Display Name"
                                        />
                                    </div>
                                    <div className="grid grid-cols-4 gap-2">
                                        <label className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Upload Photo">
                                            <Upload size={16} className="text-blue-600 dark:text-blue-400" />
                                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
                                        </label>
                                        <button onClick={handleGenerateRandomAvatar} className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Random Avatar">
                                            <RefreshCw size={16} className="text-purple-600 dark:text-purple-400" />
                                        </button>
                                        <button onClick={() => setShowLinkInput(!showLinkInput)} className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Link URL">
                                            <LinkIcon size={16} className="text-orange-600 dark:text-orange-400" />
                                        </button>
                                        <button onClick={handleRestoreGoogleAvatar} className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Restore Original">
                                            <RotateCcw size={16} className="text-green-600 dark:text-green-400" />
                                        </button>
                                    </div>
                                     {showLinkInput && (
                                        <div className="flex relative animate-in slide-in-from-top-2 fade-in">
                                            <input 
                                                type="text" 
                                                value={linkInput}
                                                onChange={(e) => setLinkInput(e.target.value)}
                                                placeholder="https://image-url.png"
                                                className="w-full pl-3 pr-9 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                                            />
                                            <button 
                                                onClick={handleLinkAvatar} 
                                                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-200 transition"
                                            >
                                                <ArrowRight size={12} />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* 2. Room Themes Section */}
                                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                                    <div className="flex justify-between items-center mb-4">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                            <Palette size={12} /> Theme Settings
                                        </label>
                                        <div className="relative">
                                            <select 
                                                value={selectedTargetRoom}
                                                onChange={(e) => setSelectedTargetRoom(e.target.value)}
                                                className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 pr-6 rounded-md border-none outline-none appearance-none cursor-pointer hover:bg-blue-100 transition"
                                            >
                                                <option value="global">Global Default</option>
                                                {rooms.map(r => (
                                                    <option key={r.room_key} value={r.room_key}>{r.room_name}</option>
                                                ))}
                                            </select>
                                            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-blue-600 dark:text-blue-400">
                                                <svg width="8" height="6" viewBox="0 0 8 6" fill="currentColor"><path d="M4 6L0 0H8L4 6Z"/></svg>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Preview Box */}
                                    <div 
                                        className="h-24 w-full rounded-xl border border-slate-200 dark:border-slate-700 mb-4 flex items-center justify-center relative overflow-hidden transition-all duration-300 shadow-inner"
                                        style={{ 
                                            background: (themePattern === 'image' && customBgImage) 
                                                ? `url(${customBgImage}) center/cover no-repeat fixed` 
                                                : getPattern(themePattern, themeColor) 
                                        }}
                                    >
                                        <div className="absolute inset-0 bg-slate-50 dark:bg-slate-900 -z-10"></div>
                                        <div className="bg-white/80 dark:bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full text-xs font-bold shadow-lg flex flex-col items-center">
                                           <span>Preview {selectedTargetRoom === 'global' ? '(Global)' : '(Room)'}</span>
                                           <span className="text-[10px] font-normal opacity-70 mt-1">Background will look like this</span>
                                        </div>
                                    </div>

                                    {/* Controls */}
                                    <div className="space-y-4">
                                        
                                        {/* Pattern Grid */}
                                        <div className="grid grid-cols-5 gap-2">
                                            {/* No Pattern */}
                                            <button 
                                                onClick={() => { setThemePattern('none'); setCustomBgImage(''); }}
                                                className={`aspect-square rounded-lg border-2 flex items-center justify-center transition-all ${themePattern === 'none' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}
                                                title="No Pattern"
                                            >
                                                <span className="text-[10px] font-bold text-slate-400">NONE</span>
                                            </button>

                                            {/* Pattern Options */}
                                            {PATTERN_OPTIONS.map(p => (
                                                <button
                                                    key={p.id}
                                                    onClick={() => { setThemePattern(p.id); setCustomBgImage(''); }}
                                                    className={`aspect-square rounded-lg border-2 transition-all overflow-hidden relative group/pattern flex items-center justify-center ${themePattern === p.id ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}
                                                    title={p.label}
                                                >
                                                    <div className="absolute inset-0 opacity-100" style={{background: getPattern(p.id, themeColor)}}></div>
                                                    <div className="absolute inset-0 bg-white/50 dark:bg-black/50 opacity-0 group-hover/pattern:opacity-100 transition-opacity flex items-center justify-center">
                                                        <p.icon size={16} className="text-slate-800 dark:text-white" />
                                                    </div>
                                                </button>
                                            ))}
                                        </div>

                                        {/* Additional Tools Row: Color + Upload */}
                                        <div className="flex gap-2">
                                            <div className="flex-1 flex items-center gap-2 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 relative group/color">
                                                <input 
                                                    type="color" 
                                                    value={themeColor} 
                                                    onChange={(e) => setThemeColor(e.target.value)}
                                                    className="w-8 h-8 rounded cursor-pointer border-none bg-transparent p-0 absolute inset-0 opacity-0 z-10 w-full h-full"
                                                    disabled={themePattern === 'image'}
                                                    title="Pattern Color"
                                                />
                                                <div className="w-6 h-6 rounded-full border border-slate-300 dark:border-slate-600 shadow-sm" style={{ backgroundColor: themeColor }}></div>
                                                <span className="text-[10px] font-bold text-slate-500 uppercase">Pick Color</span>
                                            </div>

                                            <label className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-xl border cursor-pointer transition-all ${themePattern === 'image' ? 'bg-blue-50 border-blue-500 text-blue-600' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-200'}`}>
                                                <ImageIcon size={16} />
                                                <span className="text-[10px] font-bold uppercase">Image</span>
                                                <input type="file" ref={backgroundInputRef} className="hidden" accept="image/*" onChange={handleBackgroundUpload} />
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="flex gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                                    <button 
                                        onClick={() => { setIsEditingProfile(false); setShowLinkInput(false); }}
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
                                        Save Changes
                                    </button>
                                </div>
                            </div>
                        ) : (
                            // --- VIEW MODE ---
                            <div className="flex items-center gap-5 animate-in fade-in zoom-in-95 duration-300 relative z-10">
                                <div className="relative flex-shrink-0 group/avatar">
                                    <img 
                                        src={avatarUrl} 
                                        alt="Profile" 
                                        className="relative w-20 h-20 rounded-full object-cover border-4 border-white dark:border-slate-900 shadow-lg"
                                    />
                                    <button 
                                        onClick={() => {
                                            setTempAvatarUrl(avatarUrl);
                                            setIsEditingProfile(true);
                                        }}
                                        className="absolute bottom-0 right-0 p-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-full shadow-md border border-slate-100 dark:border-slate-700 hover:text-blue-600 hover:scale-110 transition-all z-20"
                                        title="Edit Profile"
                                    >
                                        <Edit2 size={12} />
                                    </button>
                                </div>
                                
                                <div className="flex-1 min-w-0 flex flex-col justify-center h-20">
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white truncate tracking-tight" title={displayName}>
                                        {displayName}
                                    </h3>
                                    <div className="flex items-center gap-2 mt-1 text-slate-500 dark:text-slate-400">
                                        <div className="p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
                                            <Mail size={10} className="flex-shrink-0" />
                                        </div>
                                        <span className="text-xs font-medium truncate opacity-80" title={user.email}>{user.email}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Room Management */}
                <div className="lg:col-span-8 xl:col-span-8 space-y-6">
                    
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
                                                    onClick={() => onRequestDeleteRoom(room.room_name, room.room_key, room.created_by)}
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
    </>
  );
};

export default DashboardScreen;
