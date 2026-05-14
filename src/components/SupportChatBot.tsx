import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Send, X, Loader2, Trash2, History, Plus, Mail, ArrowLeft, RotateCcw, Minus } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ConversationRow = { id: string; title: string | null; updated_at: string; messages: ChatMessage[] };

const INITIAL_MESSAGE: ChatMessage = {
  role: "assistant",
  content: "Hi! I'm Hostiva's AI assistant. Ask me about bookings, hosting, refunds, or anything else. For account-specific issues, tap the green WhatsApp button.",
};

const GUEST_KEY = "hostly_chat_guest";

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return `Today, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (sameDay(d, yest)) return `Yesterday, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function SupportChatBot() {
  const { user } = useAuth();
  const location = useLocation();
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [propertyTitle, setPropertyTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);

  // Guest identification (anonymous users)
  const [guestName, setGuestName] = useState<string>("");
  const [guestEmail, setGuestEmail] = useState<string>("");
  const [guestFormName, setGuestFormName] = useState("");
  const [guestFormEmail, setGuestFormEmail] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate guest identity from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(GUEST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.name) setGuestName(parsed.name);
        if (parsed?.email) setGuestEmail(parsed.email);
      }
    } catch { /* ignore */ }
  }, []);

  const identified = useMemo(() => Boolean(user) || (guestName && guestEmail), [user, guestName, guestEmail]);
  const recipientEmail = user?.email ?? guestEmail;
  const recipientName = (user?.user_metadata as { full_name?: string } | undefined)?.full_name || guestName || "there";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  // Detect property page and fetch its title for richer context
  useEffect(() => {
    const match = location.pathname.match(/^\/property\/([0-9a-f-]{36})/i);
    if (!match) {
      setPropertyTitle(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("properties")
      .select("title")
      .eq("id", match[1])
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPropertyTitle(data?.title ?? null);
      });
    return () => { cancelled = true; };
  }, [location.pathname]);

  // Load all conversations + most recent on sign-in
  const loadConversations = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("chat_conversations")
      .select("id, title, updated_at, messages")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (data) setConversations(data as unknown as ConversationRow[]);
  };

  useEffect(() => {
    if (!user || historyLoaded) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("chat_conversations")
        .select("id, title, updated_at, messages")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (data && data.length > 0) {
        setConversations(data as unknown as ConversationRow[]);
        const latest = data[0] as unknown as ConversationRow;
        if (Array.isArray(latest.messages) && latest.messages.length > 0) {
          setConversationId(latest.id);
          setMessages([INITIAL_MESSAGE, ...latest.messages]);
        }
      }
      setHistoryLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user, historyLoaded]);

  // Reset history on sign-out
  useEffect(() => {
    if (!user) {
      setConversationId(null);
      setHistoryLoaded(false);
      setMessages([INITIAL_MESSAGE]);
    }
  }, [user]);

  const persistConversation = async (next: ChatMessage[]) => {
    if (!user) return;
    const persistable = next.filter((m) => m !== INITIAL_MESSAGE);
    const messagesJson = persistable as unknown as never;
    if (conversationId) {
      await supabase
        .from("chat_conversations")
        .update({ messages: messagesJson })
        .eq("id", conversationId);
      // refresh sidebar order
      loadConversations();
    } else {
      const { data } = await supabase
        .from("chat_conversations")
        .insert({
          user_id: user.id,
          messages: messagesJson,
          title: persistable[0]?.content?.slice(0, 80) ?? "New chat",
        } as never)
        .select("id")
        .maybeSingle();
      if (data?.id) setConversationId(data.id);
      loadConversations();
    }
  };

  const clearHistory = async () => {
    await emailTranscriptIfNeeded();
    if (conversationId) {
      await supabase.from("chat_conversations").delete().eq("id", conversationId);
    }
    setConversationId(null);
    setMessages([INITIAL_MESSAGE]);
    loadConversations();
  };

  const startNewChat = async () => {
    await emailTranscriptIfNeeded();
    setConversationId(null);
    setMessages([INITIAL_MESSAGE]);
    setShowHistory(false);
  };

  const openConversation = (c: ConversationRow) => {
    setConversationId(c.id);
    setMessages([INITIAL_MESSAGE, ...(c.messages || [])]);
    setShowHistory(false);
  };

  // Most recent past conversation that isn't the one currently open
  const resumableConversation = useMemo(() => {
    return conversations.find(
      (c) => c.id !== conversationId && Array.isArray(c.messages) && c.messages.length > 0
    ) ?? null;
  }, [conversations, conversationId]);

  const saveGuestIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    const name = guestFormName.trim();
    const email = guestFormEmail.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    setGuestName(name);
    setGuestEmail(email);
    try { localStorage.setItem(GUEST_KEY, JSON.stringify({ name, email })); } catch { /* ignore */ }
  };

  const emailTranscriptIfNeeded = async () => {
    if (!recipientEmail) return;
    const transcript = messages.filter((m) => m !== INITIAL_MESSAGE);
    if (transcript.length === 0) return;
    try {
      await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "chat-transcript",
          recipientEmail,
          idempotencyKey: `chat-transcript-${conversationId ?? Date.now()}`,
          templateData: {
            name: recipientName,
            messages: transcript,
            startedAt: new Date().toISOString(),
          },
        },
      });
    } catch (err) {
      // Email infra may not be configured yet — fail silently
      console.warn("Transcript email skipped:", err);
    }
  };

  const handleClose = async () => {
    await emailTranscriptIfNeeded();
    setOpen(false);
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("support-chat", {
        body: {
          messages: next.filter((m) => m !== INITIAL_MESSAGE),
          context: {
            path: location.pathname,
            propertyTitle,
            userId: user?.id ?? null,
          },
          language: i18n.language?.split("-")[0] ?? "en",
        },
      });
      if (error) throw error;
      const reply = data?.reply ?? "Sorry, something went wrong. Please try WhatsApp for urgent help.";
      const updated: ChatMessage[] = [...next, { role: "assistant", content: reply }];
      setMessages(updated);
      persistConversation(updated);
    } catch (err) {
      console.error("Chat error:", err);
      const updated: ChatMessage[] = [
        ...next,
        { role: "assistant", content: "I'm having trouble right now. Please tap the green WhatsApp button to reach a human agent." },
      ];
      setMessages(updated);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Launcher */}
      {(!open || minimized) && (
        <button
          type="button"
          onClick={() => { setOpen(true); setMinimized(false); }}
          aria-label="Open live chat assistant"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-all duration-300 px-4 py-3 hover:scale-105"
        >
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-foreground opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-primary-foreground"></span>
          </span>
          <Bot className="w-5 h-5" />
          <span className="hidden sm:inline text-sm font-semibold">Live chat</span>
        </button>
      )}

      {/* Panel */}
      {open && !minimized && (
        <div className="fixed bottom-5 right-5 z-50 w-[calc(100vw-2.5rem)] sm:w-[22rem] h-[32rem] max-h-[calc(100vh-2.5rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground">
            <div className="flex items-center gap-2 min-w-0">
              {showHistory ? (
                <button
                  type="button"
                  onClick={() => setShowHistory(false)}
                  aria-label="Back to chat"
                  className="p-1 rounded-full hover:bg-primary-foreground/20 transition"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight truncate">
                  {showHistory ? "Chat history" : "Hostiva Assistant"}
                </p>
                <p className="text-xs opacity-90 leading-tight truncate">
                  {showHistory
                    ? `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`
                    : recipientName !== "there"
                      ? `Hi ${recipientName} • Replies instantly`
                      : "AI-powered • Replies instantly"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!showHistory && identified && user && (
                <button
                  type="button"
                  onClick={() => setShowHistory(true)}
                  aria-label="View chat history"
                  title="View history"
                  className="p-1 rounded-full hover:bg-primary-foreground/20 transition"
                >
                  <History className="w-4 h-4" />
                </button>
              )}
              {!showHistory && messages.length > 1 && (
                <button
                  type="button"
                  onClick={startNewChat}
                  aria-label="Start new chat"
                  title="New chat"
                  className="p-1 rounded-full hover:bg-primary-foreground/20 transition"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
              {!showHistory && user && messages.length > 1 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  aria-label="Clear chat history"
                  title="Delete this conversation"
                  className="p-1 rounded-full hover:bg-primary-foreground/20 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setMinimized(true)}
                aria-label="Minimize chat"
                title="Minimize"
                className="p-1 rounded-full hover:bg-primary-foreground/20 transition"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close chat"
                className="p-1 rounded-full hover:bg-primary-foreground/20 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Identity gate (anonymous users) */}
          {!identified && !showHistory && (
            <div className="flex-1 overflow-y-auto p-5 bg-muted/30 flex flex-col justify-center">
              <div className="text-center mb-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Mail className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Before we chat</h3>
                <p className="text-xs text-muted-foreground mt-1 px-2">
                  Tell us who you are. We'll email you a copy of the conversation when you're done.
                </p>
              </div>
              <form onSubmit={saveGuestIdentity} className="space-y-2">
                <input
                  type="text"
                  required
                  value={guestFormName}
                  onChange={(e) => setGuestFormName(e.target.value)}
                  placeholder="Your name"
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <input
                  type="email"
                  required
                  value={guestFormEmail}
                  onChange={(e) => setGuestFormEmail(e.target.value)}
                  placeholder="Email address"
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg py-2 text-sm font-semibold transition"
                >
                  Start chatting
                </button>
              </form>
              <p className="text-[11px] text-muted-foreground text-center mt-3">
                Already have a Hostiva account? <a href="/auth" className="text-primary hover:underline">Sign in</a> to save your history.
              </p>
            </div>
          )}

          {/* History sidebar */}
          {identified && showHistory && (
            <div className="flex-1 overflow-y-auto bg-muted/20">
              <button
                type="button"
                onClick={startNewChat}
                className="w-full flex items-center gap-2 px-4 py-3 border-b border-border bg-card hover:bg-muted/40 transition text-sm font-medium text-foreground"
              >
                <Plus className="w-4 h-4 text-primary" /> Start a new chat
              </button>
              {conversations.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-8 px-4">
                  No past conversations yet. Send a message to start one.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openConversation(c)}
                        className={cn(
                          "w-full text-left px-4 py-3 hover:bg-muted/40 transition flex flex-col gap-0.5",
                          c.id === conversationId && "bg-muted/60"
                        )}
                      >
                        <span className="text-sm font-medium text-foreground line-clamp-1">
                          {c.title || "Untitled chat"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDate(c.updated_at)} • {(c.messages?.length ?? 0)} message{(c.messages?.length ?? 0) === 1 ? "" : "s"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Chat area */}
          {identified && !showHistory && (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/30">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-card border border-border text-foreground rounded-bl-sm"
                      )}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {user && messages.length === 1 && resumableConversation && (
                  <div className="flex justify-start">
                    <button
                      type="button"
                      onClick={() => openConversation(resumableConversation)}
                      className="group max-w-[85%] flex items-start gap-2.5 bg-card border border-border hover:border-primary/40 hover:bg-primary/5 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-left transition"
                    >
                      <RotateCcw className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">Resume previous chat</p>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {resumableConversation.title || "Untitled chat"}
                        </p>
                        <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                          {formatDate(resumableConversation.updated_at)}
                        </p>
                      </div>
                    </button>
                  </div>
                )}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Thinking…
                    </div>
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage();
                }}
                className="border-t border-border bg-card p-2.5 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your question…"
                  disabled={loading}
                  className="flex-1 min-w-0 bg-muted/50 border border-border rounded-full px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label="Send message"
                  className="shrink-0 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground rounded-full p-2 transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}