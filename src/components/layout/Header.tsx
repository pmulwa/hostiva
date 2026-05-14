import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Menu, User, Home, Calendar as CalendarIcon, Heart, MessageSquare, Settings, LogOut, Shield, Bell, Globe, Search, Check, PlaneTakeoff, Plus, BarChart3, Star, DollarSign, Users, BookOpen, AlertTriangle } from 'lucide-react';
import { languages } from '@/i18n';
import { NotificationsBell } from '@/components/NotificationsBell';
import { Gift } from 'lucide-react';
import { useFreeBookingsRemaining } from '@/hooks/useFreeBookingsRemaining';
import { setHostMode as persistHostMode } from '@/hooks/useHostModeGuard';
import hostivaLogo from '@/assets/hostiva-logo.png';

export function Header() {
  const { user, profile, isHost, isAdmin, signOut } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';
  const isOnAdminRoute = location.pathname.startsWith('/admin');
  const [unreadCount, setUnreadCount] = useState(0);
  const [cancellationRequestCount, setCancellationRequestCount] = useState(0);
  const { remaining: freeRemaining, isActive: freeChipActive } = useFreeBookingsRemaining();

  // Persistent host mode: once you enter /host/*, you stay in host mode
  // Only clicking "Travelling" clears it
  const isOnHostRoute = location.pathname.startsWith('/host/');
  const [hostMode, setHostMode] = useState(() => {
    const mode = localStorage.getItem('hostly_mode');
    return mode === 'host' || mode === 'admin';
  });

  useEffect(() => {
    if (isOnHostRoute && isHost) {
      persistHostMode('host');
      setHostMode(true);
    }
  }, [isOnHostRoute, isHost]);

  const switchToGuest = () => {
    persistHostMode('guest');
    setHostMode(false);
    navigate('/');
  };

  const switchToHost = () => {
    persistHostMode('host');
    setHostMode(true);
    navigate('/host/dashboard');
  };

  const isHostMode = isHost && hostMode;

  const currentLang = languages.find(l => l.code === i18n.language) || languages[0];

  // Fetch unread message count + pending cancellation requests (for hosts)
  useEffect(() => {
    if (!user) { setUnreadCount(0); setCancellationRequestCount(0); return; }

    const fetchUnread = async () => {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_id', user.id)
        .eq('is_read', false)
        .or('scheduled_at.is.null,scheduled_at.lte.' + new Date().toISOString());
      setUnreadCount(count || 0);
    };

    const fetchCancellationRequests = async () => {
      if (!isHost) { setCancellationRequestCount(0); return; }
      // System messages addressed to this host that are cancellation requests and still unread
      const { data } = await supabase
        .from('messages')
        .select('id, content, booking_id')
        .eq('receiver_id', user.id)
        .eq('message_type', 'system')
        .eq('is_read', false)
        .ilike('content', '%Cancellation Request%');

      if (!data || data.length === 0) { setCancellationRequestCount(0); return; }

      // Filter out requests whose booking is already cancelled (request resolved)
      const bookingIds = Array.from(new Set(data.map(m => m.booking_id).filter(Boolean))) as string[];
      let resolvedIds = new Set<string>();
      if (bookingIds.length > 0) {
        const { data: bookings } = await supabase
          .from('bookings')
          .select('id, status')
          .in('id', bookingIds);
        resolvedIds = new Set((bookings || []).filter(b => b.status === 'cancelled').map(b => b.id));
      }
      const pending = data.filter(m => !m.booking_id || !resolvedIds.has(m.booking_id));
      setCancellationRequestCount(pending.length);
    };

    fetchUnread();
    fetchCancellationRequests();

    // Real-time subscription
    const channel = supabase
      .channel('header-unread-messages')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
      }, () => {
        fetchUnread();
        fetchCancellationRequests();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'bookings',
      }, () => {
        fetchCancellationRequests();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, isHost]);


  const handleSignOut = async () => {
    persistHostMode('guest');
    setHostMode(false);
    await signOut();
    navigate('/');
  };

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
    // Set RTL for Arabic
    document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
  };

  return (
    <header className={`sticky top-0 z-50 ${isHome ? 'bg-background' : 'glass-effect'} border-b border-border`}>
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex h-[72px] items-center justify-between">
          {/* Logo */}
          <Link
            to={isOnAdminRoute && isAdmin ? '/admin' : isHostMode ? '/host/dashboard' : '/'}
            aria-label="Hostiva home"
            className="flex items-center"
          >
            {/* Transparent logo: shows on any background. In dark mode we lift
                contrast with a soft white halo so the navy wordmark stays
                fully readable without a hard pill. */}
            <img
              src={hostivaLogo}
              alt="Hostiva"
              className="block h-12 md:h-14 w-auto object-contain dark:drop-shadow-[0_0_8px_rgba(255,255,255,0.85)] dark:bg-white/95 dark:rounded-md dark:px-2 dark:py-1"
              loading="eager"
              decoding="async"
            />
          </Link>

          {/* Center Search Bar (compact) - Hidden in host mode */}
          {!isHostMode && (
            <div 
              className="hidden md:flex items-center bg-card border border-border rounded-full shadow-sm hover:shadow-md transition-shadow cursor-pointer px-2 py-1.5"
              onClick={() => navigate('/search')}
            >
              <div className="px-4 py-1 text-sm font-medium border-r border-border text-foreground">{t('header.whereTo')}</div>
              <div className="px-4 py-1 text-sm font-medium border-r border-border text-muted-foreground">{t('header.dates')}</div>
              <div className="px-4 py-1 text-sm text-muted-foreground">{t('header.guests')}</div>
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center ml-1">
                <Search className="w-4 h-4 text-primary-foreground" />
              </div>
            </div>
          )}

          {/* Right */}
          <div className="flex items-center gap-2">
            {user && !isHost && (
              <Button
                variant="ghost"
                className="hidden md:flex text-sm font-semibold hover:bg-secondary rounded-full"
                onClick={() => navigate('/become-host')}
              >
                <Home className="w-4 h-4 mr-2" />
                {t('header.listProperty')}
              </Button>
            )}
            {user && isHostMode && (
              <Button
                variant="ghost"
                className="group hidden md:flex items-center text-sm font-bold hover:bg-muted/60 rounded-full gap-2.5 px-5 py-2.5 transition-all duration-200"
                onClick={switchToGuest}
              >
                <span className="relative flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-teal-400 shadow-md group-hover:scale-110 transition-transform duration-200">
                  <PlaneTakeoff className="w-4 h-4 text-white" />
                </span>
                <span className="text-foreground font-bold text-[13px]">{t('header.travelling')}</span>
              </Button>
            )}
            {user && isHost && !isHostMode && (
              <Button
                variant="ghost"
                className="group hidden md:flex items-center text-sm font-bold hover:bg-muted/60 rounded-full gap-2.5 px-5 py-2.5 transition-all duration-200"
                onClick={switchToHost}
              >
                <span className="relative flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-400 shadow-md group-hover:scale-110 transition-transform duration-200">
                  <Home className="w-4 h-4 text-white" />
                </span>
                <span className="text-foreground font-bold text-[13px]">{t('header.listProperty')}</span>
              </Button>
            )}
            {user && isHost && cancellationRequestCount > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full relative hidden md:flex hover:bg-destructive/10"
                onClick={() => navigate('/messages')}
                title={t('header.pendingCancellations', { count: cancellationRequestCount })}
              >
                <AlertTriangle className="w-5 h-5 text-destructive" />
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                  {cancellationRequestCount > 99 ? '99+' : cancellationRequestCount}
                </span>
              </Button>
            )}
            {user && isHostMode && freeChipActive && (
              <button
                type="button"
                onClick={() => navigate('/host/dashboard')}
                title={t('header.freeLeft', { count: freeRemaining })}
                className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15 transition-colors"
              >
                <Gift className="w-3.5 h-3.5" />
                <span>{t('header.freeLeft', { count: freeRemaining })}</span>
              </button>
            )}
            {user && (
              <>
                <Button variant="ghost" size="icon" className="rounded-full relative hidden md:flex" onClick={() => navigate('/messages')} title={t('header.messagesTitle')}>
                  <MessageSquare className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Button>
                <div className="hidden md:flex"><NotificationsBell /></div>
              </>
            )}

            {/* Globe / Language Selector Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full hidden md:flex"
                >
                  <Globe className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto bg-card border-border shadow-xl rounded-xl">
                {languages.map((lang) => (
                  <DropdownMenuItem
                    key={lang.code}
                    onClick={() => changeLanguage(lang.code)}
                    className={`flex items-center gap-3 cursor-pointer ${
                      i18n.language === lang.code ? 'bg-primary/10' : ''
                    }`}
                  >
                    <span className="text-lg">{lang.flag}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{lang.name}</p>
                      <p className="text-xs text-muted-foreground">{lang.region}</p>
                    </div>
                    {i18n.language === lang.code && (
                      <Check className="w-4 h-4 text-primary shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-full border-border hover:shadow-md transition-shadow"
                  >
                    <Menu className="w-4 h-4" />
                    <Avatar className="w-7 h-7">
                      <AvatarImage src={profile?.avatar_url || ''} />
                      <AvatarFallback className="bg-foreground text-background text-xs font-bold">
                        {profile?.full_name?.[0] || user.email?.[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-card border-border shadow-xl rounded-xl">
                  <DropdownMenuItem asChild>
                    <Link to="/profile" className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      {t('header.profile')}
                    </Link>
                  </DropdownMenuItem>

                  {isHostMode ? (
                    <>
                      {/* Host-mode menu */}
                      <DropdownMenuItem asChild>
                        <Link to="/host/dashboard" className="flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          {t('header.menu.dashboard')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/host/calendar" className="flex items-center gap-2">
                          <CalendarIcon className="w-4 h-4" />
                          {t('header.menu.calendar')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/host/properties/new" className="flex items-center gap-2">
                          <Plus className="w-4 h-4" />
                          {t('header.menu.addProperty')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/bookings" className="flex items-center gap-2">
                          <CalendarIcon className="w-4 h-4" />
                          {t('header.menu.reservations')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/messages" className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4" />
                          {t('header.menu.guestMessages')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link to="/host/earnings" className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4" />
                          {t('header.menu.earnings')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/host/accounting" className="flex items-center gap-2">
                          <BookOpen className="w-4 h-4" />
                          {t('header.menu.accounting')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/host/reviews" className="flex items-center gap-2">
                          <Star className="w-4 h-4" />
                          {t('header.menu.reviews')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link to="/host/community" className="flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          {t('header.menu.communityForums')}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      {/* Guest-mode menu */}
                      <DropdownMenuItem asChild>
                        <Link to="/bookings" className="flex items-center gap-2">
                          <CalendarIcon className="w-4 h-4" />
                          {t('header.myBookings')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/favorites" className="flex items-center gap-2">
                          <Heart className="w-4 h-4" />
                          {t('header.favorites')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/messages" className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4" />
                          {t('header.messages')}
                        </Link>
                      </DropdownMenuItem>
                      
                      {isHost && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link to="/host/dashboard" className="flex items-center gap-2">
                              <Home className="w-4 h-4" />
                              {t('header.hostDashboard')}
                            </Link>
                          </DropdownMenuItem>
                        </>
                      )}
                    </>
                  )}

                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link to="/admin" className="flex items-center gap-2">
                          <Shield className="w-4 h-4" />
                          {t('header.adminPanel')}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      {t('header.settings')}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="flex items-center gap-2 text-destructive"
                  >
                    <LogOut className="w-4 h-4" />
                    {t('header.signOut')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => navigate('/auth')}
                  className="font-semibold rounded-full"
                >
                  {t('header.signIn')}
                </Button>
                <Button
                  onClick={() => navigate('/auth?mode=signup')}
                  className="btn-primary rounded-full"
                >
                  {t('header.signUp')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}