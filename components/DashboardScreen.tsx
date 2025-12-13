import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { User, ChatConfig, Room } from '../types';
import { LogOut, Trash2, Crown, ShieldAlert } from 'lucide-react';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [unreadRooms, setUnreadRooms] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRooms = async () => {
      try {
        setLoading(true);
        // Fetch rooms created by user
        const { data: createdRooms, error: createdError } = await supabase
          .from('rooms')
          .select('*')
          .eq('created_by', user.uid);

        if (createdError) throw createdError;

        // Fetch rooms user is subscribed to (joined)
        const { data: subscriptions, error: subError } = await supabase
            .from('subscribers')
            .select('room_key')
            .eq('uid', user.uid);

        if (subError) throw subError;
            
        const subscribedRoomKeys = subscriptions?.map((s: any) => s.room_key) || [];
        
        let allRooms: Room[] = createdRooms ? [...createdRooms] : [];

        // Fetch details for subscribed rooms that are not already in createdRooms
        const missingKeys = subscribedRoomKeys.filter(k => !allRooms.some(r => r.room_key === k));
        
        if (missingKeys.length > 0) {
            const { data: otherRooms, error: otherError } = await supabase
                .from('rooms')
                .select('*')
                .in('room_key', missingKeys);
            
            if (otherError) throw otherError;

            if (otherRooms) {
                allRooms = [...allRooms, ...otherRooms];
            }
        }
        
        // Remove duplicates by room_key and sort by creation date
        const uniqueRooms = Array.from(new Map(allRooms.map(room => [room.room_key, room])).values());
        uniqueRooms.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        setRooms(uniqueRooms);
      } catch (error) {
        console.error("Error fetching rooms", error);
      } finally {
        setLoading(false);
      }
    };

    if (user) {
        fetchRooms();
    }
  }, [user]);

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    const room = rooms.find(r => r.id === roomId || r.room_name === roomName);
    if (!room) return;

    // Check if the current user is the creator
    const isOwner = room.created_by === user.uid;
    const message = isOwner 
        ? `Are you sure you want to delete "${roomName}"? This will remove it for everyone and cannot be undone.`
        : `Are you sure you want to remove "${roomName}" from your history?`;

    if (!window.confirm(message)) return;

    // Store key locally to ensure we use the correct one in state updates
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

        // --- UPDATE UI IMMEDIATELY ---
        
        // 1. Remove from rooms list
        setRooms(prevRooms => prevRooms.filter(r => r.room_key !== targetRoomKey));

        // 2. Remove from unread notifications if present
        setUnreadRooms(prev => {
            const next = new Set(prev);
            next.delete(targetRoomKey);
            return next;
        });

        // 3. Cleanup local storage
        localStorage.removeItem(`lastRead_${targetRoomKey}`);

    } catch (e: any) {
        console.error("Delete/Leave room failed:", e);
        alert('Operation failed: ' + (e.message || "Unknown error"));
    }
  };

  const handleEnterRoom = async (room: Room) => {
    try {
        // Try to fetch existing user profile for this room
        const { data: subData } = await supabase
            .from('subscribers')
            .select('username')
            .eq('room_key', room.room_key)
            .eq('uid', user.uid)
            .maybeSingle();
            
        const config: ChatConfig = {
            username: subData?.username || user.email?.split('@')[0] || 'User',
            avatarURL: `https://api.dicebear.com/9.x/bottts/svg?seed=${user.uid}`,
            roomName: room.room_name,
            pin: room.pin,
            roomKey: room.room_key
        };
        
        onJoinRoom(config);
    } catch (e) {
        console.error("Error entering room", e);
        // Fallback
        const config: ChatConfig = {
            username: user.email?.split('@')[0] || 'User',
            avatarURL: `https://api.dicebear.com/9.x/bottts/svg?seed=${user.uid}`,
            roomName: room.room_name,
            pin: room.pin,
            roomKey: room.room_key
        };
        onJoinRoom(config);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
             <img src="https://konskall.github.io/incognitochat/favicon-96x96.png" alt="Logo" className="w-8 h-8 rounded-lg" />
             <h1 className="text-xl font-bold text-slate-800 dark:text-white">Dashboard</h1>
        </div>
        <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{user.email}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">Authenticated</span>
            </div>
            <button 
                onClick={onLogout} 
                className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                title="Logout"
            >
                <LogOut size={20} />
            </button>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full">
         <div className="flex justify-between items-center mb-6">
             <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Your Rooms</h2>
         </div>

         {loading ? (
             <div className="flex items-center justify-center h-64">
                 <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
             </div>
         ) : rooms.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-64 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 text-center">
                 <ShieldAlert size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                 <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-200 mb-2">No Rooms Found</h3>
                 <p className="text-slate-500 dark:text-slate-400 max-w-md">
                     You haven't created or joined any persistent rooms yet. 
                     Join a room from the login screen to see it here.
                 </p>
             </div>
         ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {rooms.map((room) => {
                     const isOwner = room.created_by === user.uid;
                     return (
                         <div 
                            key={room.id} 
                            className="group bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col"
                         >
                             <div className="p-5 flex-1">
                                 <div className="flex justify-between items-start mb-3">
                                     <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xl shadow-lg">
                                         {room.room_name.substring(0, 2).toUpperCase()}
                                     </div>
                                     {isOwner && (
                                         <span className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1">
                                             <Crown size={12} fill="currentColor" />
                                             OWNER
                                         </span>
                                     )}
                                 </div>
                                 <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1 truncate">
                                     {room.room_name}
                                 </h3>
                                 <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 flex flex-col gap-0.5">
                                     <span>Created: {new Date(room.created_at).toLocaleDateString()}</span>
                                     <span className="font-mono bg-slate-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded w-fit text-[10px]">PIN: {room.pin}</span>
                                 </p>
                             </div>
                             
                             <div className="px-5 py-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex gap-3">
                                 <button 
                                     onClick={() => handleEnterRoom(room)}
                                     className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-colors shadow-lg shadow-blue-500/20 active:scale-95"
                                 >
                                     Enter Room
                                 </button>
                                 <button 
                                     onClick={() => handleDeleteRoom(room.id, room.room_name)}
                                     className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
                                     title={isOwner ? "Delete Room" : "Remove from list"}
                                 >
                                     <Trash2 size={20} />
                                 </button>
                             </div>
                         </div>
                     );
                 })}
             </div>
         )}
      </main>
    </div>
  );
};

export default DashboardScreen;
