import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface AdminNote {
  id: string;
  target_user_id: string;
  author_id: string;
  note: string;
  created_at: string;
  updated_at: string;
  author_name?: string;
}

interface AdminNotesPanelProps {
  targetUserId: string;
}

/**
 * Internal-notes panel. All admins can read; only the original author can edit/delete their own note.
 */
export function AdminNotesPanel({ targetUserId }: AdminNotesPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const fetchNotes = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('admin_user_notes' as any)
      .select('*')
      .eq('target_user_id', targetUserId)
      .order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Failed to load notes', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const rows = (data as any[]) ?? [];
    // Resolve author display names in one query
    const authorIds = Array.from(new Set(rows.map((n) => n.author_id)));
    const nameMap: Record<string, string> = {};
    if (authorIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', authorIds);
      (profs ?? []).forEach((p) => {
        nameMap[p.user_id] = p.full_name || p.email || 'Admin';
      });
    }
    setNotes(rows.map((n) => ({ ...n, author_name: nameMap[n.author_id] ?? 'Admin' })));
    setLoading(false);
  };

  useEffect(() => {
    fetchNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUserId]);

  const addNote = async () => {
    if (!draft.trim() || !user?.id) return;
    setSaving(true);
    const { error } = await supabase
      .from('admin_user_notes' as any)
      .insert({
        target_user_id: targetUserId,
        author_id: user.id,
        note: draft.trim(),
      } as any);
    setSaving(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    setDraft('');
    toast({ title: 'Note added' });
    fetchNotes();
  };

  const saveEdit = async (id: string) => {
    if (!editDraft.trim()) return;
    const { error } = await supabase
      .from('admin_user_notes' as any)
      .update({ note: editDraft.trim() })
      .eq('id', id);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return;
    }
    setEditingId(null);
    setEditDraft('');
    fetchNotes();
  };

  const deleteNote = async (id: string) => {
    const { error } = await supabase.from('admin_user_notes' as any).delete().eq('id', id);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
      return;
    }
    fetchNotes();
  };

  return (
    <div className="space-y-3">
      {/* Compose */}
      <div className="rounded-lg border bg-muted/20 p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Leave an internal note for the team…"
          className="resize-none text-sm bg-background"
        />
        <div className="flex justify-end mt-2">
          <Button size="sm" onClick={addNote} disabled={saving || !draft.trim()}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
            Add note
          </Button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> Loading notes…
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground italic text-center py-6">No internal notes yet.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {notes.map((n) => {
            const isAuthor = n.author_id === user?.id;
            const isEditing = editingId === n.id;
            return (
              <div key={n.id} className="rounded-lg border bg-card/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-[11px] font-semibold text-foreground">
                    {n.author_name}
                    {isAuthor && <span className="ml-1.5 text-[9px] uppercase text-primary tracking-wider">You</span>}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {format(new Date(n.created_at), 'MMM d, yyyy · h:mm a')}
                    {n.updated_at !== n.created_at && ' (edited)'}
                  </p>
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={2}
                      className="resize-none text-sm"
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditDraft(''); }}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" onClick={() => saveEdit(n.id)} disabled={!editDraft.trim()}>
                        <Check className="w-3.5 h-3.5 mr-1" /> Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{n.note}</p>
                    {isAuthor && (
                      <div className="flex justify-end gap-1 mt-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => { setEditingId(n.id); setEditDraft(n.note); }}
                        >
                          <Pencil className="w-3 h-3 mr-1" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => deleteNote(n.id)}
                        >
                          <Trash2 className="w-3 h-3 mr-1" /> Delete
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}