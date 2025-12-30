
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { User, Subscriber, ChatConfig, Presence } from '../types';
import emailjs from '@emailjs/browser';

const EMAILJS_SERVICE_ID = "service_cnerkn6";
const EMAILJS_TEMPLATE_ID = "template_zr9v8bp";
const EMAILJS_PUBLIC_KEY = "cSDU4HLqgylnmX957";
const NOTIFICATION_COOLDOWN_MINUTES = 30;

export const useChatSettings = (config: ChatConfig, user: User | null, participants: Presence[]) => {
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('theme') !== 'light');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [canVibrate, setCanVibrate] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const themeColor = isDarkMode ? '#020617' : '#f8fafc';
    if (isDarkMode) {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    document.querySelector("meta[name='theme-color']")?.setAttribute("content", themeColor);
  }, [isDarkMode]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted') setNotificationsEnabled(true);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) setCanVibrate(true);
  }, []);

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
    } else {
      const p = await Notification.requestPermission();
      if (p === 'granted') setNotificationsEnabled(true);
    }
  };

  const notifySubscribers = useCallback(async (action: 'message' | 'deleted' | 'joined', details: string) => {
    if (!config.roomKey || !user || action === 'joined') return;

    const { data } = await supabase.from('subscribers').select('*').eq('room_key', config.roomKey);
    if (!data) return;

    const subscribers = data as Subscriber[];
    const onlineUserIds = new Set(participants.map(p => p.uid));
    const recipientsToEmail: string[] = [];
    const subscriberIdsToUpdate: string[] = [];
    const now = new Date();

    subscribers.forEach(sub => {
      if (sub.uid === user.uid || onlineUserIds.has(sub.uid)) return;
      if (sub.last_notified_at) {
        const diff = (now.getTime() - new Date(sub.last_notified_at).getTime()) / 60000;
        if (diff < NOTIFICATION_COOLDOWN_MINUTES && action !== 'deleted') return;
      }
      if (sub.email) {
        recipientsToEmail.push(sub.email);
        subscriberIdsToUpdate.push(sub.uid);
      }
    });

    if (recipientsToEmail.length > 0) {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: recipientsToEmail.join(','),
        room_name: config.roomName,
        action_type: action === 'deleted' ? 'Room Deleted' : 'New Message',
        sender_name: config.username,
        message_body: details,
        link: window.location.href
      }, EMAILJS_PUBLIC_KEY);

      await supabase.from('subscribers')
        .update({ last_notified_at: now.toISOString() })
        .in('uid', subscriberIdsToUpdate)
        .eq('room_key', config.roomKey);
    }
  }, [config, user, participants]);

  return {
    isDarkMode, setIsDarkMode,
    notificationsEnabled, toggleNotifications,
    soundEnabled, setSoundEnabled,
    vibrationEnabled, setVibrationEnabled,
    emailAlertsEnabled, setEmailAlertsEnabled,
    emailAddress, setEmailAddress,
    canVibrate, notifySubscribers
  };
};
