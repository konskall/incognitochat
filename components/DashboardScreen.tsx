import React, { useState, useEffect } from 'react';
import { User, ChatConfig, Room } from '../types';
import { supabase } from '../services/supabase';
import { generateRoomKey } from '../utils/helpers';
import { LogOut, Trash2, ArrowRight, Plus, Hash, KeyRound, Loader2 } from 'lucide-react';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Join Room Form State
  const [roomName, setRoomName] = useState('');
  const [pin, setPin] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    fetchRooms();
  }, [user.uid]);

  const fetchRooms = async () => {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('created_by', user.uid)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      if (data) setRooms(data);
    } catch (error) {
      console.error('Error fetching rooms:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${roomName}"? This cannot be undone.`)) return;

    try {
        const room = rooms.find(r => r.id === roomId);
        if (!room) return;

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
        const { error } = await supabase.from('rooms').delete().eq('id', roomId);
        
        if (error) {
          throw error;
        } else {
          setRooms(rooms.filter(r => r.id !== roomId));
        }
    } catch (e: any) {
        console.error("Delete room failed:", e);
        alert('Failed to delete room: ' + (e.message || "Unknown error"));
    }
  };

  const handleJoinExisting = (room: Room) => {
      // For creators, we use the stored PIN.
      onJoinRoom({
          username: user.email?.split('@')[0] || 'Host',
          avatarURL: `https://ui-avatars.com/api/?name=${user.email || 'Host'}&background=random`,
          roomName: room.room_name,
          pin: room.pin,
          roomKey: room.room_key
      });
  };

  const handleJoinNew = (e: React.FormEvent) => {
      e.preventDefault();
      if (!roomName || !pin) return;
      
      setIsJoining(true);
      const roomKey = generateRoomKey(pin, roomName);
      
      // Simulate delay or check logic if needed, otherwise just join
      setTimeout(() => {
          onJoinRoom({
              username: user.email?.split('@')[0] || 'User',
              avatarURL: `https://ui-avatars.com/api/?name=${user.email || 'User'}&background=random`,
              roomName: roomName,
              pin: pin,
              roomKey: roomKey
          });
          setIsJoining(false);
      }, 500);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center p-4">
       <header className="w-full max-w-4xl flex justify-between items-center py-6 mb-8">
           <div className="flex items-center gap-3">
               <img 
                 src="https://konskall.github.io/incognitochat/favicon-96x96.png" 
                 alt="Logo" 
                 className="w-10 h-10 rounded-xl shadow-md"
               />
               <h1 className="text-2xl font-bold text-slate-800 dark:text-white hidden sm:block">Incognito Dashboard</h1>
           </div>
           
           <div className="flex items-center gap-4">
               <div className="flex flex-col items-end">
                   <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{user.email}</span>
                   <span className="text-xs text-slate-500 dark:text-slate-400">Authenticated</span>
               </div>
               <button 
                onClick={onLogout}
                className="p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition"
                title="Logout"
               >
                   <LogOut size={20} />
               </button>
           </div>
       </header>

       <main className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8">
           
           {/* Left Column: Join / Create */}
           <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl border border-slate-100 dark:border-slate-700 h-fit">
               <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
                   <Plus size={24} className="text-blue-500" />
                   Join or Create Room
               </h2>
               
               <form onSubmit={handleJoinNew} className="space-y-4">
                   <div>
                       <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Room Name</label>
                       <div className="relative">
                           <Hash size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                           <input 
                               type="text" 
                               value={roomName}
                               onChange={e => setRoomName(e.target.value)}
                               placeholder="e.g. secretbase"
                               className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 dark:text-white transition"
                               required
                           />
                       </div>
                   </div>
                   
                   <div>
                       <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Room PIN</label>
                       <div className="relative">
                           <KeyRound size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                           <input 
                               type="password" 
                               value={pin}
                               onChange={e => setPin(e.target.value)}
                               placeholder="••••"
                               className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 dark:text-white transition"
                               required
                           />
                       </div>
                   </div>
                   
                   <button 
                       type="submit"
                       disabled={isJoining}
                       className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 transition transform active:scale-95 flex items-center justify-center gap-2"
                   >
                       {isJoining ? <Loader2 className="animate-spin" /> : 'Enter Room'}
                   </button>
               </form>
           </div>

           {/* Right Column: Your Rooms */}
           <div className="space-y-4">
               <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2 px-2">
                   <Hash size={24} className="text-purple-500" />
                   Your Rooms
               </h2>
               
               {loading ? (
                   <div className="flex justify-center py-10">
                       <Loader2 className="animate-spin text-slate-400" size={32} />
                   </div>
               ) : rooms.length === 0 ? (
                   <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center border border-slate-100 dark:border-slate-700 border-dashed">
                       <p className="text-slate-500 dark:text-slate-400">You haven't created any rooms yet.</p>
                   </div>
               ) : (
                   <div className="space-y-3">
                       {rooms.map(room => (
                           <div key={room.id} className="group bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition flex items-center justify-between">
                               <div>
                                   <h3 className="font-bold text-slate-800 dark:text-white">{room.room_name}</h3>
                                   <p className="text-xs text-slate-400 mt-1">PIN: ••••</p>
                                   <p className="text-[10px] text-slate-400">Created: {new Date(room.created_at).toLocaleDateString()}</p>
                               </div>
                               
                               <div className="flex items-center gap-2">
                                   <button 
                                       onClick={() => handleJoinExisting(room)}
                                       className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition"
                                       title="Join Room"
                                   >
                                       <ArrowRight size={20} />
                                   </button>
                                   <button 
                                       onClick={() => handleDeleteRoom(room.id, room.room_name)}
                                       className="p-2 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition opacity-0 group-hover:opacity-100"
                                       title="Delete Room"
                                   >
                                       <Trash2 size={20} />
                                   </button>
                               </div>
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
