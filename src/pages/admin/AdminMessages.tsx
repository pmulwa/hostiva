import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Search, Send, MessageSquare, Mail, Plus, Filter, ShieldCheck,
  Calendar, Users, AlertTriangle, Trash2, Megaphone, X, Check, CheckCheck, Inbox, RefreshCw,
  Paperclip, FileText, Image as ImageIcon, Download, Loader2,
  CircleCheck, CircleSlash, VolumeX, Volume2, Settings as SettingsIcon, ChevronDown,
} from 'lucide-react';
import { encodeAttachment, parseMessageContent, isImageMime, type ParsedAttachment } from '@/lib/messageAttachments';
import { AutoMessagesPanel } from '@/components/admin/AutoMessagesPanel';
import { shouldShowScrollDown } from '@/lib/scrollOverflow';

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
  message_type: string;
};

type Thread = {
  key: string;          // composite: `${a}__${b}__${bookingId|inquiry}` (a<b sorted)
  userA: string;
  userB: string;
  userARole: 'host' | 'guest' | null;
  userBRole: 'host' | 'guest' | null;
  bookingId: string | null;
  profileA: Profile | null;
  profileB: Profile | null;
  lastMessage: Message;
  totalMessages: number;
  unreadCount: number;
  flagged: boolean;
};

type BookingParticipants = {
  id: string;
  host_id: string;
  guest_id: string;
};

function fmtTime(s: string) {
  const d = new Date(s);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  if (isThisYear(d)) return format(d, 'MMM d');
  return format(d, 'MMM d, yyyy');
}
function fmtFull(s: string) {
  return format(new Date(s), 'MMM d, yyyy · HH:mm');
}
function pairKey(a: string, b: string) {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}
function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
function nameOf(p: Profile | null) {
  if (!p) return 'Unknown';
  return p.full_name || p.email || 'Unknown';
}
function initialOf(p: Profile | null) {
  return (p?.full_name || p?.email || 'U')[0]?.toUpperCase() || 'U';
}

function roleLabel(role: 'host' | 'guest' | null) {
  if (!role) return null;
  return role === 'host' ? 'Host' : 'Guest';
}

function participantLabel(profile: Profile | null, role: 'host' | 'guest' | null) {
  const label = roleLabel(role);
  return label ? `${label}: ${nameOf(profile)}` : nameOf(profile);
}

function buildFallbackProfile(userId: string, role: 'host' | 'guest' | null): Profile {
  return {
    user_id: userId,
    full_name: roleLabel(role) || `User ${userId.slice(0, 6)}`,
    avatar_url: null,
    email: '',
  };
}

function parseDisplayMessage(content: string) {
  const parsed = parseMessageContent(content);
  let text = parsed.text.trim();
  let tone: 'default' | 'admin' | 'broadcast' = 'default';
  let label: string | null = null;

  if (/^\[Admin Broadcast\]\s*/i.test(text)) {
    tone = 'broadcast';
    label = 'Broadcast';
    text = text.replace(/^\[Admin Broadcast\]\s*/i, '').trim();
  } else if (/^Broadcast:\s*/i.test(text)) {
    tone = 'broadcast';
    label = 'Broadcast';
    text = text.replace(/^Broadcast:\s*/i, '').trim();
  } else if (/^\[Admin\]\s*/i.test(text)) {
    tone = 'admin';
    label = 'Admin joined';
    text = text.replace(/^\[Admin\]\s*/i, '').trim();
  } else if (/^Admin joined:\s*/i.test(text)) {
    tone = 'admin';
    label = 'Admin joined';
    text = text.replace(/^Admin joined:\s*/i, '').trim();
  }

  return {
    ...parsed,
    text,
    tone,
    label,
  };
}

function formatMessagePreview(content: string) {
  const display = parseDisplayMessage(content);
  if (display.text) {
    return display.label ? `${display.label}: ${display.text}` : display.text;
  }
  if (display.attachments.length > 0) {
    const noun = `${display.attachments.length} attachment${display.attachments.length > 1 ? 's' : ''}`;
    return display.label ? `${display.label}: ${noun}` : noun;
  }
  return display.label ? `${display.label}:` : '';
}

const FLAG_KEYWORDS = [
  'scam', 'fraud', 'refund', 'whatsapp', 'telegram', 'cash', 'bank transfer',
  'cancel', 'lawyer', 'police', 'report you', 'sue', 'fake',
];

function isFlagged(content: string) {
  const lc = content.toLowerCase();
  return FLAG_KEYWORDS.some((k) => lc.includes(k));
}

export default function AdminMessages() {
  const { user } = useAuth();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Settings dialog: scroll-down affordance state
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [showScrollUp, setShowScrollUp] = useState(false);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'flagged' | 'bookings' | 'inquiries' | 'unread'>('all');
  const [selected, setSelected] = useState<Thread | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<'A' | 'B' | 'both'>('A');
  // Pending attachments staged for the next reply send
  const [pendingAttachments, setPendingAttachments] = useState<ParsedAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Lightbox preview
  const [lightbox, setLightbox] = useState<ParsedAttachment | null>(null);

  // Moderation state for the currently-selected thread
  const [threadStateId, setThreadStateId] = useState<string | null>(null);
  const [resolvedAt, setResolvedAt] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState<string>('');
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  // Map of muted user ids → mute row (id, expires_at, reason)
  type MuteRow = { id: string; user_id: string; reason: string | null; expires_at: string | null };
  const [mutes, setMutes] = useState<Record<string, MuteRow>>({});
  const [muteDialogTarget, setMuteDialogTarget] = useState<Profile | null>(null);
  const [muteReason, setMuteReason] = useState('');
  const [muteDuration, setMuteDuration] = useState<'1h' | '24h' | '7d' | 'permanent'>('24h');
  const [muting, setMuting] = useState(false);

  // New conversation
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeSearch, setComposeSearch] = useState('');
  const [composeUsers, setComposeUsers] = useState<Profile[]>([]);
  const [composeSelected, setComposeSelected] = useState<Profile[]>([]);
  const [composeBody, setComposeBody] = useState('');
  const [composeLoading, setComposeLoading] = useState(false);

  // Broadcast
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastAudience, setBroadcastAudience] = useState<'all' | 'hosts' | 'guests'>('all');
  const [broadcasting, setBroadcasting] = useState(false);

  // Messages settings (auto-message templates + toggles)
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Persist the dialog scroll position per user, so reopening lands the
  // viewer where they left off. Keyed by user id so different admins on the
  // same browser don't trample each other's preference.
  const scrollStorageKey = user ? `adminMessages:settingsScroll:${user.id}` : null;
  // Track scroll position inside the Messages-settings dialog so the
  // floating "More messages" button hides once the user reaches the bottom.
  useEffect(() => {
    if (!settingsOpen) {
      setShowScrollDown(false);
      return;
    }
    let raf = 0;
    const attach = () => {
      // Native scroll container — the ref itself is the viewport.
      const vp = settingsScrollRef.current;
      if (!vp) {
        raf = requestAnimationFrame(attach);
        return;
      }
      // Restore previously-saved scroll position for this user.
      if (scrollStorageKey) {
        try {
          const saved = Number(localStorage.getItem(scrollStorageKey) || '0');
          if (Number.isFinite(saved) && saved > 0) {
            // Defer until after the panel has measured its content.
            requestAnimationFrame(() => { vp.scrollTop = saved; });
          }
        } catch { /* ignore quota / parse errors */ }
      }
      const update = () => {
        setShowScrollDown(
          shouldShowScrollDown(vp.scrollHeight, vp.clientHeight, vp.scrollTop),
        );
        setShowScrollUp(vp.scrollTop > 80);
        if (scrollStorageKey) {
          try { localStorage.setItem(scrollStorageKey, String(vp.scrollTop)); } catch { /* ignore */ }
        }
      };
      update();
      vp.addEventListener('scroll', update, { passive: true });
      // Watch both the viewport AND its first child (the actual content
      // wrapper). Watching only the viewport misses the case where the
      // panel asynchronously loads templates and the content grows taller
      // than the viewport — leaving overflow with no scroll affordance.
      const ro = new ResizeObserver(update);
      ro.observe(vp);
      if (vp.firstElementChild) ro.observe(vp.firstElementChild);
      // Re-check shortly after open in case templates stream in.
      const t1 = window.setTimeout(update, 250);
      const t2 = window.setTimeout(update, 1000);
      // Cleanup
      (settingsScrollRef as any).__cleanup = () => {
        vp.removeEventListener('scroll', update);
        ro.disconnect();
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    };
    raf = requestAnimationFrame(attach);
    return () => {
      cancelAnimationFrame(raf);
      (settingsScrollRef as any).__cleanup?.();
    };
  }, [settingsOpen, scrollStorageKey]);

  const loadAllThreads = useCallback(async () => {
    setRefreshing(true);
    // Pull most recent 1000 messages, then group by (pair, booking)
    const { data: msgs, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      toast({ title: 'Failed to load conversations', description: error.message, variant: 'destructive' });
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const all = (msgs as Message[]) || [];
    const userIds = new Set<string>();
    const bookingIds = Array.from(new Set(all.map((m) => m.booking_id).filter(Boolean) as string[]));
    const bookingMap = new Map<string, BookingParticipants>();
    if (bookingIds.length > 0) {
      const { data: bookings } = await supabase
        .from('bookings')
        .select('id, host_id, guest_id')
        .in('id', bookingIds);
      (bookings || []).forEach((booking) => {
        bookingMap.set(booking.id, booking as BookingParticipants);
        userIds.add((booking as BookingParticipants).host_id);
        userIds.add((booking as BookingParticipants).guest_id);
      });
    }

    const groups = new Map<string, { messages: Message[]; userA: string; userB: string; bookingId: string | null; userARole: 'host' | 'guest' | null; userBRole: 'host' | 'guest' | null }>();
    for (const m of all) {
      const booking = m.booking_id ? bookingMap.get(m.booking_id) : null;
      let userA: string;
      let userB: string;
      let userARole: 'host' | 'guest' | null = null;
      let userBRole: 'host' | 'guest' | null = null;

      if (booking) {
        [userA, userB] = sortedPair(booking.host_id, booking.guest_id);
        userARole = userA === booking.host_id ? 'host' : 'guest';
        userBRole = userB === booking.host_id ? 'host' : 'guest';
      } else {
        [userA, userB] = sortedPair(m.sender_id, m.receiver_id);
      }

      const k = `${userA}__${userB}__${m.booking_id ?? 'inquiry'}`;
      if (!groups.has(k)) {
        groups.set(k, {
          messages: [],
          userA,
          userB,
          bookingId: m.booking_id,
          userARole,
          userBRole,
        });
      }
      groups.get(k)!.messages.push(m);
      userIds.add(m.sender_id);
      userIds.add(m.receiver_id);
    }

    // Fetch profiles for all involved users
    const idArr = Array.from(userIds);
    const profMap = new Map<string, Profile>();
    if (idArr.length > 0) {
      // Batch in chunks of 200
      for (let i = 0; i < idArr.length; i += 200) {
        const chunk = idArr.slice(i, i + 200);
        const { data: ps } = await supabase
          .from('profiles')
          .select('user_id, full_name, avatar_url, email')
          .in('user_id', chunk);
        (ps || []).forEach((p) => profMap.set(p.user_id, p as Profile));
      }
    }
    const profileState: Record<string, Profile> = {};
    profMap.forEach((value, key) => {
      profileState[key] = value;
    });
    setProfilesById(profileState);

    const out: Thread[] = [];
    for (const [k, group] of groups.entries()) {
      group.messages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const last = group.messages[0];
      const flagged = group.messages.some((m) => isFlagged(m.content));
      const unread = group.messages.filter((m) => !m.is_read).length;
      const profileA = profMap.get(group.userA) || buildFallbackProfile(group.userA, group.userARole);
      const profileB = profMap.get(group.userB) || buildFallbackProfile(group.userB, group.userBRole);
      out.push({
        key: k,
        userA: group.userA,
        userB: group.userB,
        userARole: group.userARole,
        userBRole: group.userBRole,
        bookingId: group.bookingId,
        profileA,
        profileB,
        lastMessage: last,
        totalMessages: group.messages.length,
        unreadCount: unread,
        flagged,
      });
    }
    out.sort((a, b) =>
      new Date(b.lastMessage.created_at).getTime() -
      new Date(a.lastMessage.created_at).getTime()
    );
    setThreads(out);
    setLoading(false);
    setRefreshing(false);
  }, [toast]);

  const loadThreadMessages = useCallback(async (t: Thread) => {
    const query = t.bookingId
      ? supabase
          .from('messages')
          .select('*')
          .eq('booking_id', t.bookingId)
          .order('created_at', { ascending: true })
      : supabase
          .from('messages')
          .select('*')
          .or(
            `and(sender_id.eq.${t.userA},receiver_id.eq.${t.userB}),and(sender_id.eq.${t.userB},receiver_id.eq.${t.userA})`,
          )
          .is('booking_id', null)
          .order('created_at', { ascending: true });
    const { data } = await query;
    setThreadMessages((data as Message[]) || []);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  }, []);

  // Load resolution + mute state for the currently selected thread participants
  const loadModerationState = useCallback(async (t: Thread) => {
    const [a, b] = sortedPair(t.userA, t.userB);
    let stateQuery = supabase
      .from('message_thread_states')
      .select('id, resolved_at, resolution_note')
      .eq('user_a', a)
      .eq('user_b', b);
    stateQuery = t.bookingId === null ? stateQuery.is('booking_id', null) : stateQuery.eq('booking_id', t.bookingId);
    const [{ data: stateRow }, { data: muteRows }] = await Promise.all([
      stateQuery.maybeSingle(),
      supabase
        .from('messaging_mutes')
        .select('id, user_id, reason, expires_at')
        .in('user_id', [t.userA, t.userB]),
    ]);
    setThreadStateId((stateRow as any)?.id ?? null);
    setResolvedAt((stateRow as any)?.resolved_at ?? null);
    setResolutionNote((stateRow as any)?.resolution_note ?? '');
    const map: Record<string, MuteRow> = {};
    for (const m of (muteRows || []) as MuteRow[]) {
      // Only treat as muted if not expired
      if (!m.expires_at || new Date(m.expires_at) > new Date()) {
        map[m.user_id] = m;
      }
    }
    setMutes(map);
  }, []);

  useEffect(() => {
    if (selected) loadModerationState(selected);
    else { setThreadStateId(null); setResolvedAt(null); setResolutionNote(''); setMutes({}); }
  }, [selected, loadModerationState]);

  useEffect(() => {
    loadAllThreads();
  }, [loadAllThreads]);

  // Realtime — refresh inbox / open thread on any message activity
  useEffect(() => {
    const ch = supabase
      .channel('admin-messages-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        loadAllThreads();
        if (selected) loadThreadMessages(selected);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selected, loadAllThreads, loadThreadMessages]);

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads.filter((t) => {
      if (filter === 'flagged' && !t.flagged) return false;
      if (filter === 'bookings' && !t.bookingId) return false;
      if (filter === 'inquiries' && t.bookingId) return false;
      if (filter === 'unread' && t.unreadCount === 0) return false;
      if (!q) return true;
      const a = nameOf(t.profileA).toLowerCase();
      const b = nameOf(t.profileB).toLowerCase();
      const ea = (t.profileA?.email || '').toLowerCase();
      const eb = (t.profileB?.email || '').toLowerCase();
      const last = t.lastMessage.content.toLowerCase();
      return a.includes(q) || b.includes(q) || ea.includes(q) || eb.includes(q) || last.includes(q);
    });
  }, [threads, search, filter]);

  const sendReply = async () => {
    if (!user || !selected) return;
    const hasText = reply.trim().length > 0;
    const hasAttachments = pendingAttachments.length > 0;
    if (!hasText && !hasAttachments) return;
    setSending(true);
    const targets: string[] = [];
    if (replyTarget === 'A' || replyTarget === 'both') targets.push(selected.userA);
    if (replyTarget === 'B' || replyTarget === 'both') targets.push(selected.userB);
    // Build content: prefix with [Admin] tag, then message text, then any
    // attachment markers so the inbox renderer can extract them later.
    const baseText = hasText ? `Admin joined: ${reply.trim()}` : 'Admin joined:';
    const attachmentMarkers = pendingAttachments.map(encodeAttachment).join(' ');
    const content = hasAttachments ? `${baseText}\n${attachmentMarkers}` : baseText;
    const rows = targets.map((rid) => ({
      sender_id: user.id,
      receiver_id: rid,
      content,
      booking_id: selected.bookingId,
      message_type: hasAttachments ? 'attachment' : 'text',
      delivery_status: 'sent',
    }));
    const { error } = await supabase.from('messages').insert(rows);
    setSending(false);
    if (error) {
      toast({ title: 'Failed to send', description: error.message, variant: 'destructive' });
      return;
    }
    setReply('');
    setPendingAttachments([]);
    toast({ title: 'Reply sent', description: `Delivered to ${targets.length} recipient(s).` });
    loadThreadMessages(selected);
    loadAllThreads();
  };

  // ===== Attachment upload =====
  const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
  const handleAttachmentSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !user) return;
    setUploadingAttachment(true);
    const newlyUploaded: ParsedAttachment[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds the 10 MB limit and was skipped.`,
          variant: 'destructive',
        });
        continue;
      }
      // Sanitise filename so the storage path can't contain unsafe chars
      const safeName = file.name.replace(/[^\w.\-]/g, '_').slice(0, 120) || 'file';
      const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('message-attachments')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'application/octet-stream',
        });
      if (upErr) {
        toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' });
        continue;
      }
      const { data: pub } = supabase.storage.from('message-attachments').getPublicUrl(path);
      newlyUploaded.push({
        url: pub.publicUrl,
        name: file.name,
        mime: file.type || 'application/octet-stream',
      });
    }
    setPendingAttachments((prev) => [...prev, ...newlyUploaded]);
    setUploadingAttachment(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const markThreadRead = async () => {
    if (!selected) return;
    const ids = threadMessages.filter((m) => !m.is_read).map((m) => m.id);
    if (ids.length === 0) return;
    await supabase
      .from('messages')
      .update({ is_read: true, delivery_status: 'read' })
      .in('id', ids);
    toast({ title: 'Marked as read', description: `${ids.length} message(s) updated.` });
    loadThreadMessages(selected);
    loadAllThreads();
  };

  // ===== Resolve / reopen a thread =====
  const toggleResolve = async (note?: string) => {
    if (!user || !selected) return;
    setResolving(true);
    const [a, b] = sortedPair(selected.userA, selected.userB);
    if (resolvedAt) {
      const target = supabase.from('message_thread_states').update({
        resolved_at: null,
        resolved_by: null,
        resolution_note: null,
      });
      const { error } = threadStateId
        ? await target.eq('id', threadStateId)
        : await (selected.bookingId
            ? target.eq('user_a', a).eq('user_b', b).eq('booking_id', selected.bookingId)
            : target.eq('user_a', a).eq('user_b', b).is('booking_id', null));
      setResolving(false);
      if (error) {
        toast({ title: 'Failed to reopen', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Thread reopened' });
      if (selected) loadModerationState(selected);
      setResolvedAt(null);
      setResolutionNote('');
    } else {
      const payload = {
        user_a: a,
        user_b: b,
        booking_id: selected.bookingId,
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        resolution_note: note || null,
      };
      const { error } = threadStateId
        ? await supabase.from('message_thread_states').update(payload).eq('id', threadStateId)
        : await supabase.from('message_thread_states').insert(payload);
      setResolving(false);
      if (error) {
        toast({ title: 'Failed to mark resolved', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Thread marked resolved' });
      if (selected) loadModerationState(selected);
      setResolvedAt(payload.resolved_at);
      setResolutionNote(note || '');
      setResolveDialogOpen(false);
    }
  };

  // ===== Mute / unmute a participant =====
  const muteUser = async () => {
    if (!user || !muteDialogTarget) return;
    setMuting(true);
    let expiresAt: string | null = null;
    const now = Date.now();
    if (muteDuration === '1h') expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
    else if (muteDuration === '24h') expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    else if (muteDuration === '7d') expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from('messaging_mutes')
      .upsert(
        {
          user_id: muteDialogTarget.user_id,
          muted_by: user.id,
          reason: muteReason.trim() || null,
          expires_at: expiresAt,
        },
        { onConflict: 'user_id' as any },
      );
    setMuting(false);
    if (error) {
      toast({ title: 'Failed to mute', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `${nameOf(muteDialogTarget)} muted`, description: expiresAt ? `Until ${fmtFull(expiresAt)}` : 'Permanently' });
    setMuteDialogTarget(null);
    setMuteReason('');
    setMuteDuration('24h');
    if (selected) loadModerationState(selected);
  };

  const unmuteUser = async (target: Profile) => {
    const row = mutes[target.user_id];
    if (!row) return;
    const { error } = await supabase.from('messaging_mutes').delete().eq('id', row.id);
    if (error) {
      toast({ title: 'Failed to unmute', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `${nameOf(target)} unmuted` });
    if (selected) loadModerationState(selected);
  };

  // ===== Compose new conversation =====
  useEffect(() => {
    let cancelled = false;
    if (!composeOpen) return;
    const q = composeSearch.trim();
    (async () => {
      let req = supabase
        .from('profiles')
        .select('user_id, full_name, avatar_url, email')
        .order('created_at', { ascending: false })
        .limit(20);
      if (q.length >= 2) {
        req = req.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
      }
      const { data } = await req;
      if (!cancelled) setComposeUsers((data as Profile[]) || []);
    })();
    return () => { cancelled = true; };
  }, [composeSearch, composeOpen]);

  const sendCompose = async () => {
    if (!user || composeSelected.length === 0 || !composeBody.trim()) return;
    setComposeLoading(true);
    const rows = composeSelected.map((p) => ({
      sender_id: user.id,
      receiver_id: p.user_id,
        content: `Admin joined: ${composeBody.trim()}`,
      message_type: 'text',
      delivery_status: 'sent',
    }));
    const { error } = await supabase.from('messages').insert(rows);
    setComposeLoading(false);
    if (error) {
      toast({ title: 'Failed to send', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Message sent', description: `Sent to ${rows.length} user(s).` });
    setComposeOpen(false);
    setComposeBody('');
    setComposeSelected([]);
    setComposeSearch('');
    loadAllThreads();
  };

  // ===== Broadcast =====
  const sendBroadcast = async () => {
    if (!user || !broadcastBody.trim()) return;
    setBroadcasting(true);
    // Determine recipient set
    let recipientIds: string[] = [];
    if (broadcastAudience === 'all') {
      const { data } = await supabase.from('profiles').select('user_id');
      recipientIds = (data || []).map((d: any) => d.user_id);
    } else {
      // hosts / guests by user_roles
      const targetRole = broadcastAudience === 'hosts' ? 'host' : 'guest';
      const { data } = await supabase.from('user_roles').select('user_id').eq('role', targetRole as any);
      recipientIds = Array.from(new Set((data || []).map((d: any) => d.user_id)));
    }
    recipientIds = recipientIds.filter((id) => id !== user.id);
    if (recipientIds.length === 0) {
      setBroadcasting(false);
      toast({ title: 'No recipients found', variant: 'destructive' });
      return;
    }
    // Insert in batches of 500
    let sent = 0;
    for (let i = 0; i < recipientIds.length; i += 500) {
      const chunk = recipientIds.slice(i, i + 500);
      const rows = chunk.map((rid) => ({
        sender_id: user.id,
        receiver_id: rid,
        content: `Broadcast: ${broadcastBody.trim()}`,
        message_type: 'text',
        delivery_status: 'sent',
      }));
      const { error } = await supabase.from('messages').insert(rows);
      if (!error) sent += chunk.length;
    }
    setBroadcasting(false);
    toast({ title: 'Broadcast sent', description: `Delivered to ${sent} user(s).` });
    setBroadcastOpen(false);
    setBroadcastBody('');
    loadAllThreads();
  };

  // ===== Stats =====
  const stats = useMemo(() => {
    const totalThreads = threads.length;
    const totalMessages = threads.reduce((s, t) => s + t.totalMessages, 0);
    const flagged = threads.filter((t) => t.flagged).length;
    const unread = threads.filter((t) => t.unreadCount > 0).length;
    return { totalThreads, totalMessages, flagged, unread };
  }, [threads]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-primary" />
              Messaging Center
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor conversations, reply on behalf of the platform, and broadcast announcements.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadAllThreads} disabled={refreshing}>
              <RefreshCw className={cn('w-4 h-4 mr-1.5', refreshing && 'animate-spin')} />
              Refresh
            </Button>
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <SettingsIcon className="w-4 h-4 mr-1.5" /> Settings
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl h-[85vh] max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <SettingsIcon className="w-5 h-5 text-primary" /> Messages settings
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground">
                    Every automated message the platform sends, with its template and an enable/disable toggle.
                  </p>
                </DialogHeader>
                <div className="relative flex-1 min-h-0">
                  {/* Native scroll container — Radix ScrollArea was occasionally
                      failing to size against the dialog flex parent on first
                      open, leaving overflowing message cards unreachable. A
                      plain overflow-y-auto div always honours the parent
                      flex-1 + min-h-0 sizing. */}
                  <div
                    ref={settingsScrollRef}
                    className="h-full overflow-y-scroll overscroll-contain pr-3 [scrollbar-gutter:stable]"
                  >
                    <AutoMessagesPanel />
                  </div>
                  {/* Floating scroll-up button — appears once the user has
                      scrolled past the top so they can quickly jump back. */}
                  {showScrollUp && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const vp = settingsScrollRef.current;
                        if (vp) vp.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="absolute top-3 right-3 shadow-md rounded-full h-9 px-3 gap-1.5 z-10"
                      aria-label="Scroll back to the top"
                    >
                      <ChevronDown className="w-4 h-4 rotate-180" />
                      Top
                    </Button>
                  )}
                  {/* Floating scroll-down button — reveals message templates
                      hidden below the visible viewport. Hidden once scrolled
                      near the bottom. */}
                  {showScrollDown && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const vp = settingsScrollRef.current;
                        if (vp) vp.scrollBy({ top: vp.clientHeight * 0.85, behavior: 'smooth' });
                      }}
                      className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md rounded-full h-9 px-3 gap-1.5 z-10"
                      aria-label="Scroll to see more messages"
                    >
                      <ChevronDown className="w-4 h-4" />
                      More messages
                    </Button>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="secondary">
                  <Plus className="w-4 h-4 mr-1.5" /> New Conversation
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>New conversation</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <Input
                    placeholder="Search users by name or email…"
                    value={composeSearch}
                    onChange={(e) => setComposeSearch(e.target.value)}
                  />
                  {composeSelected.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {composeSelected.map((p) => (
                        <Badge key={p.user_id} variant="secondary" className="gap-1">
                          {nameOf(p)}
                          <button onClick={() => setComposeSelected((s) => s.filter((x) => x.user_id !== p.user_id))}>
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <ScrollArea className="h-56 border rounded-lg">
                    {composeUsers.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">No users found</div>
                    ) : (
                      <div className="divide-y">
                        {composeUsers.map((p) => {
                          const picked = composeSelected.some((s) => s.user_id === p.user_id);
                          return (
                            <button
                              key={p.user_id}
                              onClick={() => {
                                if (picked) setComposeSelected((s) => s.filter((x) => x.user_id !== p.user_id));
                                else setComposeSelected((s) => [...s, p]);
                              }}
                              className={cn(
                                'w-full flex items-center gap-3 p-2.5 text-left hover:bg-muted/40 transition',
                                picked && 'bg-primary/5',
                              )}
                            >
                              <Avatar className="w-8 h-8">
                                <AvatarImage src={p.avatar_url || ''} />
                                <AvatarFallback>{initialOf(p)}</AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{nameOf(p)}</p>
                                <p className="text-[11px] text-muted-foreground truncate">{p.email}</p>
                              </div>
                              {picked && <Check className="w-4 h-4 text-primary" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                  <textarea
                    className="w-full min-h-[100px] rounded-lg border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Write your message…"
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
                    <Button
                      onClick={sendCompose}
                      disabled={composeLoading || composeSelected.length === 0 || !composeBody.trim()}
                    >
                      <Send className="w-4 h-4 mr-1.5" />
                      Send to {composeSelected.length || 0}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={broadcastOpen} onOpenChange={setBroadcastOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Megaphone className="w-4 h-4 mr-1.5" /> Broadcast
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Send broadcast</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium mb-1.5">Audience</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(['all', 'hosts', 'guests'] as const).map((a) => (
                        <button
                          key={a}
                          onClick={() => setBroadcastAudience(a)}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-xs font-medium capitalize transition',
                            broadcastAudience === a
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-border hover:bg-muted/40',
                          )}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    className="w-full min-h-[120px] rounded-lg border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Announcement message…"
                    value={broadcastBody}
                    onChange={(e) => setBroadcastBody(e.target.value)}
                  />
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Every recipient will see this message in their inbox prefixed with Broadcast:.
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setBroadcastOpen(false)}>Cancel</Button>
                    <Button onClick={sendBroadcast} disabled={broadcasting || !broadcastBody.trim()}>
                      <Megaphone className="w-4 h-4 mr-1.5" />
                      {broadcasting ? 'Sending…' : 'Send broadcast'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total threads', value: stats.totalThreads, icon: MessageSquare },
            { label: 'Total messages', value: stats.totalMessages, icon: Mail },
            { label: 'Flagged', value: stats.flagged, icon: AlertTriangle, accent: 'text-amber-600' },
            { label: 'With unread', value: stats.unread, icon: Inbox, accent: 'text-primary' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{s.label}</p>
                <s.icon className={cn('w-4 h-4 text-muted-foreground', s.accent)} />
              </div>
              <p className="font-display text-2xl font-bold mt-2">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Main split layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 min-h-[640px]">
          {/* Left — thread list */}
          <div className="rounded-xl border bg-card flex flex-col overflow-hidden">
            <div className="p-3 space-y-3 border-b">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by name, email, or message…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
                <TabsList className="grid grid-cols-5 w-full h-auto">
                  <TabsTrigger value="all" className="text-[11px] px-1.5 py-1.5">All</TabsTrigger>
                  <TabsTrigger value="unread" className="text-[11px] px-1.5 py-1.5">Unread</TabsTrigger>
                  <TabsTrigger value="flagged" className="text-[11px] px-1.5 py-1.5">Flagged</TabsTrigger>
                  <TabsTrigger value="bookings" className="text-[11px] px-1.5 py-1.5">Booking</TabsTrigger>
                  <TabsTrigger value="inquiries" className="text-[11px] px-1.5 py-1.5">Inquiry</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-6 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
                      <div className="flex-1 space-y-1">
                        <div className="h-3 bg-muted rounded w-2/3 animate-pulse" />
                        <div className="h-2 bg-muted rounded w-1/2 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredThreads.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-10 text-sm text-muted-foreground">
                  <Inbox className="w-8 h-8 mb-2 opacity-50" />
                  No conversations match your filter.
                </div>
              ) : (
                <ul className="divide-y">
                  {filteredThreads.map((t) => {
                    const isSel = selected?.key === t.key;
                    return (
                      <li key={t.key}>
                        <button
                          onClick={() => { setSelected(t); loadThreadMessages(t); }}
                          className={cn(
                            'w-full text-left p-3 flex gap-3 hover:bg-muted/40 transition',
                            isSel && 'bg-primary/5',
                          )}
                        >
                          <div className="relative shrink-0">
                            <Avatar className="w-10 h-10">
                              <AvatarImage src={t.profileA?.avatar_url || ''} />
                              <AvatarFallback>{initialOf(t.profileA)}</AvatarFallback>
                            </Avatar>
                            <Avatar className="w-6 h-6 absolute -bottom-1 -right-1 ring-2 ring-card">
                              <AvatarImage src={t.profileB?.avatar_url || ''} />
                              <AvatarFallback className="text-[10px]">{initialOf(t.profileB)}</AvatarFallback>
                            </Avatar>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold truncate">
                                {participantLabel(t.profileA, t.userARole)} <span className="text-muted-foreground font-normal">↔</span> {participantLabel(t.profileB, t.userBRole)}
                              </p>
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {fmtTime(t.lastMessage.created_at)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {formatMessagePreview(t.lastMessage.content)}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1.5">
                              {t.bookingId ? (
                                <Badge variant="outline" className="h-4 text-[9px] px-1 gap-0.5">
                                  <Calendar className="w-2.5 h-2.5" /> Booking
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="h-4 text-[9px] px-1">Inquiry</Badge>
                              )}
                              {t.flagged && (
                                <Badge variant="destructive" className="h-4 text-[9px] px-1 gap-0.5">
                                  <AlertTriangle className="w-2.5 h-2.5" /> Flag
                                </Badge>
                              )}
                              {t.unreadCount > 0 && (
                                <Badge className="h-4 text-[9px] px-1.5">{t.unreadCount}</Badge>
                              )}
                              <span className="text-[9px] text-muted-foreground ml-auto">
                                {t.totalMessages} msgs
                              </span>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Right — thread viewer */}
          <div className="rounded-xl border bg-card flex flex-col overflow-hidden min-h-[640px]">
            {!selected ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-10 text-muted-foreground">
                <Users className="w-10 h-10 mb-3 opacity-50" />
                <p className="font-semibold text-foreground mb-1">Select a conversation</p>
                <p className="text-sm">Pick a thread on the left to view the full transcript and reply on behalf of the platform.</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="border-b p-4 flex flex-wrap items-center gap-3">
                  <div className="flex -space-x-2">
                    <Avatar className="w-9 h-9 ring-2 ring-card">
                      <AvatarImage src={selected.profileA?.avatar_url || ''} />
                      <AvatarFallback>{initialOf(selected.profileA)}</AvatarFallback>
                    </Avatar>
                    <Avatar className="w-9 h-9 ring-2 ring-card">
                      <AvatarImage src={selected.profileB?.avatar_url || ''} />
                      <AvatarFallback>{initialOf(selected.profileB)}</AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {participantLabel(selected.profileA, selected.userARole)} ↔ {participantLabel(selected.profileB, selected.userBRole)}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {(selected.profileA?.email || '—')} · {(selected.profileB?.email || '—')}
                      {selected.bookingId && (
                        <> · Booking <span className="font-mono">{selected.bookingId.slice(0, 8)}…</span></>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={markThreadRead}>
                          <CheckCheck className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Mark all as read</TooltipContent>
                    </Tooltip>
                    {/* Mute / unmute controls — one per participant */}
                    {[
                      { profile: selected.profileA, role: selected.userARole },
                      { profile: selected.profileB, role: selected.userBRole },
                    ].filter((entry) => entry.profile).map(({ profile: p, role }) => {
                      const muted = !!mutes[p!.user_id];
                      return (
                        <Tooltip key={p!.user_id}>
                          <TooltipTrigger asChild>
                            <Button
                              variant={muted ? 'destructive' : 'ghost'}
                              size="sm"
                              onClick={() => muted ? unmuteUser(p!) : setMuteDialogTarget(p!)}
                            >
                              {muted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {muted
                              ? `Unmute ${participantLabel(p, role)}${mutes[p!.user_id].expires_at ? ` (expires ${fmtFull(mutes[p!.user_id].expires_at!)})` : ''}`
                              : `Mute ${participantLabel(p, role)}`}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                    {/* Resolve / reopen */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={resolvedAt ? 'secondary' : 'default'}
                          size="sm"
                          onClick={() => resolvedAt ? toggleResolve() : setResolveDialogOpen(true)}
                          disabled={resolving}
                        >
                          {resolvedAt ? <CircleSlash className="w-4 h-4 mr-1" /> : <CircleCheck className="w-4 h-4 mr-1" />}
                          {resolvedAt ? 'Reopen' : 'Resolve'}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {resolvedAt ? 'Reopen this thread for further moderation' : 'Mark this thread as resolved'}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                {/* Resolved banner */}
                {resolvedAt && (
                  <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-900 flex items-start gap-2 text-xs text-emerald-800 dark:text-emerald-200">
                    <CircleCheck className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">Thread resolved · {fmtFull(resolvedAt)}</p>
                      {resolutionNote && <p className="opacity-80 mt-0.5">{resolutionNote}</p>}
                    </div>
                  </div>
                )}

                {/* Transcript */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
                  {threadMessages.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground py-10">No messages yet.</p>
                  ) : (
                    threadMessages.map((m) => {
                      const fromA = m.sender_id === selected.userA;
                      const fromB = m.sender_id === selected.userB;
                      const senderProfile = fromA
                        ? selected.profileA
                        : fromB
                          ? selected.profileB
                          : profilesById[m.sender_id] || buildFallbackProfile(m.sender_id, null);
                      const senderRole = fromA ? selected.userARole : fromB ? selected.userBRole : null;
                      const flagged = isFlagged(m.content);
                      const parsed = parseDisplayMessage(m.content);
                      const isAdminMsg = parsed.tone === 'admin' || parsed.tone === 'broadcast';
                      return (
                        <div key={m.id} className={cn('flex gap-2', fromA ? 'justify-start' : 'justify-end')}>
                          {fromA && (
                            <Avatar className="w-7 h-7 mt-0.5">
                              <AvatarImage src={senderProfile?.avatar_url || ''} />
                              <AvatarFallback className="text-[10px]">{initialOf(senderProfile)}</AvatarFallback>
                            </Avatar>
                          )}
                          <div className={cn('max-w-[75%]', !fromA && 'text-right')}>
                            <div className={cn(
                              'inline-block rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words',
                              parsed.tone === 'broadcast'
                                ? 'bg-amber-500/10 border border-amber-500/20 text-foreground'
                                : isAdminMsg
                                  ? 'bg-primary/10 border border-primary/20 text-foreground'
                                : fromA
                                  ? 'bg-card border'
                                  : 'bg-primary text-primary-foreground',
                              flagged && 'ring-2 ring-amber-400',
                            )}>
                              {parsed.label && (
                                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold mb-1 text-primary">
                                  <ShieldCheck className="w-3 h-3" /> {parsed.label}
                                </div>
                              )}
                              {parsed.text && <div>{parsed.text}</div>}
                              {parsed.attachments.length > 0 && (
                                <div className={cn('mt-2 grid gap-2', parsed.text && 'pt-2 border-t border-current/10')}>
                                  {parsed.attachments.map((att, idx) => (
                                    isImageMime(att.mime) ? (
                                      <button
                                        key={idx}
                                        type="button"
                                        onClick={() => setLightbox(att)}
                                        className="block max-w-[260px] rounded-lg overflow-hidden border border-current/10 bg-background/40 hover:opacity-90 transition"
                                      >
                                        <img
                                          src={att.url}
                                          alt={att.name}
                                          className="w-full h-auto object-cover max-h-64"
                                          loading="lazy"
                                        />
                                        <div className="px-2 py-1 text-[10px] truncate text-left flex items-center gap-1">
                                          <ImageIcon className="w-3 h-3 shrink-0" />
                                          <span className="truncate">{att.name}</span>
                                        </div>
                                      </button>
                                    ) : (
                                      <a
                                        key={idx}
                                        href={att.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 rounded-lg border border-current/10 bg-background/40 px-2.5 py-2 text-xs hover:bg-background/70 transition no-underline max-w-[260px]"
                                      >
                                        <FileText className="w-4 h-4 shrink-0" />
                                        <span className="flex-1 truncate font-medium">{att.name}</span>
                                        <Download className="w-3.5 h-3.5 shrink-0 opacity-60" />
                                      </a>
                                    )
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className={cn('text-[10px] text-muted-foreground mt-1 px-1', !fromA && 'text-right')}>
                              {participantLabel(senderProfile, senderRole)} · {fmtFull(m.created_at)} · {m.is_read ? 'read' : m.delivery_status}
                              {flagged && (
                                <span className="ml-1.5 text-amber-600 font-semibold">⚑ flagged term</span>
                              )}
                            </div>
                          </div>
                          {!fromA && (
                            <Avatar className="w-7 h-7 mt-0.5">
                              <AvatarImage src={senderProfile?.avatar_url || ''} />
                              <AvatarFallback className="text-[10px]">{initialOf(senderProfile)}</AvatarFallback>
                            </Avatar>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply composer */}
                <div className="border-t p-3 space-y-2 bg-card">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Reply to:</span>
                    {(['A', 'B', 'both'] as const).map((opt) => {
                      const label =
                        opt === 'A' ? participantLabel(selected.profileA, selected.userARole) :
                        opt === 'B' ? participantLabel(selected.profileB, selected.userBRole) :
                        'Both';
                      return (
                        <button
                          key={opt}
                          onClick={() => setReplyTarget(opt)}
                          className={cn(
                            'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition',
                            replyTarget === opt
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border hover:bg-muted/40',
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {/* Pending attachment chips */}
                  {pendingAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {pendingAttachments.map((att, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 rounded-full border bg-muted/40 pl-1.5 pr-1 py-0.5 text-[11px]"
                        >
                          {isImageMime(att.mime) ? (
                            <img src={att.url} alt="" className="w-5 h-5 rounded-full object-cover" />
                          ) : (
                            <FileText className="w-3.5 h-3.5" />
                          )}
                          <span className="max-w-[140px] truncate">{att.name}</span>
                          <button
                            onClick={() => setPendingAttachments((p) => p.filter((_, idx) => idx !== i))}
                            className="w-4 h-4 rounded-full hover:bg-muted flex items-center justify-center"
                            aria-label="Remove attachment"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 items-end">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,application/pdf,.doc,.docx,.txt,.csv,.xlsx"
                      className="hidden"
                      onChange={handleAttachmentSelect}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAttachment}
                      title="Attach files"
                    >
                      {uploadingAttachment
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Paperclip className="w-4 h-4" />}
                    </Button>
                    <textarea
                      className="flex-1 min-h-[60px] max-h-[180px] rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                      placeholder="Type a reply on behalf of the platform…"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault(); sendReply();
                        }
                      }}
                    />
                    <Button
                      onClick={sendReply}
                      disabled={sending || uploadingAttachment || (!reply.trim() && pendingAttachments.length === 0)}
                    >
                      <Send className="w-4 h-4 mr-1.5" />
                      Send
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Attach images or files (max 10 MB each). Replies are shown as “Admin joined:”. Press ⌘/Ctrl+Enter to send.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Lightbox for image attachments */}
        <Dialog open={!!lightbox} onOpenChange={(o) => { if (!o) setLightbox(null); }}>
          <DialogContent className="max-w-3xl p-0 overflow-hidden bg-background">
            {lightbox && (
              <div className="space-y-0">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <p className="text-sm font-medium truncate flex-1 mr-3">{lightbox.name}</p>
                  <a
                    href={lightbox.url}
                    download={lightbox.name}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs flex items-center gap-1 text-primary hover:underline"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                </div>
                <div className="bg-muted/40 max-h-[75vh] overflow-auto flex items-center justify-center">
                  <img src={lightbox.url} alt={lightbox.name} className="max-w-full max-h-[75vh] object-contain" />
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Resolve thread dialog — collects an optional resolution note */}
        <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CircleCheck className="w-5 h-5 text-emerald-600" />
                Mark thread as resolved
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Add an optional internal note describing what was resolved. Participants don't see this note.
              </p>
              <textarea
                className="w-full min-h-[100px] rounded-lg border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. Refund agreed; guest will not pursue further."
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setResolveDialogOpen(false)}>Cancel</Button>
                <Button onClick={() => toggleResolve(resolutionNote)} disabled={resolving}>
                  <CircleCheck className="w-4 h-4 mr-1.5" />
                  {resolving ? 'Saving…' : 'Mark resolved'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Mute participant dialog */}
        <Dialog open={!!muteDialogTarget} onOpenChange={(o) => { if (!o) { setMuteDialogTarget(null); setMuteReason(''); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <VolumeX className="w-5 h-5 text-destructive" />
                Mute {muteDialogTarget ? nameOf(muteDialogTarget) : 'user'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                The user won't be able to send any messages until the mute expires or is removed.
              </p>
              <div>
                <p className="text-xs font-medium mb-1.5">Duration</p>
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { v: '1h', label: '1 hour' },
                    { v: '24h', label: '24 hours' },
                    { v: '7d', label: '7 days' },
                    { v: 'permanent', label: 'Permanent' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => setMuteDuration(opt.v)}
                      className={cn(
                        'rounded-lg border px-2 py-2 text-xs font-medium transition',
                        muteDuration === opt.v
                          ? 'border-destructive bg-destructive/5 text-destructive'
                          : 'border-border hover:bg-muted/40',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium mb-1.5">Reason (optional)</p>
                <textarea
                  className="w-full min-h-[80px] rounded-lg border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-destructive"
                  placeholder="Internal note for the audit trail"
                  value={muteReason}
                  onChange={(e) => setMuteReason(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setMuteDialogTarget(null); setMuteReason(''); }}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={muteUser} disabled={muting}>
                  <VolumeX className="w-4 h-4 mr-1.5" />
                  {muting ? 'Muting…' : 'Mute user'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}