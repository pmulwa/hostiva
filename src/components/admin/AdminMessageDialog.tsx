import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type Message = Database['public']['Tables']['messages']['Row'];

interface AdminMessageDialogProps {
  open: boolean;
  onClose: () => void;
  recipientId: string | null;
  recipientName: string;
}

/**
 * Realtime chat between an admin and a user.
 * Loads the existing thread and lets the admin reply directly.
 */
export function AdminMessageDialog({ open, onClose, recipientId, recipientName }: AdminMessageDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load thread whenever the dialog opens for a new recipient.
  useEffect(() => {
    if (!open || !recipientId || !user?.id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${user.id},receiver_id.eq.${recipientId}),and(sender_id.eq.${recipientId},receiver_id.eq.${user.id})`,
        )
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) {
        toast({ title: 'Failed to load messages', description: error.message, variant: 'destructive' });
      } else {
        setMessages(data ?? []);
      }
      setLoading(false);
    })();
  }, [open, recipientId, user?.id, toast]);

  // Subscribe to new inbound messages while the dialog is open.
  useEffect(() => {
    if (!open || !recipientId || !user?.id) return;
    const channel = supabase
      .channel(`admin-chat-${recipientId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as Message;
          const isInThread =
            (msg.sender_id === user.id && msg.receiver_id === recipientId) ||
            (msg.sender_id === recipientId && msg.receiver_id === user.id);
          if (isInThread) {
            setMessages((prev) => (prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, recipientId, user?.id]);

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    if (!draft.trim() || !user?.id || !recipientId) return;
    setSending(true);
    const content = draft.trim();
    setDraft('');
    const optimistic: Message = {
      id: `tmp-${Date.now()}`,
      sender_id: user.id,
      receiver_id: recipientId,
      content,
      created_at: new Date().toISOString(),
      booking_id: null,
      delivery_status: 'sent',
      is_read: false,
      message_type: 'text',
      scheduled_at: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    const { data, error } = await supabase
      .from('messages')
      .insert({
        sender_id: user.id,
        receiver_id: recipientId,
        content,
        message_type: 'text',
      })
      .select()
      .single();
    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(content);
      toast({ title: 'Message failed', description: error.message, variant: 'destructive' });
    } else if (data) {
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? (data as Message) : m)));
    }
    setSending(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b">
          <DialogTitle className="font-display flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" /> Message {recipientName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Direct admin → user channel. Both parties see this in their normal inbox.
          </DialogDescription>
        </DialogHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-muted/20 min-h-[280px]">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading thread…
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-12">
              No messages yet — start the conversation below.
            </p>
          ) : (
            messages.map((m) => {
              const mine = m.sender_id === user?.id;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${
                      mine
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-card border border-border rounded-bl-sm'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    <p className={`text-[10px] mt-1 ${mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                      {format(new Date(m.created_at), 'MMM d · h:mm a')}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t px-5 py-3 bg-background">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Write a message…  (Enter to send, Shift+Enter for new line)"
              rows={2}
              className="resize-none text-sm"
              disabled={sending}
            />
            <Button onClick={send} disabled={sending || !draft.trim()} size="icon" className="shrink-0">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}