import React, { useState, useEffect } from 'react';
import { LogOut, Plus, Trash2, MessageSquare, Loader2, Shield, User as UserIcon, RefreshCw } from 'lucide-react';
import { supabase } from '../services/supabase';
import { Room, User, ChatConfig } from '../types';
import { generateRoomKey } from '../utils/helpers';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadRooms, setUnreadRooms] = useState<Set<string>>(new Set());
  
  // Join/Create State
  const [isJoining, setIsJoining] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [pin, setPin] = useState('');
  
  // User Profile State
  const [username, setUsername] = useState(localStorage.getItem('chatUsername') || user.email?.split('@')[0] || 'User');
  const [avatarURL, setAvatarURL] = useState(localStorage.getItem('chatAvatarURL') || `https://api.dicebear.com/9.x/bottts/svg?seed=${user.uid}`);

  // Fetch Rooms
  useEffect(() => {
    const fetchRooms = async () => {
      // Fetch rooms created by the user
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('created_by', user.uid)
        .order('created_at', { ascending: false });

      if (data) {
        setRooms(data);
        checkUnreadMessages(data);
      }
      setLoading(false);
    };

    fetchRooms();
  }, [user.uid]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase.channel('dashboard-notifications')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            (payload) => {
                const newMsg = payload.new;
                // If I am the sender OR it is a system message, don't mark as unread
                if (newMsg.uid === user.uid || newMsg.type === 'system') return;

                // Check if we have this room in our list
                const hasRoom = rooms.some(r => r.room_key === newMsg.room_key);
                if (hasRoom) {
                    setUnreadRooms(prev => {
                        const newSet = new Set(prev);
                        newSet.add(newMsg.room_key);
                        return newSet;
                    });
                }
            }
        )
        .on(
            'postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'rooms' },
            (payload) => {
                // Immediately remove the deleted room from the list
                const deletedRoomId = payload.old.id;
                setRooms(prevRooms => prevRooms.filter(room => room.id !== deletedRoomId));
            }
        )
        .subscribe();

    return () => {
        supabase.removeChannel(channel);
    };
  }, [rooms, user.uid]);

  const checkUnreadMessages = async (currentRooms: Room[]) => {
      // For now, we don't persist "last read" so we just start fresh on reload.
      // Realtime updates will handle new messages while on dashboard.
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!roomName || !pin) return;
      
      const roomKey = generateRoomKey(pin, roomName);
      
      // Save profile
      localStorage.setItem('chatUsername', username);
      localStorage.setItem('chatAvatarURL', avatarURL);

      onJoinRoom({
          username,
          avatarURL,
          roomName,
          pin,
          roomKey
      });
  };

  const handleQuickJoin = (room: Room) => {
      // For created rooms, we have the pin.
      // Save profile
      localStorage.setItem('chatUsername', username);
      localStorage.setItem('chatAvatarURL', avatarURL);

      onJoinRoom({
          username,
          avatarURL,
          roomName: room.room_name,
          pin: room.pin,
          roomKey: room.room_key
      });
  };

  const handleDeleteRoom = async (e: React.MouseEvent, roomId: string) => {
      e.stopPropagation();
      if (window.confirm("Are you sure you want to delete this room? This cannot be undone.")) {
          await supabase.from('rooms').delete().eq('id', roomId);
          // UI update handled by realtime subscription usually, but we can optimistically update too
          setRooms(prev => prev.filter(r => r.id !== roomId));
      }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 md:p-8 transition-colors">
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Dashboard</h1>
                    <p className="text-slate-500 dark:text-slate-400">Welcome back, <span className="font-semibold">{username}</span></p>
                </div>
                <button 
                    onClick={onLogout}
                    className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm text-sm font-medium"
                >
                    <LogOut size={16} />
                    Sign Out
                </button>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Rooms List */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Shield size={20} className="text-blue-500" />
                            Your Secure Rooms
                        </h2>
                        {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
                    </div>

                    {rooms.length === 0 && !loading ? (
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center border border-slate-200 dark:border-slate-700 border-dashed">
                            <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center text-blue-500 mx-auto mb-4">
                                <MessageSquare size={32} />
                            </div>
                            <h3 className="text-lg font-semibold mb-2">No rooms yet</h3>
                            <p className="text-slate-500 dark:text-slate-400 mb-6">Create a secure room to start chatting.</p>
                            <button 
                                onClick={() => setIsJoining(true)}
                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition shadow-lg shadow-blue-500/20"
                            >
                                Create New Room
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {rooms.map(room => (
                                <div 
                                    key={room.id}
                                    onClick={() => handleQuickJoin(room)}
                                    className="group relative bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 transition-all cursor-pointer shadow-sm hover:shadow-md"
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-md">
                                            {room.room_name.substring(0, 2).toUpperCase()}
                                        </div>
                                        {unreadRooms.has(room.room_key) && (
                                            <span className="flex h-3 w-3">
                                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                              <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                                            </span>
                                        )}
                                    </div>
                                    
                                    <h3 className="font-bold text-lg mb-1 truncate pr-8">{room.room_name}</h3>
                                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-700/50 px-2 py-1 rounded w-fit">
                                        <span>PIN: ••••</span>
                                    </div>

                                    <button 
                                        onClick={(e) => handleDeleteRoom(e, room.id)}
                                        className="absolute top-4 right-4 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition opacity-0 group-hover:opacity-100"
                                        title="Delete Room"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right Column: Profile & Join */}
                <div className="space-y-6">
                    {/* Identity Card */}
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm">
                        <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                            <UserIcon size={18} /> Identity
                        </h3>
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative group">
                                <img 
                                    src={avatarURL} 
                                    alt="Avatar" 
                                    className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-700 object-cover border-2 border-slate-200 dark:border-slate-600"
                                />
                                <button 
                                    onClick={() => setAvatarURL(`https://api.dicebear.com/9.x/bottts/svg?seed=${Math.random()}`)}
                                    className="absolute bottom-0 right-0 bg-blue-600 text-white p-1 rounded-full shadow-lg hover:bg-blue-700 transition"
                                    title="New Avatar"
                                >
                                    <RefreshCw size={12} />
                                </button>
                            </div>
                            <div className="flex-1">
                                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Display Name</label>
                                <input 
                                    type="text" 
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-semibold focus:border-blue-500 outline-none transition"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Join/Create Card */}
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm">
                        <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                            <Plus size={18} /> Join or Create
                        </h3>
                        <form onSubmit={handleJoinSubmit} className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Room Name</label>
                                <input 
                                    type="text" 
                                    value={roomName}
                                    onChange={(e) => setRoomName(e.target.value)}
                                    placeholder="e.g. secretbase"
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none transition"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Room PIN</label>
                                <input 
                                    type="password" 
                                    value={pin}
                                    onChange={(e) => setPin(e.target.value)}
                                    placeholder="••••"
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none transition"
                                />
                            </div>
                            <button 
                                type="submit"
                                disabled={!roomName || !pin}
                                className="w-full py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Enter Room
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};

export default DashboardScreen;
