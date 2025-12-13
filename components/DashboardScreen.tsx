import React, { useState, useEffect } from 'react';
import { User, ChatConfig, Room } from '../types';
import { LogOut, Plus, ArrowRight, Hash, Activity, Clock } from 'lucide-react';
import { supabase } from '../services/supabase';
import { generateRoomKey } from '../utils/helpers';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
    const [myRooms, setMyRooms] = useState<Room[]>([]);
    const [roomName, setRoomName] = useState('');
    const [pin, setPin] = useState('');
    const [username, setUsername] = useState(localStorage.getItem('chatUsername') || user.email?.split('@')[0] || 'Agent');

    useEffect(() => {
        const fetchRooms = async () => {
            if (!user) return;
            // Retrieve rooms created by the user
            const { data: createdRooms } = await supabase
                .from('rooms')
                .select('*')
                .eq('created_by', user.uid)
                .order('created_at', { ascending: false });
            
            if (createdRooms) {
                setMyRooms(createdRooms);
            }
        };
        fetchRooms();
    }, [user]);

    const handleJoinCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!roomName || !pin || !username) return;
        
        const roomKey = generateRoomKey(pin, roomName);
        
        const config: ChatConfig = {
            username: username,
            avatarURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`,
            roomName: roomName,
            pin: pin,
            roomKey: roomKey
        };
        
        // Save username preference
        localStorage.setItem('chatUsername', username);

        onJoinRoom(config);
    };

    const handleQuickJoin = (room: Room) => {
        const roomKey = generateRoomKey(room.pin, room.room_name);
        const config: ChatConfig = {
             username: username,
             avatarURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`,
             roomName: room.room_name,
             pin: room.pin,
             roomKey: roomKey
        };
        localStorage.setItem('chatUsername', username);
        onJoinRoom(config);
    };

    return (
        <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 p-4 md:p-8 transition-colors">
            <div className="max-w-5xl mx-auto animate-in slide-in-from-bottom-4 duration-500">
                <header className="flex justify-between items-center mb-8 pb-6 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <img 
                            src="https://konskall.github.io/incognitochat/favicon-96x96.png" 
                            alt="Incognito Chat" 
                            className="w-10 h-10 rounded-xl shadow-lg shadow-blue-500/20"
                        />
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Dashboard</h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Logged in as <span className="font-semibold text-slate-700 dark:text-slate-300">{user.email}</span>
                            </p>
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

                <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column: Config & Create */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
                            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-800 dark:text-white">
                                <Plus size={20} className="text-blue-500" />
                                Join / Create Room
                            </h2>
                            <form onSubmit={handleJoinCreate} className="space-y-4">
                                <div>
                                    <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Display Name</label>
                                    <input 
                                        type="text" 
                                        value={username}
                                        onChange={e => setUsername(e.target.value)}
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 outline-none focus:border-blue-500 dark:focus:border-blue-400 dark:text-white transition-all"
                                        placeholder="Your name in chat"
                                        required
                                    />
                                </div>
                                <div className="h-px bg-slate-100 dark:bg-slate-800 my-2"></div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Room Name</label>
                                    <input 
                                        type="text" 
                                        value={roomName}
                                        onChange={e => setRoomName(e.target.value)}
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 outline-none focus:border-blue-500 dark:focus:border-blue-400 dark:text-white transition-all"
                                        placeholder="e.g. project-alpha"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Room PIN</label>
                                    <input 
                                        type="password" 
                                        value={pin}
                                        onChange={e => setPin(e.target.value)}
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 outline-none focus:border-blue-500 dark:focus:border-blue-400 dark:text-white transition-all"
                                        placeholder="Min 4 chars"
                                        required
                                        minLength={4}
                                    />
                                </div>
                                <button className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-bold rounded-xl transition shadow-lg shadow-blue-500/20 active:scale-95 transform">
                                    Enter Room
                                </button>
                            </form>
                        </div>
                    </div>

                    {/* Right Column: Rooms List */}
                    <div className="lg:col-span-2 space-y-4">
                         <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-white">
                                <Hash size={20} className="text-blue-500" />
                                Your Rooms
                            </h2>
                            <span className="text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-800">
                                {myRooms.length} Found
                            </span>
                         </div>
                        
                        {myRooms.length === 0 ? (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl p-12 text-center border border-slate-200 dark:border-slate-800 text-slate-500 flex flex-col items-center gap-4">
                                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center">
                                    <Hash size={32} className="text-slate-300 dark:text-slate-600" />
                                </div>
                                <p>You haven't created any rooms yet.</p>
                                <p className="text-xs text-slate-400">Use the form on the left to create one.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {myRooms.map(room => (
                                    <div 
                                        key={room.id} 
                                        onClick={() => handleQuickJoin(room)} 
                                        className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500 cursor-pointer transition-all hover:shadow-md group relative"
                                    >
                                         <div className="flex justify-between items-start mb-3">
                                             <div className="flex items-center gap-3">
                                                 <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-500 font-bold text-lg group-hover:bg-blue-500 group-hover:text-white transition-colors">
                                                     {room.room_name.substring(0,2).toUpperCase()}
                                                 </div>
                                                 <div>
                                                     <h3 className="font-bold text-base text-slate-800 dark:text-white leading-tight">{room.room_name}</h3>
                                                     <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">PIN: {'•'.repeat(room.pin.length)}</p>
                                                 </div>
                                             </div>
                                             <div className="w-8 h-8 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-300 group-hover:text-blue-500 transition-colors">
                                                 <ArrowRight size={16} />
                                             </div>
                                         </div>
                                         
                                         <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400">
                                            <div className="flex items-center gap-1.5">
                                                <Clock size={12} />
                                                <span>{new Date(room.created_at).toLocaleDateString()}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Activity size={12} />
                                                <span>Active</span>
                                            </div>
                                         </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
};

export default DashboardScreen;
