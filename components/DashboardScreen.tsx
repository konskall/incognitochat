import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { User, ChatConfig, Room } from '../types';
import { LogOut, Plus, Trash2, MessageSquare, Loader2, Search } from 'lucide-react';
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
  
  // State for new room creation/join
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPin, setNewRoomPin] = useState('');

  useEffect(() => {
    fetchRooms();
  }, [user]);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      // 1. Fetch rooms created by user
      const { data: createdRooms, error: createdError } = await supabase
        .from('rooms')
        .select('*')
        .eq('created_by', user.uid);
        
      if (createdError) throw createdError;

      // 2. Fetch rooms where user is subscribed
      const { data: subscriptions, error: subError } = await supabase
        .from('subscribers')
        .select('room_key')
        .eq('uid', user.uid);
        
      if (subError) throw subError;

      let joinedRooms: Room[] = [];
      if (subscriptions && subscriptions.length > 0) {
        const roomKeys = subscriptions.map((s: any) => s.room_key);
        // Avoid duplicates if user is both creator and subscriber
        const keysToFetch = roomKeys.filter((k: string) => !createdRooms?.some(cr => cr.room_key === k));
        
        if (keysToFetch.length > 0) {
            const { data: foundJoined, error: joinedError } = await supabase
                .from('rooms')
                .select('*')
                .in('room_key', keysToFetch);
            
            if (joinedError) throw joinedError;
            if (foundJoined) joinedRooms = foundJoined;
        }
      }

      const allRooms = [...(createdRooms || []), ...joinedRooms];
      // Sort by creation date desc
      allRooms.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      setRooms(allRooms);
      
    } catch (error) {
      console.error('Error fetching rooms:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinExisting = (room: Room) => {
      onJoinRoom({
          username: user.email?.split('@')[0] || localStorage.getItem('chatUsername') || 'Anonymous',
          avatarURL: localStorage.getItem('chatAvatarURL') || `https://api.dicebear.com/9.x/bottts/svg?seed=${user.uid}`,
          roomName: room.room_name,
          pin: room.pin,
          roomKey: room.room_key
      });
  };

  const handleCreateOrJoin = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newRoomName || !newRoomPin) return;
      
      const roomKey = generateRoomKey(newRoomPin, newRoomName);
      
      // We assume simple join logic here, ChatScreen handles room creation if needed
      onJoinRoom({
          username: user.email?.split('@')[0] || localStorage.getItem('chatUsername') || 'Anonymous',
          avatarURL: localStorage.getItem('chatAvatarURL') || `https://api.dicebear.com/9.x/bottts/svg?seed=${user.uid}`,
          roomName: newRoomName,
          pin: newRoomPin,
          roomKey: roomKey
      });
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

    const targetRoomKey = room.room_key;

    try {
        if (!isOwner) {
             // If not creator, just remove subscription (leave room)
             const { error } = await supabase.from('subscribers')
                .delete()
                .eq('room_key', targetRoomKey)
                .eq('uid', user.uid);
             
             if (error) throw error;
        } else {
            // If creator, perform full delete
            // Cleanup associated data
            await supabase.from('messages').delete().eq('room_key', targetRoomKey);
            await supabase.from('subscribers').delete().eq('room_key', targetRoomKey);

            const { data: files } = await supabase.storage.from('attachments').list(targetRoomKey);
            if (files && files.length > 0) {
                const filesToRemove = files.map(x => `${targetRoomKey}/${x.name}`);
                await supabase.storage.from('attachments').remove(filesToRemove);
            }

            const { error } = await supabase.from('rooms').delete().eq('room_key', targetRoomKey);
            if (error) throw error;
        }

        // --- SUCCESSFUL DELETE/LEAVE ---
        
        // 1. Remove from local storage (cleanup)
        localStorage.removeItem(`lastRead_${targetRoomKey}`);

        // 2. Update Rooms List Immediately (Functional update to avoid stale state)
        setRooms(prevRooms => prevRooms.filter(r => r.room_key !== targetRoomKey));

        // 3. Remove from Unread Notifications if present
        setUnreadRooms(prev => {
            const newSet = new Set(prev);
            newSet.delete(targetRoomKey);
            return newSet;
        });

    } catch (e: any) {
        console.error("Delete/Leave room failed:", e);
        alert('Operation failed: ' + (e.message || "Unknown error"));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center p-4">
      <header className="w-full max-w-4xl flex justify-between items-center mb-8 pt-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <span className="bg-blue-600 text-white p-2 rounded-lg"><MessageSquare size={20} /></span>
            My Rooms
        </h1>
        <button onClick={onLogout} className="flex items-center gap-2 text-slate-500 hover:text-red-500 transition">
            <LogOut size={20} />
            <span className="hidden sm:inline">Logout</span>
        </button>
      </header>

      <main className="w-full max-w-4xl flex-1 flex flex-col gap-6">
        
        {/* Create/Join Section */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold mb-4 text-slate-700 dark:text-slate-200">Join or Create Room</h2>
            <form onSubmit={handleCreateOrJoin} className="flex flex-col sm:flex-row gap-3">
                <input 
                    type="text" 
                    placeholder="Room Name" 
                    value={newRoomName}
                    onChange={e => setNewRoomName(e.target.value)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                />
                <input 
                    type="text" 
                    placeholder="PIN" 
                    value={newRoomPin}
                    onChange={e => setNewRoomPin(e.target.value)}
                    className="w-full sm:w-32 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                />
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-medium transition flex items-center justify-center gap-2">
                    <Plus size={20} />
                    <span>Enter</span>
                </button>
            </form>
        </div>

        {/* Room List */}
        <div className="flex-1">
            <h2 className="text-lg font-semibold mb-4 text-slate-700 dark:text-slate-200 flex items-center gap-2">
                Active Rooms
                {loading && <Loader2 size={16} className="animate-spin" />}
            </h2>
            
            {loading ? (
                <div className="space-y-3">
                    {[1,2,3].map(i => (
                        <div key={i} className="h-20 bg-slate-200 dark:bg-slate-800 rounded-xl animate-pulse"></div>
                    ))}
                </div>
            ) : rooms.length === 0 ? (
                <div className="text-center py-12 text-slate-400 dark:text-slate-600 bg-white dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                    <Search size={48} className="mx-auto mb-3 opacity-50" />
                    <p>No rooms found.</p>
                    <p className="text-sm">Join a room above to get started.</p>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {rooms.map(room => (
                        <div key={room.id} className="group relative bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 hover:shadow-md transition-all hover:-translate-y-1">
                            <div onClick={() => handleJoinExisting(room)} className="cursor-pointer">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                                        {room.room_name.substring(0, 2).toUpperCase()}
                                    </div>
                                    {unreadRooms.has(room.room_key) && (
                                        <span className="w-3 h-3 bg-red-500 rounded-full"></span>
                                    )}
                                </div>
                                <h3 className="font-bold text-slate-800 dark:text-white text-lg truncate">{room.room_name}</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400">PIN: <span className="font-mono bg-slate-100 dark:bg-slate-700 px-1 rounded">****</span></p>
                                <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                                    <span>{room.created_by === user.uid ? 'Owner' : 'Member'}</span>
                                    <span>•</span>
                                    <span>{new Date(room.created_at).toLocaleDateString()}</span>
                                </div>
                            </div>
                            
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room.id, room.room_name); }}
                                className="absolute top-4 right-4 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                title={room.created_by === user.uid ? "Delete Room" : "Leave Room"}
                            >
                                <Trash2 size={18} />
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
