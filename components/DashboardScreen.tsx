import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { User, ChatConfig, Room } from '../types';
import { generateRoomKey } from '../utils/helpers';
import { LogOut, Plus, Trash2, ArrowRight, Loader2 } from 'lucide-react';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRooms = async () => {
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
        setLoading(false);
      }
    };

    fetchRooms();
  }, [user.uid]);

  const handleJoin = (room: Room) => {
    // Determine username. Use part of email or default.
    const username = user.email ? user.email.split('@')[0] : 'Host';
    const avatarURL = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;

    const config: ChatConfig = {
        username,
        avatarURL,
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
        if (!room) {
            console.error("Room not found in local state");
            return;
        }

        const roomKey = room.room_key;

        // 1. Delete messages linked to this room
        const { error: msgError } = await supabase.from('messages').delete().eq('room_key', roomKey);
        if (msgError) console.error("Error deleting messages:", msgError);

        // 2. Delete subscribers linked to this room
        const { error: subError } = await supabase.from('subscribers').delete().eq('room_key', roomKey);
        if (subError) console.error("Error deleting subscribers:", subError);

        // 3. Clean up storage attachments
        const { data: files } = await supabase.storage.from('attachments').list(roomKey);
        if (files && files.length > 0) {
            const filesToRemove = files.map(x => `${roomKey}/${x.name}`);
            await supabase.storage.from('attachments').remove(filesToRemove);
        }

        // 4. Finally delete the room
        const { error } = await supabase.from('rooms').delete().eq('room_key', roomKey);
        
        if (error) {
          throw error;
        } else {
          setRooms(rooms.filter(r => r.room_key !== roomKey));
        }
    } catch (e: any) {
        console.error("Delete room failed:", e);
        alert('Failed to delete room: ' + (e.message || "Unknown error"));
    }
  };

  // State for creating a new room
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPin, setNewRoomPin] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreateRoom = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newRoomName || !newRoomPin) return;

      setCreating(true);
      const roomKey = generateRoomKey(newRoomPin, newRoomName);
      
      try {
           // Check if exists
           const { data: existing } = await supabase
            .from('rooms')
            .select('id')
            .eq('room_key', roomKey)
            .maybeSingle();
            
           if (existing) {
               alert("A room with this name and PIN already exists.");
               setCreating(false);
               return;
           }

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
           }
      } catch (e: any) {
          console.error("Create failed", e);
          alert("Failed to create room: " + e.message);
      } finally {
          setCreating(false);
      }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white p-4 sm:p-8">
        <header className="flex justify-between items-center mb-8 max-w-4xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold">My Rooms</h1>
                <p className="text-slate-500 dark:text-slate-400">Manage your active chat rooms</p>
            </div>
            <button onClick={onLogout} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 dark:bg-red-900/10 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors">
                <LogOut size={18} />
                Logout
            </button>
        </header>

        <main className="max-w-4xl mx-auto space-y-6">
            {/* Create Room Section */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
                {!showCreate ? (
                    <button 
                        onClick={() => setShowCreate(true)}
                        className="w-full py-4 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl flex items-center justify-center gap-2 text-slate-500 hover:text-blue-600 hover:border-blue-400 dark:hover:text-blue-400 transition-colors"
                    >
                        <Plus size={24} />
                        <span className="font-semibold">Create New Room</span>
                    </button>
                ) : (
                    <form onSubmit={handleCreateRoom} className="space-y-4 animate-in fade-in slide-in-from-top-2">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="font-semibold text-lg">New Room Details</h3>
                            <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600">Close</button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Room Name</label>
                                <input 
                                    type="text" 
                                    value={newRoomName}
                                    onChange={e => setNewRoomName(e.target.value)}
                                    className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="e.g. Project Alpha"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">PIN Code</label>
                                <input 
                                    type="text" 
                                    value={newRoomPin}
                                    onChange={e => setNewRoomPin(e.target.value)}
                                    className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Secret Key"
                                    required
                                />
                            </div>
                        </div>
                        <div className="flex justify-end pt-2">
                            <button 
                                type="submit" 
                                disabled={creating}
                                className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2"
                            >
                                {creating ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                                Create Room
                            </button>
                        </div>
                    </form>
                )}
            </div>

            {/* Rooms List */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-slate-400" size={32} />
                </div>
            ) : rooms.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                    <p>You haven't created any rooms yet.</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {rooms.map(room => (
                        <div key={room.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                            <div>
                                <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">{room.room_name}</h3>
                                <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400 mt-1">
                                    <span className="bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-xs font-mono">PIN: {room.pin}</span>
                                    <span>Created {new Date(room.created_at).toLocaleDateString()}</span>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={() => handleJoin(room)}
                                    className="flex-1 sm:flex-none px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition flex items-center justify-center gap-2"
                                >
                                    Enter Room <ArrowRight size={16} />
                                </button>
                                <button 
                                    onClick={() => handleDeleteRoom(room.id, room.room_name)}
                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                                    title="Delete Room"
                                >
                                    <Trash2 size={20} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </main>
    </div>
  );
};

export default DashboardScreen;
