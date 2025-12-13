
import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { User, Room, ChatConfig } from '../types';
import { generateRoomKey } from '../utils/helpers';
import { LogOut, Plus, Trash2, MessageSquare, Loader2, Shield } from 'lucide-react';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  
  // New Room Form State
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPin, setNewRoomPin] = useState('');
  const [username, setUsername] = useState(localStorage.getItem('chatUsername') || user.email?.split('@')[0] || 'User');
  const [creatingLoader, setCreatingLoader] = useState(false);

  useEffect(() => {
    fetchRooms();
  }, [user.uid]);

  const fetchRooms = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('created_by', user.uid)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setRooms(data as Room[]);
    }
    setLoading(false);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName || !newRoomPin) return;

    setCreatingLoader(true);
    const roomKey = generateRoomKey(newRoomPin, newRoomName);

    // check if exists first (optional, RLS might handle it)
    const { data: existing } = await supabase.from('rooms').select('id').eq('room_key', roomKey).maybeSingle();
    
    if (existing) {
        alert('A room with this Name and PIN already exists.');
        setCreatingLoader(false);
        return;
    }

    const { error } = await supabase.from('rooms').insert({
      room_key: roomKey,
      room_name: newRoomName,
      pin: newRoomPin,
      created_by: user.uid
    });

    if (error) {
      alert('Error creating room: ' + error.message);
    } else {
      setNewRoomName('');
      setNewRoomPin('');
      setIsCreating(false);
      fetchRooms();
    }
    setCreatingLoader(false);
  };

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${roomName}"? This cannot be undone.`)) return;

    const { error } = await supabase.from('rooms').delete().eq('id', roomId);
    if (error) {
      alert('Failed to delete room');
    } else {
      setRooms(rooms.filter(r => r.id !== roomId));
    }
  };

  const joinRoom = (room: Room) => {
    // Save to local storage for persistence across reloads if needed
    localStorage.setItem('chatUsername', username);
    localStorage.setItem('chatAvatarURL', `https://api.dicebear.com/9.x/bottts/svg?seed=${user.uid}`);
    localStorage.setItem('chatRoomName', room.room_name);
    localStorage.setItem('chatPin', room.pin);

    onJoinRoom({
      username: username,
      avatarURL: `https://api.dicebear.com/9.x/bottts/svg?seed=${user.uid}`, // Consistent avatar for signed-in user
      roomName: room.room_name,
      pin: room.pin,
      roomKey: room.room_key
    });
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
      <header className="max-w-5xl mx-auto flex justify-between items-center mb-8 bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3">
            <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-xl">
                 <Shield className="text-blue-600 dark:text-blue-400" size={24} />
            </div>
            <div>
                <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">My Dashboard</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
            </div>
        </div>
        <button 
          onClick={onLogout}
          className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
          title="Logout"
        >
          <LogOut size={20} />
        </button>
      </header>

      <main className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Profile / Config Card */}
        <div className="md:col-span-1 space-y-6">
             <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-6">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Your Persona</h2>
                <div className="flex flex-col gap-4">
                    <div className="flex justify-center">
                         <img 
                            src={`https://api.dicebear.com/9.x/bottts/svg?seed=${user.uid}`} 
                            alt="Avatar" 
                            className="w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500 dark:text-slate-400 font-semibold ml-1">Display Name</label>
                        <input 
                            type="text" 
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full mt-1 px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-slate-800 dark:text-slate-200"
                        />
                        <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                            This is the name others will see when you join a room. Your email remains private.
                        </p>
                    </div>
                </div>
             </div>

             <button 
                onClick={() => setIsCreating(!isCreating)}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow-lg shadow-blue-500/20 font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
             >
                 <Plus size={20} />
                 {isCreating ? 'Cancel Creation' : 'Create New Room'}
             </button>
        </div>

        {/* Rooms Grid */}
        <div className="md:col-span-2">
            {isCreating && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-blue-200 dark:border-blue-900/50 p-6 mb-6 animate-in slide-in-from-top-4">
                    <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100 mb-4">Create Secure Room</h3>
                    <form onSubmit={handleCreateRoom} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase">Room Name</label>
                                <input 
                                    required
                                    type="text" 
                                    placeholder="e.g. ProjectAlpha"
                                    value={newRoomName}
                                    onChange={(e) => setNewRoomName(e.target.value)}
                                    className="w-full mt-1 px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase">Secret PIN</label>
                                <input 
                                    required
                                    type="text" 
                                    placeholder="4-digit key"
                                    value={newRoomPin}
                                    onChange={(e) => setNewRoomPin(e.target.value)}
                                    className="w-full mt-1 px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <button 
                                disabled={creatingLoader}
                                type="submit" 
                                className="px-6 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl hover:opacity-90 transition-opacity"
                            >
                                {creatingLoader ? <Loader2 className="animate-spin" /> : 'Launch Room'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Your Rooms</h2>
            
            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-400" size={32} /></div>
            ) : rooms.length === 0 ? (
                <div className="text-center py-12 bg-white/50 dark:bg-slate-900/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                    <MessageSquare size={48} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                    <p className="text-slate-500 dark:text-slate-400 font-medium">No rooms created yet.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {rooms.map(room => (
                        <div key={room.id} className="group bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-blue-200 dark:hover:border-blue-900/50 transition-all">
                            <div className="flex justify-between items-start mb-3">
                                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                                    {room.room_name.substring(0,2).toUpperCase()}
                                </div>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room.id, room.room_name); }}
                                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                            <h3 className="font-bold text-slate-800 dark:text-slate-100 truncate">{room.room_name}</h3>
                            <p className="text-xs text-slate-400 mt-1 mb-4 font-mono">PIN: {room.pin}</p>
                            <button 
                                onClick={() => joinRoom(room)}
                                className="w-full py-2.5 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 font-semibold rounded-xl text-sm transition-colors"
                            >
                                Enter Room
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>

      </main>
    </div>
  );
};

export default DashboardScreen;
