
import React, { useState, useEffect } from 'react';
import { User, ChatConfig, Room } from '../types';
import { supabase } from '../services/supabase';
import { generateRoomKey } from '../utils/helpers';
import { LogOut, Plus, Trash2, MessageSquare, Shield, Loader2, Search } from 'lucide-react';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPin, setNewRoomPin] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [joinRoomName, setJoinRoomName] = useState('');
  const [joinRoomPin, setJoinRoomPin] = useState('');
  const [unreadRooms, setUnreadRooms] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchRooms();
  }, [user]);

  const fetchRooms = async () => {
    setLoading(true);
    try {
        // Fetch rooms created by user
        const { data: myRooms, error: roomsError } = await supabase
            .from('rooms')
            .select('*')
            .eq('created_by', user.uid)
            .order('created_at', { ascending: false });

        if (roomsError) throw roomsError;

        // Fetch rooms subscribed to (where user is a subscriber)
        const { data: subs, error: subsError } = await supabase
            .from('subscribers')
            .select('room_key')
            .eq('uid', user.uid);
            
        if (subsError) throw subsError;

        const subscribedRoomKeys = subs.map(s => s.room_key);
        
        let allRooms = [...(myRooms || [])] as Room[];
        
        if (subscribedRoomKeys.length > 0) {
            const { data: subbedRooms, error: subbedRoomsError } = await supabase
                .from('rooms')
                .select('*')
                .in('room_key', subscribedRoomKeys);
                
            if (!subbedRoomsError && subbedRooms) {
                // Merge avoiding duplicates
                const myRoomKeys = new Set(allRooms.map(r => r.room_key));
                subbedRooms.forEach((r: Room) => {
                    if (!myRoomKeys.has(r.room_key)) {
                        allRooms.push(r);
                    }
                });
            }
        }

        // Sort by creation date desc
        allRooms.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setRooms(allRooms);
        
        // Simplified unread check (placeholder logic)
        const unread = new Set<string>();
        for (const room of allRooms) {
            const lastRead = localStorage.getItem(`lastRead_${room.room_key}`);
            if (!lastRead) {
                // Logic to mark unread can be added here
            }
        }
        setUnreadRooms(unread);

    } catch (error) {
        console.error("Error fetching rooms:", error);
    } finally {
        setLoading(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newRoomName || !newRoomPin) return;
      if (newRoomName.length < 3) return alert("Room name too short");
      if (newRoomPin.length < 4) return alert("PIN too short (min 4 chars)");

      setIsCreating(true);
      try {
          const roomKey = generateRoomKey(newRoomPin, newRoomName);
          
          // Check if exists
          const { data: existing } = await supabase.from('rooms').select('id').eq('room_key', roomKey).maybeSingle();
          if (existing) {
              alert("A room with this Name and PIN already exists.");
              setIsCreating(false);
              return;
          }

          const { error } = await supabase.from('rooms').insert({
              room_key: roomKey,
              room_name: newRoomName,
              pin: newRoomPin,
              created_by: user.uid
          });

          if (error) throw error;

          setNewRoomName('');
          setNewRoomPin('');
          fetchRooms(); // Refresh list
          
          // Auto join
          handleEnterRoom(newRoomName, newRoomPin, roomKey);

      } catch (e: any) {
          console.error("Create failed", e);
          alert(e.message);
      } finally {
          setIsCreating(false);
      }
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!joinRoomName || !joinRoomPin) return;
      
      const roomKey = generateRoomKey(joinRoomPin, joinRoomName);
      // Directly try to join/enter. ChatScreen handles non-existent rooms by creating them if pin matches (though ChatScreen room creation logic might differ, Dashboard assumes managing persistent rooms). 
      // Ideally we check if room exists or let ChatScreen handle it. Here we just pass config.
      
      handleEnterRoom(joinRoomName, joinRoomPin, roomKey);
  };

  const handleEnterRoom = (rName: string, rPin: string, rKey: string) => {
      onJoinRoom({
          username: user.email?.split('@')[0] || 'User',
          avatarURL: `https://ui-avatars.com/api/?name=${user.email || 'User'}&background=random`,
          roomName: rName,
          pin: rPin,
          roomKey: rKey
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
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-900 flex flex-col items-center p-4 pt-8 md:pt-12">
        <header className="w-full max-w-4xl flex justify-between items-center mb-8">
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl shadow-lg">
                    {user.email?.[0].toUpperCase() || 'U'}
                </div>
                <div>
                    <h1 className="text-xl font-bold text-slate-800 dark:text-white">Dashboard</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
                </div>
            </div>
            <button 
                onClick={onLogout}
                className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-slate-800 rounded-xl transition-colors"
                title="Logout"
            >
                <LogOut size={24} />
            </button>
        </header>

        <main className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Left Column: Actions */}
            <div className="md:col-span-1 space-y-6">
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
                     <h2 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                        <Plus size={20} className="text-blue-500" /> Create Room
                     </h2>
                     <form onSubmit={handleCreateRoom} className="space-y-4">
                         <input 
                            type="text" 
                            placeholder="Room Name"
                            value={newRoomName}
                            onChange={e => setNewRoomName(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-white text-sm"
                            maxLength={30}
                         />
                         <input 
                            type="password" 
                            placeholder="Set a 4-digit PIN"
                            value={newRoomPin}
                            onChange={e => setNewRoomPin(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-white text-sm"
                            maxLength={12}
                         />
                         <button 
                            type="submit"
                            disabled={isCreating}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
                         >
                            {isCreating ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'Create'}
                         </button>
                     </form>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
                     <h2 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                        <Search size={20} className="text-purple-500" /> Join Room
                     </h2>
                     <form onSubmit={handleJoinSubmit} className="space-y-4">
                         <input 
                            type="text" 
                            placeholder="Room Name"
                            value={joinRoomName}
                            onChange={e => setJoinRoomName(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-purple-500 outline-none text-slate-900 dark:text-white text-sm"
                         />
                         <input 
                            type="password" 
                            placeholder="Room PIN"
                            value={joinRoomPin}
                            onChange={e => setJoinRoomPin(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-purple-500 outline-none text-slate-900 dark:text-white text-sm"
                         />
                         <button 
                            type="submit"
                            className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-lg shadow-purple-500/20 transition-all"
                         >
                            Join
                         </button>
                     </form>
                </div>
            </div>

            {/* Right Column: Room List */}
            <div className="md:col-span-2">
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden min-h-[500px] flex flex-col">
                    <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
                         <h2 className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                             <MessageSquare size={20} /> Your Rooms
                         </h2>
                         <button 
                            onClick={fetchRooms} 
                            className="text-xs text-blue-500 hover:underline"
                         >
                             Refresh
                         </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {loading ? (
                            <div className="flex items-center justify-center h-40 text-slate-400">
                                <Loader2 className="animate-spin" size={24} />
                            </div>
                        ) : rooms.length === 0 ? (
                            <div className="text-center text-slate-400 py-10">
                                <p>You haven't joined any rooms yet.</p>
                                <p className="text-sm mt-1">Create or join one to get started!</p>
                            </div>
                        ) : (
                            rooms.map(room => (
                                <div key={room.id} className="group flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 hover:bg-blue-50 dark:hover:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-700 transition-all">
                                    <div 
                                        className="flex-1 cursor-pointer" 
                                        onClick={() => handleEnterRoom(room.room_name, room.pin, room.room_key)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-300 font-bold">
                                                {room.room_name.substring(0, 2).toUpperCase()}
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                                    {room.room_name}
                                                    {room.created_by === user.uid && (
                                                        <Shield size={12} className="text-yellow-500 fill-yellow-500" title="Admin" />
                                                    )}
                                                </h3>
                                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                                    Created {new Date(room.created_at).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={() => handleDeleteRoom(room.id, room.room_name)}
                                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                                            title={room.created_by === user.uid ? "Delete Room" : "Leave Room"}
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

        </main>
    </div>
  );
};

export default DashboardScreen;
