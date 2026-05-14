import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { usePlatformSettings, formatBookingId } from '@/hooks/usePlatformSettings';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Search, Settings, Send, Paperclip, Smile, Clock,
  MessageSquare, Check, CheckCheck, CalendarClock, Image as ImageIcon, X,
  MapPin, Calendar, Home, ThumbsUp, Lock, AlertTriangle, Languages, Loader2, Undo2,
} from 'lucide-react';
import { CancellationRequestActions } from '@/components/CancellationRequestActions';
import { MessagesProfileDialog } from '@/components/MessagesProfileDialog';
import { HostCheckInButton } from '@/components/booking/HostCheckInButton';
import { CheckInDetailsPanel } from '@/components/booking/CheckInDetailsPanel';
import { detectContactInfo } from '@/lib/contactDetection';
import { checkAndRecordStrike } from '@/lib/fraud/strikes';
import { dispatchNotification } from '@/lib/notifications/dispatcher';
import { useTrustSafetySettings } from '@/hooks/useTrustSafetySettings';
import { usePlatformControls } from '@/hooks/usePlatformControls';
import { defaultQuickReplies, type QuickReplyKey } from '@/lib/automatedMessages';

type Profile = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string;
};

type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  is_read: boolean | null;
  booking_id: string | null;
  delivery_status: string;
  scheduled_at: string | null;
  message_type: string;
};

type BookingMeta = {
  id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  host_id: string;
  guest_id: string;
  actual_check_in_at: string | null;
};

type Conversation = {
  // Composite key: `${partnerId}__${bookingId ?? 'inquiry'}`
  key: string;
  partnerId: string;
  bookingId: string | null;
  partner: Profile;
  booking: BookingMeta | null;
  lastMessage: Message;
  unreadCount: number;
  hasBooking: boolean;
};

const QUICK_REPLIES = [
  { key: 'checkin', icon: Clock, text: "Hi! Could you please share the check-in instructions and any access codes I'll need?" },
  { key: 'dates', icon: Calendar, text: "Are the dates I selected still available? I'd love to confirm my booking." },
  { key: 'location', icon: MapPin, text: "Could you share more details about the location, nearby attractions, and transportation options?" },
  { key: 'amenities', icon: Home, text: "Could you tell me more about the amenities available at the property?" },
  { key: 'confirmed', icon: ThumbsUp, text: "Thank you for confirming! I'm looking forward to my stay. Please let me know if there's anything I should prepare." },
];

// Tick component
function MessageTicks({ status }: { status: string }) {
  if (status === 'read') {
    return <CheckCheck className="w-4 h-4 shrink-0" style={{ color: 'hsl(217, 91%, 60%)' }} />;
  }
  if (status === 'delivered') {
    return <CheckCheck className="w-4 h-4 shrink-0" style={{ color: 'hsl(28, 80%, 35%)' }} />;
  }
  return <Check className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

function formatMessageTime(dateStr: string) {
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Yesterday';
  if (isThisYear(date)) return format(date, 'MMM d');
  return format(date, 'MMM d, yyyy');
}

function formatChatTime(dateStr: string) {
  return format(new Date(dateStr), 'HH:mm');
}

function formatDateDivider(dateStr: string) {
  const date = new Date(dateStr);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, MMMM d, yyyy');
}

export default function Messages() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();
  const { settings: tsSettings } = useTrustSafetySettings();
  const { controls: platformControls } = usePlatformControls();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'bookings' | 'inquiries'>('all');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [profilesCache, setProfilesCache] = useState<Record<string, Profile>>({});
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  // Closed-conversation gating (booking cancelled/rejected/completed)
  const [conversationClosed, setConversationClosed] = useState<{ closed: boolean; status: string | null }>({ closed: false, status: null });
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  // Real-time contact-detection warning while typing
  const [liveWarning, setLiveWarning] = useState<{ show: boolean; reasons: string[] }>({ show: false, reasons: [] });
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Per-user enabled quick-reply prompts (managed in Settings → Messages)
  const [enabledQuickReplies, setEnabledQuickReplies] = useState<Record<QuickReplyKey, boolean>>(
    defaultQuickReplies(),
  );
  // Per-message translation cache: messageId → { text, lang } | 'loading' | 'error'.
  // Lets the user reveal a translation inline in the active interface language
  // without leaving the chat. Cleared on language switch so a stale Spanish
  // translation never lingers after the user picks French.
  const [translations, setTranslations] = useState<Record<
    string,
    { text: string; lang: string } | 'loading' | 'error'
  >>({});
  useEffect(() => { setTranslations({}); }, [i18n.language]);

  const targetLang = (i18n.language || 'en').split('-')[0];

  // Persistent translation cache (localStorage) keyed by `${messageId}:${lang}`.
  // Avoids re-invoking the edge function for messages we've already translated
  // on this device, even after a full page reload or app restart.
  const TRANSLATION_CACHE_KEY = 'messages.translationCache.v1';
  const TRANSLATION_CACHE_LIMIT = 2000;
  const readTranslationCache = useCallback((): Record<string, string> => {
    try {
      const raw = localStorage.getItem(TRANSLATION_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }, []);
  const writeTranslationCache = useCallback((messageId: string, lang: string, text: string) => {
    try {
      const cache = readTranslationCache();
      cache[`${messageId}:${lang}`] = text;
      // Bound cache size — drop oldest (insertion order) entries when full.
      const keys = Object.keys(cache);
      if (keys.length > TRANSLATION_CACHE_LIMIT) {
        const overflow = keys.length - TRANSLATION_CACHE_LIMIT;
        for (let i = 0; i < overflow; i++) delete cache[keys[i]];
      }
      localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cache));
    } catch { /* quota / private mode — ignore */ }
  }, [readTranslationCache]);

  // Auto-translate toggle — persisted per user in localStorage. Default ON so
  // incoming messages are automatically translated to the user's active
  // interface language without manual clicks.
  const [autoTranslate, setAutoTranslate] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('messages.autoTranslate');
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('messages.autoTranslate', autoTranslate ? '1' : '0'); } catch {}
  }, [autoTranslate]);

  const handleTranslate = useCallback(async (msg: Message) => {
    if (!msg.content?.trim()) return;
    const cacheKey = `${msg.id}:${targetLang}`;
    // 1. Check localStorage cache first — instant, no network round-trip.
    const cache = readTranslationCache();
    if (cache[cacheKey]) {
      setTranslations((prev) => ({
        ...prev,
        [msg.id]: { text: cache[cacheKey], lang: targetLang },
      }));
      return;
    }
    setTranslations((prev) => ({ ...prev, [msg.id]: 'loading' }));
    try {
      const { data, error } = await supabase.functions.invoke('translate-message', {
        body: { text: msg.content, targetLanguage: targetLang, messageId: msg.id },
      });
      if (error || !data?.translation) throw error || new Error('No translation');
      setTranslations((prev) => ({
        ...prev,
        [msg.id]: { text: data.translation, lang: targetLang },
      }));
      // 2. Persist to localStorage so reloading / reopening the chat is instant
      //    and incurs zero edge-function calls.
      writeTranslationCache(msg.id, targetLang, data.translation);
    } catch (err) {
      console.error('[translate-message] failed', err);
      setTranslations((prev) => ({ ...prev, [msg.id]: 'error' }));
      toast({
        title: t('messages.translateFailed'),
        description: t('messages.translateFailedDesc'),
        variant: 'destructive',
      });
    }
  }, [targetLang, toast, t, readTranslationCache, writeTranslationCache]);

  const handleHideTranslation = useCallback((msgId: string) => {
    setTranslations((prev) => {
      const next = { ...prev };
      delete next[msgId];
      return next;
    });
  }, []);

  // Unsend: helper used below; the click handler is defined further down,
  // after fetchMessages / fetchConversations are declared.
  const UNSEND_WINDOW_MS = 2 * 60 * 1000;
  const canUnsend = useCallback((msg: Message) => {
    if (!user || msg.sender_id !== user.id) return false;
    if (!msg.id) return false;
    const age = Date.now() - new Date(msg.created_at).getTime();
    return age <= UNSEND_WINDOW_MS;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('user_preferences')
        .select('quick_replies')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!active) return;
      const stored = ((data as any)?.quick_replies ?? {}) as Partial<Record<QuickReplyKey, boolean>>;
      setEnabledQuickReplies({ ...defaultQuickReplies(), ...stored });
    })();
    return () => {
      active = false;
    };
  }, [user]);

  // Fetch all conversations — grouped by (partner + booking) so each booking is its own thread
  const fetchConversations = useCallback(async () => {
    if (!user) return;

    const { data: allMsgs } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (!allMsgs) {
      setLoading(false);
      return;
    }

    // Group by composite key: partnerId + bookingId (or 'inquiry' when null)
    const groupMap = new Map<string, { partnerId: string; bookingId: string | null; messages: Message[] }>();
    for (const msg of allMsgs as Message[]) {
      const partnerId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
      const bookingId = msg.booking_id;
      const key = `${partnerId}__${bookingId ?? 'inquiry'}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, { partnerId, bookingId, messages: [] });
      }
      groupMap.get(key)!.messages.push(msg);
    }

    const partnerIds = Array.from(new Set(Array.from(groupMap.values()).map((g) => g.partnerId)));
    const bookingIds = Array.from(new Set(Array.from(groupMap.values()).map((g) => g.bookingId).filter(Boolean) as string[]));

    if (partnerIds.length === 0) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const [{ data: profiles }, { data: bookingsData }] = await Promise.all([
      supabase
        .from('profiles')
        .select('user_id, full_name, avatar_url, email')
        .in('user_id', partnerIds),
      bookingIds.length > 0
        ? supabase
            .from('bookings')
            .select('id, status, check_in_date, check_out_date, host_id, guest_id, actual_check_in_at')
            .in('id', bookingIds)
        : Promise.resolve({ data: [] as BookingMeta[] }),
    ]);

    // CRITICAL: when a message has a booking_id, the true counter-party is
    // the OTHER party on that booking — not whoever happens to be in
    // sender_id/receiver_id (which can drift if a system message or admin
    // posts on behalf of a side). Re-key those conversations to the booking's
    // canonical host/guest pair so guest threads and host threads always line
    // up to the same participants.
    const bookingLookup = new Map<string, BookingMeta>(
      (bookingsData || []).map((b: BookingMeta) => [b.id, b])
    );
    const canonicalGroupMap = new Map<string, { partnerId: string; bookingId: string | null; messages: Message[] }>();
    for (const [key, group] of groupMap.entries()) {
      let canonicalPartnerId = group.partnerId;
      if (group.bookingId) {
        const b = bookingLookup.get(group.bookingId);
        if (b) {
          // The partner is whichever of (host_id, guest_id) is NOT me.
          if (b.host_id === user.id) canonicalPartnerId = b.guest_id;
          else if (b.guest_id === user.id) canonicalPartnerId = b.host_id;
        }
      }
      const canonicalKey = `${canonicalPartnerId}__${group.bookingId ?? 'inquiry'}`;
      const existing = canonicalGroupMap.get(canonicalKey);
      if (existing) {
        existing.messages.push(...group.messages);
      } else {
        canonicalGroupMap.set(canonicalKey, {
          partnerId: canonicalPartnerId,
          bookingId: group.bookingId,
          messages: [...group.messages],
        });
      }
    }
    // Make sure profiles for the canonical partners are loaded too — the
    // previous fetch only covered the raw partner ids derived from messages.
    const canonicalPartnerIds = Array.from(
      new Set(Array.from(canonicalGroupMap.values()).map((g) => g.partnerId))
    );
    const missingProfileIds = canonicalPartnerIds.filter(
      (pid) => !(profiles || []).some((p) => p.user_id === pid)
    );
    let extraProfiles: any[] = [];
    if (missingProfileIds.length > 0) {
      const { data: extra } = await supabase
        .from('profiles')
        .select('user_id, full_name, avatar_url, email')
        .in('user_id', missingProfileIds);
      extraProfiles = extra || [];
    }

    if (!profiles) {
      setLoading(false);
      return;
    }

    const profCache: Record<string, Profile> = {};
    profiles.forEach((p) => { profCache[p.user_id] = p; });
    extraProfiles.forEach((p) => { profCache[p.user_id] = p; });
    // Fallback stubs for partners without a profiles row (e.g. guest accounts
    // that never completed onboarding). Without this they'd be silently
    // dropped from the inbox and the host would never see the message.
    for (const pid of [...partnerIds, ...canonicalPartnerIds]) {
      if (!profCache[pid]) {
        profCache[pid] = {
          user_id: pid,
          full_name: 'Guest',
          avatar_url: null,
          email: '',
        };
      }
    }
    setProfilesCache(profCache);

    const bookingCache = bookingLookup;

    const convos: Conversation[] = Array.from(canonicalGroupMap.entries())
      .map(([key, data]) => {
        const partner = profCache[data.partnerId];
        if (!partner) return null;
        // Sort merged messages so lastMessage stays accurate after merging.
        data.messages.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const unread = data.messages.filter(
          (m) => m.receiver_id === user.id && !m.is_read
        ).length;
        return {
          key,
          partnerId: data.partnerId,
          bookingId: data.bookingId,
          partner,
          booking: data.bookingId ? bookingCache.get(data.bookingId) || null : null,
          lastMessage: data.messages[0],
          unreadCount: unread,
          hasBooking: data.bookingId !== null,
        };
      })
      .filter(Boolean) as Conversation[];

    convos.sort(
      (a, b) =>
        new Date(b.lastMessage.created_at).getTime() -
        new Date(a.lastMessage.created_at).getTime()
    );
    setConversations(convos);
    setLoading(false);
  }, [user]);

  // Fetch messages for selected conversation (filtered by partner AND booking)
  const fetchMessages = useCallback(async (partnerId: string, bookingId: string | null) => {
    if (!user) return;
    let query = supabase
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`
      );
    query = bookingId === null ? query.is('booking_id', null) : query.eq('booking_id', bookingId);
    const { data } = await query.order('created_at', { ascending: true });

    if (data) {
      // For booking-scoped threads, also pull any messages on the same booking
      // where the other party differs from `partnerId` (e.g. a system row sent
      // by the platform). This keeps the host's view of the thread complete
      // even when sender/receiver drift, while we keep the canonical partner
      // identifiers intact.
      let extra: Message[] = [];
      if (bookingId) {
        const { data: bookingMsgs } = await supabase
          .from('messages')
          .select('*')
          .eq('booking_id', bookingId)
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .order('created_at', { ascending: true });
        extra = (bookingMsgs as Message[] | null) || [];
      }
      const merged = new Map<string, Message>();
      for (const m of [...(data as Message[]), ...extra]) merged.set(m.id, m);
      setMessages(
        Array.from(merged.values()).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      );
      // Mark unread messages as read
      const unreadIds = (data as Message[])
        .filter((m) => m.receiver_id === user.id && !m.is_read)
        .map((m) => m.id);
      if (unreadIds.length > 0) {
        await supabase
          .from('messages')
          .update({ is_read: true, delivery_status: 'read' })
          .in('id', unreadIds);
      }
    }
  }, [user]);

  const handleUnsend = useCallback(async (msg: Message) => {
    if (!user || !canUnsend(msg)) return;
    // Optimistic remove from current view
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', msg.id)
      .eq('sender_id', user.id);
    if (error) {
      toast({ title: t('messages.unsendFailed'), variant: 'destructive' });
      if (selectedConvo) await fetchMessages(selectedConvo.partnerId, selectedConvo.bookingId);
    } else {
      toast({ title: t('messages.unsent') });
      await fetchConversations();
    }
  }, [user, canUnsend, toast, t, selectedConvo, fetchMessages]);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    fetchConversations();
  }, [user, navigate, fetchConversations]);

  // Auto-select host conversation from URL param. Opens the most recent thread
  // with that partner; if none exists, opens a new inquiry thread.
  useEffect(() => {
    const hostId = searchParams.get('host') || searchParams.get('guest');
    if (!hostId || !user || loading) return;
    // Self-routing guard — `/messages?host=<my-own-id>` (e.g. the host clicks
    // "Message Host" on their own listing) would otherwise spawn a thread to
    // self and any reply would never be delivered to a real counter-party.
    if (hostId === user.id) {
      searchParams.delete('host');
      searchParams.delete('guest');
      setSearchParams(searchParams, { replace: true });
      return;
    }
    const convo = conversations.find((c) => c.partnerId === hostId);
    if (convo) {
      selectConversation(convo);
      searchParams.delete('host');
      searchParams.delete('guest');
      setSearchParams(searchParams, { replace: true });
    } else {
      // No existing conversation — create an inquiry placeholder and open it
      const initConvo = async () => {
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_id, full_name, avatar_url, email')
          .eq('user_id', hostId)
          .single();
        if (profile) {
          const newConvo: Conversation = {
            key: `${hostId}__inquiry`,
            partnerId: hostId,
            bookingId: null,
            partner: profile,
            booking: null,
            lastMessage: { id: '', sender_id: user.id, receiver_id: hostId, content: '', created_at: new Date().toISOString(), is_read: false, booking_id: null, delivery_status: 'sent', scheduled_at: null, message_type: 'text' },
            unreadCount: 0,
            hasBooking: false,
          };
          setSelectedConvo(newConvo);
          setMessages([]);
          searchParams.delete('host');
          searchParams.delete('guest');
          setSearchParams(searchParams, { replace: true });
        }
      };
      initConvo();
    }
  }, [searchParams, user, loading, conversations]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('messages-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          // DELETE events carry payload.old instead of payload.new — handle
          // both so unsent messages disappear from the partner's view too.
          const msg = (payload.new || payload.old) as Message;
          if (!msg) return;
          if (payload.eventType === 'DELETE') {
            if (msg.sender_id === user.id || msg.receiver_id === user.id) {
              setMessages((prev) => prev.filter((m) => m.id !== msg.id));
              fetchConversations();
            }
            return;
          }
          // If message involves current user
          if (msg.sender_id === user.id || msg.receiver_id === user.id) {
            // Always refresh the conversation list (sidebar previews / unread).
            fetchConversations();
            if (selectedConvo) {
              const partnerId = selectedConvo.partnerId;
              const sameThread =
                (msg.sender_id === partnerId || msg.receiver_id === partnerId) &&
                (selectedConvo.bookingId === msg.booking_id);
              if (sameThread) {
                if (payload.eventType === 'INSERT') {
                  // Optimistic append — instant render, no extra round-trip.
                  setMessages((prev) =>
                    prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
                  );
                  // Mark as read inline if I'm the receiver.
                  if (msg.receiver_id === user.id && !msg.is_read) {
                    supabase
                      .from('messages')
                      .update({ is_read: true })
                      .eq('id', msg.id)
                      .then(() => {});
                  }
                } else {
                  // UPDATE / DELETE → refetch to stay accurate.
                  fetchMessages(partnerId, selectedConvo.bookingId);
                }
              }
            }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, selectedConvo, fetchConversations, fetchMessages]);

  // Typing indicator channel
  useEffect(() => {
    if (!user || !selectedConvo) {
      setIsPartnerTyping(false);
      return;
    }
    const ids = [user.id, selectedConvo.partnerId].sort();
    const channelName = `typing-${ids[0]}-${ids[1]}`;
    
    const channel = supabase.channel(channelName)
      .on('broadcast', { event: 'typing' }, (payload: any) => {
        if (payload.payload?.user_id === selectedConvo.partnerId) {
          setIsPartnerTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setIsPartnerTyping(false), 3000);
        }
      })
      .subscribe();
    
    typingChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [user, selectedConvo?.partnerId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-translate: whenever messages change (or the active language /
  // toggle changes), translate any incoming messages that don't yet have a
  // cached translation. We skip my own messages, system/flagged messages,
  // and anything already cached. Errors are stored as 'error' so we don't
  // retry in a tight loop.
  useEffect(() => {
    if (!autoTranslate || !user) return;
    const pending = messages.filter((m) =>
      m.sender_id !== user.id
      && m.content?.trim()
      && m.message_type !== 'flagged_contact'
      && m.message_type !== 'system'
      && translations[m.id] === undefined,
    );
    if (pending.length === 0) return;
    pending.forEach((m) => { handleTranslate(m); });
  }, [messages, autoTranslate, targetLang, user, handleTranslate, translations]);

  const broadcastTyping = useCallback(() => {
    if (!user || !typingChannelRef.current) return;
    typingChannelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: user.id },
    });
  }, [user]);

  const selectConversation = async (convo: Conversation) => {
    setSelectedConvo(convo);
    // Closed-state is derived from THIS conversation's booking only.
    const bookingStatus = convo.booking?.status ?? null;
    if (bookingStatus && ['cancelled', 'rejected', 'completed'].includes(bookingStatus)) {
      setConversationClosed({ closed: true, status: bookingStatus });
    } else {
      setConversationClosed({ closed: false, status: null });
    }
    await fetchMessages(convo.partnerId, convo.bookingId);
    // Mark delivered messages from this partner as delivered
    if (user) {
      await supabase
        .from('messages')
        .update({ delivery_status: 'delivered' })
        .eq('sender_id', convo.partnerId)
        .eq('receiver_id', user.id)
        .eq('delivery_status', 'sent');
    }
  };

  const handleSend = async (content?: string, scheduled?: boolean) => {
    if (!user || !selectedConvo) return;
    // Guard against the URL-init flow accidentally pointing the thread at the
    // current user (e.g. someone navigates to /messages?host=<self-id>).
    // Without this we'd insert sender_id == receiver_id rows that never
    // reach the intended counter-party.
    if (selectedConvo.partnerId === user.id) {
      toast({
        title: 'Cannot message yourself',
        description: 'Open this conversation from the booking on the other account.',
        variant: 'destructive',
      });
      return;
    }
    if (conversationClosed.closed) {
      toast({ title: 'Conversation closed', description: 'You can no longer send messages — the booking is no longer active.', variant: 'destructive' });
      return;
    }
    // Admin control: messaging_before_booking. When disabled, guests cannot
    // initiate or continue inquiry threads (no booking attached). Active
    // conversations tied to a confirmed/pending booking remain open.
    if (
      !selectedConvo.bookingId
      && platformControls.guest_rights.messaging_before_booking === false
    ) {
      toast({
        title: 'Pre-booking messaging is disabled',
        description: 'The platform currently requires a confirmed booking before guests and hosts can chat.',
        variant: 'destructive',
      });
      return;
    }
    const text = content || newMessage.trim();
    if (!text) return;

    // Detect contact-info sharing using shared helper (digits, words, emails, urls, handles)
    const detection = detectContactInfo(text);
    const containsContactInfo = detection.detected;

    if (containsContactInfo) {
      toast({
        title: '⚠️ Contact info detected',
        description: `Sharing ${detection.reasons.join(', ')} is against our policy. Repeated attempts may get you removed from the platform. Your message has been hidden from the recipient.`,
        variant: 'destructive',
      });
    }

    setSending(true);
    let scheduledAt: string | null = null;
    if (scheduled && scheduleDate && scheduleTime) {
      scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
    }

    const { data: insertedMsg, error } = await supabase.from('messages').insert({
      sender_id: user.id,
      receiver_id: selectedConvo.partnerId,
      content: text,
      booking_id: selectedConvo.bookingId,
      delivery_status: 'sent',
      message_type: containsContactInfo
        ? 'flagged_contact'
        : scheduled ? 'scheduled' : content ? 'quick_reply' : 'text',
      scheduled_at: scheduledAt,
    }).select('id').maybeSingle();

    if (error) {
      toast({ title: t('messages.sendFailed'), variant: 'destructive' });
    } else {
      // Notify the recipient (in-app bell). Skip when the message was hidden
      // for policy reasons or scheduled for later delivery.
      if (!containsContactInfo && !scheduled) {
        const senderName =
          profilesCache[user.id]?.full_name ||
          user.user_metadata?.full_name ||
          user.email?.split('@')[0] ||
          'Someone';
        const preview = text.length > 120 ? `${text.slice(0, 117)}…` : text;
        try {
          await dispatchNotification({
            userId: selectedConvo.partnerId,
            eventType: 'new_message',
            role: 'user',
            channels: ['in_app'],
            subject: `New message from ${senderName}`,
            body: preview,
            relatedEntityType: 'message',
            relatedEntityId: insertedMsg?.id,
            metadata: {
              sender_id: user.id,
              booking_id: selectedConvo.bookingId,
            },
          });
        } catch (err) {
          console.error('[messages] notify recipient failed', err);
        }
      }
      // After flagging, check repeat-offender count and audit-log if threshold reached
      if (containsContactInfo) {
        // Run the official 3-strike enforcement (warn → block → suspend)
        try {
          const strike = await checkAndRecordStrike({
            userId: user.id,
            content: text,
            settings: tsSettings,
          });
          if (strike.action === 'warn') {
            await dispatchNotification({
              userId: user.id,
              eventType: 'strike_warning',
              role: 'user',
              subject: 'Policy warning',
              body: `We detected ${detection.reasons.join(', ')} in your message. Sharing contact info off-platform is against our policy. This is offence #${strike.offenceNumber}.`,
              relatedEntityType: 'message',
            });
          } else if (strike.action === 'block') {
            await dispatchNotification({
              userId: user.id,
              eventType: 'strike_blocked',
              role: 'user',
              subject: 'Message blocked',
              body: `Your message was blocked (offence #${strike.offenceNumber}). One more violation will suspend your account.`,
              relatedEntityType: 'message',
            });
          } else if (strike.action === 'suspend') {
            await dispatchNotification({
              userId: user.id,
              eventType: 'strike_suspended',
              role: 'user',
              subject: 'Account suspended',
              body: `Your account has been suspended for repeated policy violations (offence #${strike.offenceNumber}). Contact support to appeal.`,
              relatedEntityType: 'user',
            });
            toast({ title: 'Account suspended', description: 'You have been suspended for repeated violations.', variant: 'destructive' });
          }
        } catch (err) {
          console.error('[strikes] enforcement failed', err);
        }

        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('sender_id', user.id)
          .eq('message_type', 'flagged_contact');
        if ((count || 0) >= 3) {
          // Notify admins via audit log — surfaces the user on the moderation queue
          await supabase.from('audit_logs').insert({
            admin_id: user.id, // self-reported violator id (audit_logs.admin_id is the actor field)
            action: 'policy_violation_flagged',
            entity_type: 'user',
            entity_id: user.id,
            details: {
              violation_type: 'contact_info_sharing',
              flagged_count: count,
              reasons: detection.reasons,
              latest_message_excerpt: text.slice(0, 200),
              partner_id: selectedConvo.partnerId,
              booking_id: selectedConvo.bookingId,
            },
          });
        }
      }
      if (scheduled) {
        toast({ title: t('messages.scheduled'), description: t('messages.scheduledDesc') });
        setShowSchedule(false);
        setScheduleDate('');
        setScheduleTime('');
      }
      setNewMessage('');
      setLiveWarning({ show: false, reasons: [] });
      await fetchMessages(selectedConvo.partnerId, selectedConvo.bookingId);
      await fetchConversations();
    }
    setSending(false);
    inputRef.current?.focus();
  };

  // Real-time detection while typing — shows warning popup the moment a phone/email/handle is detected
  const handleInputChange = (value: string) => {
    setNewMessage(value);
    broadcastTyping();
    const detection = detectContactInfo(value);
    setLiveWarning({ show: detection.detected, reasons: detection.reasons });
  };

  const handleQuickReply = (text: string) => {
    setNewMessage(text);
    inputRef.current?.focus();
  };

  // Filter conversations
  const filteredConvos = conversations.filter((c) => {
    const matchesSearch =
      !searchQuery ||
      (c.partner.full_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (filter === 'bookings') return matchesSearch && c.hasBooking;
    if (filter === 'inquiries') return matchesSearch && !c.hasBooking;
    return matchesSearch;
  });

  const bookingsCount = conversations.filter((c) => c.hasBooking).length;
  const inquiriesCount = conversations.filter((c) => !c.hasBooking).length;
  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  // Group messages by date for dividers
  const getDateKey = (dateStr: string) => format(new Date(dateStr), 'yyyy-MM-dd');
  const groupedMessages: { date: string; msgs: Message[] }[] = [];
  let currentDate = '';
  for (const msg of messages) {
    const dk = getDateKey(msg.created_at);
    if (dk !== currentDate) {
      currentDate = dk;
      groupedMessages.push({ date: msg.created_at, msgs: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].msgs.push(msg);
    }
  }

  if (!user) return null;

  return (
    <Layout hideFooter>
      <div className="flex h-[calc(100vh-72px)] overflow-hidden pr-0 md:pr-32 lg:pr-40">
        {/* ===== LEFT SIDEBAR ===== */}
        <div
          className={cn(
            'w-full md:w-[340px] lg:w-[380px] border-r border-border flex flex-col bg-card shrink-0',
            selectedConvo && 'hidden md:flex'
          )}
        >
          {/* Sidebar Header */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-primary-foreground" />
                </div>
                <h1 className="font-display text-lg font-extrabold">{t('messages.title')}</h1>
              </div>
              <button className="w-8 h-8 rounded-full hover:bg-secondary flex items-center justify-center transition-colors">
                <Settings className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('messages.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 rounded-full bg-secondary/50 border-0 h-9 text-sm"
              />
            </div>
            {/* Filter Tabs */}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => setFilter('all')}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
                  filter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                )}
              >
                {t('messages.all')} {totalUnread > 0 && <span className="ml-1">{totalUnread}</span>}
              </button>
              <button
                onClick={() => setFilter('bookings')}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
                  filter === 'bookings'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                )}
              >
                {t('messages.bookingsTab')} {bookingsCount > 0 && <span className="ml-1">{bookingsCount}</span>}
              </button>
              <button
                onClick={() => setFilter('inquiries')}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
                  filter === 'inquiries'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                )}
              >
                {t('messages.inquiriesTab')} {inquiriesCount > 0 && <span className="ml-1">{inquiriesCount}</span>}
              </button>
            </div>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-12 h-12 rounded-full bg-secondary shrink-0" />
                    <div className="flex-1">
                      <div className="h-4 bg-secondary rounded w-2/3 mb-2" />
                      <div className="h-3 bg-secondary rounded w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredConvos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <MessageSquare className="w-12 h-12 text-muted-foreground mb-3" />
                <p className="font-display font-bold text-sm mb-1">{t('messages.noConversations')}</p>
                <p className="text-xs text-muted-foreground">{t('messages.noConversationsDesc')}</p>
              </div>
            ) : (
              filteredConvos.map((convo) => {
                const isActive = selectedConvo?.key === convo.key;
                const isSentByMe = convo.lastMessage.sender_id === user.id;
                const bookingCode = convo.bookingId
                  ? formatBookingId(
                      convo.bookingId,
                      platformSettings?.booking_id_prefix,
                      platformSettings?.booking_id_length
                    )
                  : null;
                const isThreadClosed =
                  convo.booking && ['cancelled', 'rejected', 'completed'].includes(convo.booking.status);
                return (
                  <button
                    key={convo.key}
                    onClick={() => selectConversation(convo)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors border-l-3',
                      isActive
                        ? 'bg-primary/5 border-l-primary'
                        : 'hover:bg-secondary/50 border-l-transparent'
                    )}
                  >
                    <div className="relative shrink-0">
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={convo.partner.avatar_url || ''} />
                        <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                          {(convo.partner.full_name || convo.partner.email)?.[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className={cn('font-display font-bold text-sm truncate', convo.unreadCount > 0 && 'text-foreground')}>
                          {convo.partner.full_name || convo.partner.email}
                        </p>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">
                          {formatMessageTime(convo.lastMessage.created_at)}
                        </span>
                      </div>
                      {/* Booking code / inquiry label */}
                      <div className="flex items-center gap-1.5 mt-0.5 mb-0.5">
                        {bookingCode ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[9px] px-1.5 py-0 h-4 rounded-sm font-mono shrink-0',
                              isThreadClosed && 'opacity-60 line-through'
                            )}
                          >
                            {bookingCode}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 rounded-sm font-bold shrink-0">
                            {t('messages.inquiryBadge')}
                          </Badge>
                        )}
                        {isThreadClosed && (
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
                            · {convo.booking!.status}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <p className={cn('text-xs truncate', convo.unreadCount > 0 ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                          {isSentByMe && `${t('messages.youPrefix')} `}{convo.lastMessage.content}
                        </p>
                      </div>
                    </div>
                    {convo.unreadCount > 0 && (
                      <span className="w-5 h-5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center shrink-0">
                        {convo.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ===== RIGHT CHAT AREA ===== */}
        {selectedConvo ? (
          <div className="flex-1 flex flex-col min-w-0">
            {/* Chat Header */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-card">
              <button
                onClick={() => setSelectedConvo(null)}
                className="md:hidden w-8 h-8 rounded-full hover:bg-secondary flex items-center justify-center"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setProfileDialogOpen(true)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
              >
                <Avatar className="w-10 h-10">
                  <AvatarImage src={selectedConvo.partner.avatar_url || ''} />
                  <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                    {(selectedConvo.partner.full_name || selectedConvo.partner.email)?.[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-bold text-sm truncate">
                    {selectedConvo.partner.full_name || selectedConvo.partner.email}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    {selectedConvo.bookingId ? (
                      <span className="font-mono">
                        {formatBookingId(
                          selectedConvo.bookingId,
                          platformSettings?.booking_id_prefix,
                          platformSettings?.booking_id_length
                        )}
                      </span>
                    ) : (
                      <span>{t('messages.inquiry')}</span>
                    )}
                    {!conversationClosed.closed && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: 'hsl(152, 69%, 53%)' }} />
                        <span>{t('messages.online')}</span>
                      </>
                    )}
                  </p>
                </div>
              </button>
              {/* Auto-translate toggle — when ON, all incoming messages are
                  automatically translated to the active interface language. */}
              <button
                type="button"
                onClick={() => setAutoTranslate((v) => !v)}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                  autoTranslate
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border hover:bg-secondary/50',
                )}
                aria-pressed={autoTranslate}
                title={t('messages.autoTranslateTooltip')}
              >
                <Languages className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {autoTranslate ? t('messages.autoTranslateOn') : t('messages.autoTranslateOff')}
                </span>
              </button>
              {/* Host-only: tick to confirm guest check-in for this booking */}
              {selectedConvo.booking &&
                user?.id === selectedConvo.booking.host_id &&
                ['confirmed', 'completed'].includes(selectedConvo.booking.status) && (
                  <HostCheckInButton
                    bookingId={selectedConvo.booking.id}
                    hostId={selectedConvo.booking.host_id}
                    guestId={selectedConvo.booking.guest_id}
                    alreadyCheckedIn={!!selectedConvo.booking.actual_check_in_at}
                    checkedInAt={selectedConvo.booking.actual_check_in_at}
                    guestName={selectedConvo.partner.full_name}
                    onConfirmed={() => {
                      // Refresh the conversation list so booking meta (actual_check_in_at) updates;
                      // the system message will arrive via the realtime channel.
                      fetchConversations();
                      setSelectedConvo((prev) =>
                        prev && prev.booking
                          ? { ...prev, booking: { ...prev.booking, actual_check_in_at: new Date().toISOString() } }
                          : prev,
                      );
                    }}
                    onUndone={() => {
                      fetchConversations();
                      setSelectedConvo((prev) =>
                        prev && prev.booking
                          ? { ...prev, booking: { ...prev.booking, actual_check_in_at: null } }
                          : prev,
                      );
                    }}
                  />
                )}
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-5 py-4 bg-secondary/20">
              {/* Check-in details exchange — only for confirmed/in-progress bookings */}
              {selectedConvo.booking &&
                ['confirmed', 'in_progress'].includes(selectedConvo.booking.status) && (
                  <div className="mb-4">
                    <CheckInDetailsPanel
                      bookingId={selectedConvo.booking.id}
                      hostId={selectedConvo.booking.host_id}
                      guestId={selectedConvo.booking.guest_id}
                      currentUserId={user.id}
                    />
                  </div>
                )}
              {groupedMessages.map((group) => (
                <div key={group.date}>
                  {/* Date divider */}
                  <div className="flex items-center justify-center my-4">
                    <span className="bg-secondary text-muted-foreground text-[10px] font-medium px-3 py-1 rounded-full">
                      {formatDateDivider(group.date)}
                    </span>
                  </div>
                  {group.msgs.map((msg) => {
                    const isMine = msg.sender_id === user.id;
                    const isScheduled = msg.scheduled_at && new Date(msg.scheduled_at) > new Date();
                    return (
                      <div
                        key={msg.id}
                        className={cn('flex mb-3', isMine ? 'justify-end' : 'justify-start')}
                      >
                        {!isMine && (
                          <Avatar className="w-7 h-7 mr-2 mt-1 shrink-0">
                            <AvatarImage src={selectedConvo.partner.avatar_url || ''} />
                            <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-bold">
                              {(selectedConvo.partner.full_name || '')?.[0]?.toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className={cn('max-w-[70%]')}>
                          <div
                            className={cn(
                              'px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
                              isMine
                                ? 'bg-foreground text-background rounded-br-md'
                                : 'bg-card border border-border text-foreground rounded-bl-md',
                              isScheduled && 'border-2 border-dashed border-primary/40 bg-primary/5'
                            )}
                          >
                            {isScheduled && (
                              <div className="flex items-center gap-1.5 text-primary text-[10px] font-semibold mb-1">
                                <CalendarClock className="w-3 h-3" />
                                {t('messages.scheduledFor', {
                                  date: format(new Date(msg.scheduled_at!), 'MMM d, HH:mm'),
                                })}
                              </div>
                            )}
                            {msg.message_type === 'flagged_contact' && !isMine ? (
                              <p className="whitespace-pre-wrap break-words italic text-muted-foreground text-xs flex items-center gap-1.5">
                                <Lock className="w-3 h-3 shrink-0" />
                                {t('messages.flaggedHidden')}
                              </p>
                            ) : (
                              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                            )}
                            {/* Inline translation — appears below the original
                                text so the user keeps both versions visible.
                                Translation respects the active i18n language and
                                is cached per message; it disappears if the user
                                switches language (handled by the cache reset). */}
                            {translations[msg.id] && translations[msg.id] !== 'loading' && translations[msg.id] !== 'error' && (
                              <div
                                className={cn(
                                  'mt-2 pt-2 border-t text-xs whitespace-pre-wrap break-words',
                                  isMine
                                    ? 'border-background/20 text-background/80'
                                    : 'border-border text-muted-foreground',
                                )}
                              >
                                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider mb-1 opacity-70">
                                  <Languages className="w-3 h-3" />
                                  {t('messages.translatedTo', {
                                    lang: (translations[msg.id] as { lang: string }).lang.toUpperCase(),
                                  })}
                                </div>
                                {(translations[msg.id] as { text: string }).text}
                              </div>
                            )}
                            {msg.message_type === 'flagged_contact' && isMine && (
                              <p className="mt-1.5 pt-1.5 border-t border-background/20 text-[10px] flex items-center gap-1 opacity-80">
                                <AlertTriangle className="w-3 h-3" /> {t('messages.flaggedSelfNote')}
                              </p>
                            )}
                            {/* Host action buttons for guest cancellation / goodwill requests */}
                            {!isMine && msg.message_type === 'system' && msg.booking_id && (
                              msg.content.includes('Cancellation Request') ||
                              /goodwill cancellation request/i.test(msg.content)
                            ) && (
                              <CancellationRequestActions
                                bookingId={msg.booking_id}
                                hostId={user.id}
                                guestId={msg.sender_id}
                                onResolved={() => fetchMessages(selectedConvo.partnerId, selectedConvo.bookingId)}
                              />
                            )}
                          </div>
                          <div className={cn('flex items-center gap-1 mt-1', isMine ? 'justify-end' : 'justify-start')}>
                            {msg.message_type !== 'flagged_contact' && msg.content?.trim() && (
                              <button
                                type="button"
                                onClick={() =>
                                  translations[msg.id] && translations[msg.id] !== 'loading' && translations[msg.id] !== 'error'
                                    ? handleHideTranslation(msg.id)
                                    : handleTranslate(msg)
                                }
                                disabled={translations[msg.id] === 'loading'}
                                className="text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-1 transition-colors"
                                aria-label={t('messages.translate')}
                              >
                                {translations[msg.id] === 'loading' ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Languages className="w-3 h-3" />
                                )}
                                <span>
                                  {translations[msg.id] && translations[msg.id] !== 'loading' && translations[msg.id] !== 'error'
                                    ? t('messages.hideTranslation')
                                    : t('messages.translate')}
                                </span>
                              </button>
                            )}
                            {isMine && canUnsend(msg) && (
                              <button
                                type="button"
                                onClick={() => handleUnsend(msg)}
                                className="text-[10px] text-muted-foreground hover:text-destructive inline-flex items-center gap-1 transition-colors"
                                aria-label={t('messages.undo')}
                                title={t('messages.undoTooltip')}
                              >
                                <Undo2 className="w-3 h-3" />
                                <span>{t('messages.undo')}</span>
                              </button>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {formatChatTime(msg.created_at)}
                            </span>
                            {isMine && <MessageTicks status={msg.delivery_status} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing Indicator */}
            {isPartnerTyping && (
              <div className="px-5 py-2 border-t border-border bg-card">
                <div className="flex items-center gap-2">
                  <Avatar className="w-6 h-6">
                    <AvatarImage src={selectedConvo.partner.avatar_url || ''} />
                    <AvatarFallback className="text-[9px] bg-primary/10 text-primary font-bold">
                      {(selectedConvo.partner.full_name || '')?.[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex items-center gap-1 bg-secondary/50 rounded-full px-3 py-1.5">
                    <div className="flex gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs text-muted-foreground ml-1">
                      {t('messages.userTyping', {
                        name: selectedConvo.partner.full_name?.split(' ')[0] || t('messages.user'),
                      })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Conversation closed banner — replaces input area when booking is cancelled/rejected/completed */}
            {conversationClosed.closed ? null : (
              <>
                {/* Quick Replies */}
                {QUICK_REPLIES.some((qr) => enabledQuickReplies[qr.key as QuickReplyKey] !== false) && (
                  <div className="px-5 py-2 border-t border-border bg-card">
                    <p className="text-[10px] font-semibold text-muted-foreground mb-1.5">{t('messages.quickReplies')}:</p>
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
                      {QUICK_REPLIES.filter((qr) => enabledQuickReplies[qr.key as QuickReplyKey] !== false).map((qr) => (
                        <button
                          key={qr.key}
                          onClick={() => handleQuickReply(qr.text)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card text-xs font-medium text-foreground hover:bg-secondary/50 transition-colors whitespace-nowrap shrink-0"
                        >
                          <qr.icon className="w-3.5 h-3.5 text-muted-foreground" />
                          {t(`messages.quick.${qr.key}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {conversationClosed.closed ? (
              /* Closed conversation banner */
              <div className="px-5 py-5 border-t border-border bg-muted/40">
                <div className="flex items-start gap-3 max-w-2xl mx-auto">
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="font-display font-bold text-sm text-foreground mb-0.5">{t('messages.closedTitle')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('messages.closedDescPrefix')}{' '}
                      <span className="font-semibold text-foreground">{conversationClosed.status}</span>
                      {t('messages.closedDescSuffix')}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* Message Input */
              <div className="px-5 py-3 border-t border-border bg-card">
                {/* LIVE WARNING POPUP — appears the instant a phone/email/handle is typed */}
                {liveWarning.show && (
                  <div className="mb-3 p-3 rounded-xl bg-destructive/10 border-2 border-destructive/40 animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-4 h-4 text-destructive" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-display font-bold text-sm text-destructive mb-0.5">
                          {t('messages.contactWarningTitle')}
                        </p>
                        <p className="text-xs text-foreground/80 leading-relaxed">
                          {t('messages.contactWarningDesc')}
                        </p>
                      </div>
                      <button
                        onClick={() => setLiveWarning({ show: false, reasons: [] })}
                        className="text-destructive/70 hover:text-destructive shrink-0"
                        aria-label="Dismiss warning"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
                {/* Schedule banner */}
                {showSchedule && (
                  <div className="flex items-center gap-2 mb-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
                    <CalendarClock className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        min={format(new Date(), 'yyyy-MM-dd')}
                        className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background"
                      />
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background"
                      />
                    </div>
                    <button onClick={() => setShowSchedule(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <button className="w-8 h-8 rounded-full hover:bg-secondary flex items-center justify-center transition-colors">
                      <Paperclip className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button className="w-8 h-8 rounded-full hover:bg-secondary flex items-center justify-center transition-colors">
                      <Smile className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => setShowSchedule(!showSchedule)}
                      className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center transition-colors',
                        showSchedule ? 'bg-primary/10 text-primary' : 'hover:bg-secondary text-muted-foreground'
                      )}
                    >
                      <CalendarClock className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder={t('messages.inputPlaceholder')}
                    value={newMessage}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (liveWarning.show) return;
                        handleSend(undefined, showSchedule && !!scheduleDate && !!scheduleTime);
                      }
                    }}
                    className="flex-1 bg-secondary/50 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <Button
                    size="icon"
                    onClick={() => handleSend(undefined, showSchedule && !!scheduleDate && !!scheduleTime)}
                    disabled={!newMessage.trim() || sending || liveWarning.show}
                    className="w-10 h-10 rounded-full bg-primary hover:bg-primary/90 shrink-0"
                  >
                    {showSchedule && scheduleDate && scheduleTime ? (
                      <CalendarClock className="w-4 h-4 text-primary-foreground" />
                    ) : (
                      <Send className="w-4 h-4 text-primary-foreground" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* No conversation selected */
          <div className="flex-1 hidden md:flex flex-col items-center justify-center text-center px-8 bg-secondary/10">
            <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <MessageSquare className="w-12 h-12 text-primary" />
            </div>
            <h2 className="font-display text-xl font-extrabold mb-2">{t('messages.selectConvo')}</h2>
            <p className="text-muted-foreground text-sm max-w-md">{t('messages.selectConvoDesc')}</p>
          </div>
        )}
      </div>

      {/* Profile dialog — opens from chat header. Reveals contact only when active. */}
      {selectedConvo && (
        <MessagesProfileDialog
          open={profileDialogOpen}
          onOpenChange={setProfileDialogOpen}
          partnerId={selectedConvo.partnerId}
          isActive={!conversationClosed.closed && selectedConvo.booking?.status === 'confirmed'}
        />
      )}
    </Layout>
  );
}
