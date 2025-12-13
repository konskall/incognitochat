
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { User, ChatConfig, Room } from '../types';
import { generateRoomKey, compressImage } from '../utils/helpers';
import { 
  LogOut, Plus, Trash2, ArrowRight, Loader2, 
  Camera, 
  RefreshCw, Save, X, Edit2, Mail, Shield, LogIn
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

  // Profile State
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  // Avatar Editing State
  const [avatarMode, setAvatarMode] = useState<'upload' | 'random' | 'link'>('random');
  const [tempAvatarUrl, setTempAvatarUrl] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load User Data & Rooms
  useEffect(() => {
    const initData = async () => {
      // 1. Fetch latest user metadata from Supabase
      // We force a refresh to ensure we have the latest metadata
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (authUser) {
          const meta = authUser.user_metadata || {};
          
          // Priority Logic: 
          // 1. 'display_name' (Custom saved by user)
          // 2. 'full_name' (Provided by Google/OAuth)
          // 3. LocalStorage backup
          // 4. Email prefix default
          const finalName = meta.display_name || meta.full_name || meta.name || localStorage.getItem('chatUsername') || user.email?.split('@')[0] || 'User';
          
          // Priority Logic:
          // 1. 'custom_avatar' (Custom saved by user)
          // 2. 'avatar_url' (Provided by Google/OAuth)
          // 3. LocalStorage backup
          // 4. Generated default
          const finalAvatar = meta.custom_avatar || meta.avatar_url || meta.picture || localStorage.getItem('chatAvatarURL') || `https://ui-avatars.com/api/?name=${finalName}&background=random`;
          
          setDisplayName(finalName);
          setAvatarUrl(finalAvatar);
          setTempAvatarUrl(finalAvatar);

          // Update LocalStorage to keep sync
          localStorage.setItem('chatUsername', finalName);
          localStorage.setItem('chatAvatarURL', finalAvatar);
      }

      // 2. Fetch Rooms
      try {
        const { data, error } = await supabase
          .from('rooms')
          .select('*')
          .eq('created_by', user.uid)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setRooms(data || []);
      } catch (error) {
        console.error('Error fetching rooms:', error);
      } finally {
        setLoadingRooms(false);
      }
    };

    initData();
  }, [user.uid, user.email]);


  // --- Profile Management Functions ---

  const handleSaveProfile = async () => {
      if (!displayName.trim()) {
          alert("Display name cannot be empty");
          return;
      }
      setIsSavingProfile(true);

      try {
          // Update Supabase Auth Metadata
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

          // Update Local State immediately
          setAvatarUrl(tempAvatarUrl);
          
          // Update LocalStorage as fallback/cache
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
              .from('attachments') // Reusing attachments bucket
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
    // Use the customized profile data
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
    if (!window.confirm(`Are you sure you want to delete "${roomName}"? This cannot be undone.`)) return;

    try {
        const room = rooms.find(r => r.id === roomId || r.room_name === roomName);
        if (!room) return;

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
        console.error("Delete room failed:", e);
        alert('Failed to delete room: ' + (e.message || "Unknown error"));
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
               // Don't alert, just join
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
                   setRooms([data, ...rooms]);
                   setNewRoomName('');
                   setNewRoomPin('');
                   setShowCreate(false);
                   // We don't auto-join on create based on UX preference, 
                   // but user sees it in list immediately.
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
                    <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-600/20">
                        <Shield className="text-white w-6 h-6" />
                    </div>
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
                
                {/* Left Column: Profile Card */}
                <div className="lg:col-span-4 xl:col-span-3 space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-white/50 dark:border-slate-800 overflow-hidden relative group">
                        
                        {/* Decorative Background */}
                        <div className="h-32 bg-gradient-to-r from-blue-600 to-indigo-600"></div>
                        
                        <div className="px-6 pb-6 relative">
                            {/* Avatar Container */}
                            <div className="relative -mt-16 mb-4 flex justify-center">
                                <div className="relative p-1 bg-white dark:bg-slate-900 rounded-full">
                                    <img 
                                        src={isEditingProfile ? tempAvatarUrl : avatarUrl} 
                                        alt="Profile" 
                                        className="w-32 h-32 rounded-full object-cover border-4 border-slate-50 dark:border-slate-800 shadow-md bg-slate-100"
                                    />
                                    {!isEditingProfile && (
                                        <button 
                                            onClick={() => {
                                                setTempAvatarUrl(avatarUrl);
                                                setIsEditingProfile(true);
                                            }}
                                            className="absolute bottom-1 right-1 p-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-full shadow-lg border border-slate-100 dark:border-slate-700 hover:text-blue-600 transition-colors"
                                            title="Edit Profile"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Info / Edit Form */}
                            <div className="text-center space-y-4">
                                {isEditingProfile ? (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        {/* Avatar Controls */}
                                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-1 flex justify-center gap-1">
                                            <button 
                                                onClick={() => setAvatarMode('random')}
                                                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${avatarMode === 'random' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600' : 'text-slate-500 hover:bg-white/50'}`}
                                            >
                                                Random
                                            </button>
                                            <button 
                                                onClick={() => setAvatarMode('upload')}
                                                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${avatarMode === 'upload' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600' : 'text-slate-500 hover:bg-white/50'}`}
                                            >
                                                Upload
                                            </button>
                                            <button 
                                                onClick={() => setAvatarMode('link')}
                                                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${avatarMode === 'link' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600' : 'text-slate-500 hover:bg-white/50'}`}
                                            >
                                                Link
                                            </button>
                                        </div>

                                        {/* Avatar Actions */}
                                        <div className="h-10 flex items-center justify-center">
                                            {avatarMode === 'random' && (
                                                <button onClick={handleGenerateRandomAvatar} className="flex items-center gap-2 text-xs font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-full hover:bg-blue-100 transition">
                                                    <RefreshCw size={14} /> Regenerate
                                                </button>
                                            )}
                                            {avatarMode === 'upload' && (
                                                <label className="flex items-center gap-2 text-xs font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-full hover:bg-blue-100 transition cursor-pointer">
                                                    <Camera size={14} /> Choose File
                                                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
                                                </label>
                                            )}
                                            {avatarMode === 'link' && (
                                                <div className="flex w-full gap-1">
                                                    <input 
                                                        type="text" 
                                                        value={linkInput}
                                                        onChange={(e) => setLinkInput(e.target.value)}
                                                        placeholder="https://..."
                                                        className="flex-1 text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent"
                                                    />
                                                    <button onClick={handleLinkAvatar} className="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded hover:bg-blue-200">
                                                        <ArrowRight size={14} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <input 
                                            type="text" 
                                            value={displayName} 
                                            onChange={(e) => setDisplayName(e.target.value)}
                                            className="w-full text-center px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none"
                                            placeholder="Display Name"
                                        />

                                        <div className="flex gap-2 justify-center">
                                            <button 
                                                onClick={() => setIsEditingProfile(false)}
                                                className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                                            >
                                                Cancel
                                            </button>
                                            <button 
                                                onClick={handleSaveProfile}
                                                disabled={isSavingProfile}
                                                className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg shadow-lg hover:bg-blue-700 transition flex items-center gap-2"
                                            >
                                                {isSavingProfile ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                                                Save Changes
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="animate-in fade-in zoom-in-95 duration-300">
                                        <h3 className="text-xl font-bold text-slate-800 dark:text-white">{displayName}</h3>
                                        <div className="flex items-center justify-center gap-2 mt-1 text-slate-500 dark:text-slate-400">
                                            <Mail size={14} />
                                            <span className="text-sm">{user.email}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
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
                                <p className="text-slate-500 dark:text-slate-400">You haven't created any rooms yet.</p>
                                <button onClick={() => setShowCreate(true)} className="text-blue-500 font-semibold mt-2 hover:underline">Create or Join one now</button>
                            </div>
                        ) : (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
                                {rooms.map(room => (
                                    <div key={room.id} className="group bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-800 transition-all duration-300 flex flex-col justify-between">
                                        <div className="mb-4">
                                            <div className="flex justify-between items-start mb-2">
                                                <h4 className="font-bold text-lg text-slate-800 dark:text-slate-100 truncate pr-2">{room.room_name}</h4>
                                                <button 
                                                    onClick={() => handleDeleteRoom(room.id, room.room_name)}
                                                    className="text-slate-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition opacity-0 group-hover:opacity-100"
                                                    title="Delete Room"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                                <span className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md font-mono border border-slate-200 dark:border-slate-700">PIN: {room.pin}</span>
                                                <span>•</span>
                                                <span>{new Date(room.created_at).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                        
                                        <button 
                                            onClick={() => handleJoin(room)}
                                            className="w-full py-2.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-semibold rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/30 transition flex items-center justify-center gap-2 group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-600 dark:group-hover:text-white"
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
