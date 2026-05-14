import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Users, MessageCircle, HelpCircle, Lightbulb, TrendingUp,
  Plus, ThumbsUp, MessageSquare, Clock, Pin, Search, ArrowRight
} from 'lucide-react';
import { format } from 'date-fns';

interface ForumPost {
  id: string;
  title: string;
  content: string;
  category: string;
  author_name: string;
  author_avatar: string | null;
  created_at: string;
  replies_count: number;
  likes_count: number;
  is_pinned: boolean;
}

const forumCategories = [
  { key: 'tips', icon: Lightbulb, title: 'Tips & Best Practices', color: 'bg-amber-500/10 text-amber-500' },
  { key: 'growth', icon: TrendingUp, title: 'Growing Your Business', color: 'bg-green-500/10 text-green-500' },
  { key: 'guests', icon: MessageCircle, title: 'Guest Relations', color: 'bg-primary/10 text-primary' },
  { key: 'help', icon: HelpCircle, title: 'Help & Support', color: 'bg-sky-500/10 text-sky-500' },
];

// Sample posts for demonstration (in a real app these would come from the database)
const samplePosts: ForumPost[] = [
  {
    id: '1', title: 'How to improve your listing photos', content: 'I recently hired a professional photographer and my bookings increased by 40%. Here are my tips for great listing photos...', category: 'tips',
    author_name: 'Sarah M.', author_avatar: null, created_at: new Date(Date.now() - 3600000 * 2).toISOString(), replies_count: 12, likes_count: 34, is_pinned: true,
  },
  {
    id: '2', title: 'Pricing strategy for slow seasons', content: 'I\'ve been experimenting with dynamic pricing during off-peak months. Here\'s what worked for me...', category: 'growth',
    author_name: 'James K.', author_avatar: null, created_at: new Date(Date.now() - 3600000 * 5).toISOString(), replies_count: 8, likes_count: 21, is_pinned: false,
  },
  {
    id: '3', title: 'Dealing with late checkouts gracefully', content: 'Had a situation where guests were consistently checking out late. Here\'s how I addressed it without affecting reviews...', category: 'guests',
    author_name: 'Maria L.', author_avatar: null, created_at: new Date(Date.now() - 3600000 * 12).toISOString(), replies_count: 15, likes_count: 28, is_pinned: false,
  },
  {
    id: '4', title: 'Best cleaning service recommendations?', content: 'Looking for reliable cleaning services in the NYC area. Any recommendations from fellow hosts?', category: 'help',
    author_name: 'David R.', author_avatar: null, created_at: new Date(Date.now() - 3600000 * 24).toISOString(), replies_count: 6, likes_count: 9, is_pinned: false,
  },
  {
    id: '5', title: 'Welcome baskets that wow guests', content: 'Started providing local artisan welcome baskets and my 5-star reviews skyrocketed. Here\'s what I include...', category: 'tips',
    author_name: 'Emma W.', author_avatar: null, created_at: new Date(Date.now() - 3600000 * 36).toISOString(), replies_count: 22, likes_count: 56, is_pinned: true,
  },
  {
    id: '6', title: 'How to get Superhost status faster', content: 'After 6 months of hosting, I achieved Superhost status. Here are the key things I focused on...', category: 'growth',
    author_name: 'Alex T.', author_avatar: null, created_at: new Date(Date.now() - 3600000 * 48).toISOString(), replies_count: 19, likes_count: 42, is_pinned: false,
  },
];

export default function CommunityForums() {
  const { user, isHost } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [posts, setPosts] = useState<ForumPost[]>(samplePosts);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newPostTitle, setNewPostTitle] = useState('');
  const [newPostContent, setNewPostContent] = useState('');
  const [newPostCategory, setNewPostCategory] = useState('tips');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    if (!isHost) { navigate('/become-host'); return; }
    import('@/hooks/useHostModeGuard').then(m => m.setHostMode('host'));
  }, [user, isHost, navigate]);

  const filteredPosts = posts
    .filter(p => activeCategory === 'all' || p.category === activeCategory)
    .filter(p => !searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.content.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const handleCreatePost = () => {
    if (!newPostTitle.trim() || !newPostContent.trim()) return;

    const newPost: ForumPost = {
      id: crypto.randomUUID(),
      title: newPostTitle,
      content: newPostContent,
      category: newPostCategory,
      author_name: 'You',
      author_avatar: null,
      created_at: new Date().toISOString(),
      replies_count: 0,
      likes_count: 0,
      is_pinned: false,
    };

    setPosts([newPost, ...posts]);
    setNewPostTitle('');
    setNewPostContent('');
    setIsDialogOpen(false);
    toast({ title: 'Post created!', description: 'Your post has been published to the community.' });
  };

  const handleLike = (postId: string) => {
    setPosts(posts.map(p =>
      p.id === postId ? { ...p, likes_count: p.likes_count + 1 } : p
    ));
  };

  const getCategoryInfo = (key: string) => forumCategories.find(c => c.key === key);

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold mb-2">{t('communityForums.title')}</h1>
            <p className="text-muted-foreground">{t('communityForums.subtitle')}</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="btn-gold gap-2">
                <Plus className="w-4 h-4" /> {t('communityForums.newPost')}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-display">{t('communityForums.createPost')}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Input
                    placeholder="Post title..."
                    value={newPostTitle}
                    onChange={e => setNewPostTitle(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {forumCategories.map(cat => (
                    <Button
                      key={cat.key}
                      variant={newPostCategory === cat.key ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setNewPostCategory(cat.key)}
                      className="gap-1.5"
                    >
                      <cat.icon className="w-3.5 h-3.5" />
                      {cat.title.split(' ')[0]}
                    </Button>
                  ))}
                </div>
                <Textarea
                  placeholder="Share your thoughts, tips, or questions..."
                  value={newPostContent}
                  onChange={e => setNewPostContent(e.target.value)}
                  rows={5}
                />
                <Button className="btn-gold w-full" onClick={handleCreatePost} disabled={!newPostTitle.trim() || !newPostContent.trim()}>
                  {t('communityForums.publishPost')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Hosts', value: '2,340', icon: Users },
            { label: 'Total Posts', value: String(posts.length), icon: MessageSquare },
            { label: 'Categories', value: '4', icon: Lightbulb },
            { label: 'Online Now', value: '127', icon: Clock },
          ].map(stat => (
            <Card key={stat.label} className="card-luxury">
              <CardContent className="py-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <stat.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-display text-xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search posts..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Category Tabs */}
        <Tabs value={activeCategory} onValueChange={setActiveCategory} className="mb-6">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="all">{t('communityForums.allPosts')}</TabsTrigger>
            {forumCategories.map(cat => (
              <TabsTrigger key={cat.key} value={cat.key} className="gap-1.5">
                <cat.icon className="w-3.5 h-3.5" />
                {cat.title.split('&')[0].trim()}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Posts */}
        <div className="space-y-4">
          {filteredPosts.length > 0 ? filteredPosts.map(post => {
            const catInfo = getCategoryInfo(post.category);
            return (
              <Card key={post.id} className="card-luxury hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    {/* Author avatar */}
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">{post.author_name.charAt(0)}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {post.is_pinned && (
                          <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/30 bg-amber-500/10">
                            <Pin className="w-3 h-3" /> Pinned
                          </Badge>
                        )}
                        {catInfo && (
                          <Badge variant="outline" className={catInfo.color + ' border-current/20'}>
                            {catInfo.title}
                          </Badge>
                        )}
                      </div>

                      <h3 className="font-display text-base font-semibold mb-1">{post.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{post.content}</p>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{post.author_name}</span>
                        <span>{timeAgo(post.created_at)}</span>
                        <button
                          className="flex items-center gap-1 hover:text-primary transition-colors"
                          onClick={() => handleLike(post.id)}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" /> {post.likes_count}
                        </button>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3.5 h-3.5" /> {post.replies_count} replies
                        </span>
                      </div>
                    </div>

                    <Button variant="ghost" size="sm" className="flex-shrink-0">
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          }) : (
            <Card className="card-luxury">
              <CardContent className="text-center py-16">
                <Search className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <h3 className="font-display text-lg font-semibold mb-1">{t('communityForums.noPostsFound')}</h3>
                <p className="text-sm text-muted-foreground">{t('communityForums.noPostsDesc')}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}