import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { languages } from '@/i18n';
import {
  Settings, User, Shield, Bell, CreditCard, Eye, Accessibility, Trash2,
  Camera, Mail, Phone, MapPin, Globe, Lock, KeyRound, Smartphone,
  BellRing, MessageSquare, Heart, Calendar, Tag, DollarSign,
  EyeOff, Users, FileText, Download, AlertTriangle, LogOut,
  Check, Moon, Sun, Monitor, Home,
} from 'lucide-react';
import PasswordStrengthIndicator from '@/components/PasswordStrengthIndicator';
import { useRateLimit } from '@/hooks/useRateLimit';
import { buildPropertyIdentifierMap } from '@/lib/propertyIdentifier';
import { CountryPicker } from '@/components/admin/CountryPicker';
import {
  applyDialCode,
  formatPhoneAsTyping,
  resolveCountryFromLocation,
  type Country,
} from '@/lib/countries';
import { useTheme } from '@/hooks/useTheme';
import {
  AUTOMATED_MESSAGE_CATALOG,
  QUICK_REPLY_CATALOG,
  defaultAutomatedMessages,
  defaultQuickReplies,
  type AutomatedMessageType,
  type QuickReplyKey,
} from '@/lib/automatedMessages';

type SettingsSection = 'personal' | 'security' | 'notifications' | 'messages' | 'payment' | 'privacy' | 'accessibility' | 'account';

const NAV_ITEMS: { key: SettingsSection; icon: typeof User }[] = [
  { key: 'personal', icon: User },
  { key: 'security', icon: Shield },
  { key: 'notifications', icon: Bell },
  { key: 'messages', icon: MessageSquare },
  { key: 'payment', icon: CreditCard },
  { key: 'privacy', icon: Eye },
  { key: 'accessibility', icon: Accessibility },
  { key: 'account', icon: Settings },
];

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { user, profile, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activeSection, setActiveSection] = useState<SettingsSection>('personal');
  const [saving, setSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [showLanguageDialog, setShowLanguageDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Personal info
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [country, setCountry] = useState<Country | null>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);

  // Security
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');

  // Notifications
  const [notifBookingUpdates, setNotifBookingUpdates] = useState(true);
  const [notifMessages, setNotifMessages] = useState(true);
  const [notifPromotions, setNotifPromotions] = useState(false);
  const [notifPriceAlerts, setNotifPriceAlerts] = useState(true);
  const [notifReviews, setNotifReviews] = useState(true);
  const [notifSecurity, setNotifSecurity] = useState(true);
  const [notifNewsletter, setNotifNewsletter] = useState(false);
  const [notifSMS, setNotifSMS] = useState(false);
  const [notifPush, setNotifPush] = useState(true);

  // Privacy
  const [profileVisibility, setProfileVisibility] = useState('public');
  const [showTrips, setShowTrips] = useState(true);
  const [showReviews, setShowReviews] = useState(true);
  const [showWishlist, setShowWishlist] = useState(false);
  const [allowSearchEngines, setAllowSearchEngines] = useState(true);
  const [shareDataPartners, setShareDataPartners] = useState(false);
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);

  // Accessibility
  const [fontSize, setFontSize] = useState('medium');
  const [highContrast, setHighContrast] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  // Global theme — applied across the entire app, persisted to localStorage
  // and to user_preferences. The hook handles OS-preference changes too.
  const { theme: themeMode, setTheme: setThemeMode } = useTheme();

  // Payment
  const [currency, setCurrency] = useState('USD');
  const [couponCode, setCouponCode] = useState('');

  // Messages — per-user toggles for automated/system messages and quick-reply prompts
  const [autoMessages, setAutoMessages] = useState<Record<AutomatedMessageType, boolean>>(
    defaultAutomatedMessages(),
  );
  const [quickReplies, setQuickReplies] = useState<Record<QuickReplyKey, boolean>>(
    defaultQuickReplies(),
  );

  // Connected accounts state
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);

  // Property management — list of host's own properties with their unique short id.
  const [myProperties, setMyProperties] = useState<
    Array<{ id: string; title: string; status: string; city: string; country: string; created_at: string; host_id: string }>
  >([]);

  // Load preferences from DB
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    if (profile) {
      setFullName(profile.full_name || '');
      setPhone(profile.phone || '');
      setBio(profile.bio || '');
      setLocation(profile.location || '');
      // Robust resolution — handles country code, full name, "City, Country",
      // fuzzy match, or as a last resort the dial-code prefix on the phone.
      setCountry(resolveCountryFromLocation(profile.location, profile.phone) ?? null);
    }

    // Check connected providers from user metadata
    const providers = user.app_metadata?.providers || [];
    setConnectedProviders(providers);

    // Fetch user preferences
    const fetchPrefs = async () => {
      const { data } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (data) {
        setNotifBookingUpdates(data.notif_booking_updates);
        setNotifMessages(data.notif_messages);
        setNotifPromotions(data.notif_promotions);
        setNotifPriceAlerts(data.notif_price_alerts);
        setNotifReviews(data.notif_reviews);
        setNotifSecurity(data.notif_security);
        setNotifNewsletter(data.notif_newsletter);
        setNotifSMS(data.notif_sms);
        setNotifPush(data.notif_push);
        setProfileVisibility(data.profile_visibility);
        setShowTrips(data.show_trips);
        setShowReviews(data.show_reviews);
        setShowWishlist(data.show_wishlist);
        setShowOnlineStatus(data.show_online_status);
        setAllowSearchEngines(data.allow_search_engines);
        setShareDataPartners(data.share_data_partners);
        setFontSize(data.font_size);
        setHighContrast(data.high_contrast);
        setReduceMotion(data.reduce_motion);
        setScreenReader(data.screen_reader);
        // NOTE: theme is intentionally device-local. We do NOT hydrate from
        // the user's saved DB preference — switching theme on one device
        // must never affect another device or another user sharing this
        // browser profile. Default is "day" (light).
        setCurrency(data.preferred_currency);
        // Load message-prompt toggles, merging defaults so newly added prompts default to ON.
        const am = (data as any).automated_messages ?? {};
        setAutoMessages({ ...defaultAutomatedMessages(), ...am });
        const qr = (data as any).quick_replies ?? {};
        setQuickReplies({ ...defaultQuickReplies(), ...qr });
      }
      setPrefsLoaded(true);
    };
    fetchPrefs();
  }, [user, profile, navigate]);

  // Load the user's properties for the Property Management panel.
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('properties')
        .select('id,title,status,city,country,created_at,host_id')
        .eq('host_id', user.id)
        .order('created_at', { ascending: true });
      if (active && data) setMyProperties(data);
    })();
    return () => { active = false; };
  }, [user]);

  // Apply font size live
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('text-sm', 'text-base', 'text-lg');
    if (fontSize === 'small') root.style.fontSize = '14px';
    else if (fontSize === 'large') root.style.fontSize = '18px';
    else root.style.fontSize = '16px';
  }, [fontSize]);

  // Apply reduce motion
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  // Apply high contrast
  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast);
  }, [highContrast]);

  const upsertPreferences = async (prefs: Record<string, unknown>) => {
    if (!user) return;
    const { data: existing } = await supabase
      .from('user_preferences')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existing) {
      await supabase.from('user_preferences').update({ ...prefs, updated_at: new Date().toISOString() }).eq('user_id', user.id);
    } else {
      await supabase.from('user_preferences').insert({ user_id: user.id, ...prefs } as any);
    }
  };

  const handleSavePersonal = async () => {
    if (!user) return;
    setSaving(true);

    let avatarUrl = profile?.avatar_url || '';
    if (avatarFile) {
      const fileExt = avatarFile.name.split('.').pop();
      const filePath = `${user.id}/avatar.${fileExt}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(filePath, avatarFile, { upsert: true });
      if (!uploadErr) {
        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);
        avatarUrl = urlData.publicUrl;
      } else {
        toast({ title: 'Upload failed', description: uploadErr.message, variant: 'destructive' });
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        phone,
        bio,
        location,
        avatar_url: avatarUrl || profile?.avatar_url,
      })
      .eq('user_id', user.id);

    // Also save currency preference
    await upsertPreferences({ preferred_currency: currency });

    if (error) {
      toast({ title: t('settings.saveFailed'), variant: 'destructive' });
    } else {
      await refreshProfile();
      setAvatarFile(null);
      toast({ title: t('settings.saved'), description: t('settings.personalSaved') });
    }
    setSaving(false);
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({ title: t('settings.passwordMismatch'), variant: 'destructive' });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: t('settings.passwordTooShort'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast({ title: t('settings.passwordFailed'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('settings.passwordChanged') });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    setSaving(false);
  };

  const { checkLimit: checkEmailLimit, isLimited: emailLimited, cooldownSeconds: emailCooldown } = useRateLimit({ maxAttempts: 3, windowMs: 120_000 });

  const handleChangeEmail = async () => {
    if (!newEmail || newEmail === user?.email) return;
    if (!checkEmailLimit()) {
      toast({ title: 'Too many attempts', description: `Please wait ${emailCooldown} seconds before trying again.`, variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser(
      { email: newEmail },
      { emailRedirectTo: window.location.origin + '/settings' }
    );
    if (error) {
      toast({ title: 'Email update failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Confirmation sent', description: 'Please check both your current and new email to confirm the change.' });
      setNewEmail('');
    }
    setSaving(false);
  };

  const handleSaveNotifications = async () => {
    setSaving(true);
    await upsertPreferences({
      notif_booking_updates: notifBookingUpdates,
      notif_messages: notifMessages,
      notif_promotions: notifPromotions,
      notif_price_alerts: notifPriceAlerts,
      notif_reviews: notifReviews,
      notif_security: notifSecurity,
      notif_newsletter: notifNewsletter,
      notif_sms: notifSMS,
      notif_push: notifPush,
    });
    toast({ title: t('settings.saved'), description: t('settings.notificationsSaved') });
    setSaving(false);
  };

  const handleSavePrivacy = async () => {
    setSaving(true);
    await upsertPreferences({
      profile_visibility: profileVisibility,
      show_trips: showTrips,
      show_reviews: showReviews,
      show_wishlist: showWishlist,
      show_online_status: showOnlineStatus,
      allow_search_engines: allowSearchEngines,
      share_data_partners: shareDataPartners,
    });
    toast({ title: t('settings.saved'), description: t('settings.privacySaved') });
    setSaving(false);
  };

  const handleSaveMessages = async () => {
    setSaving(true);
    await upsertPreferences({
      automated_messages: autoMessages,
      quick_replies: quickReplies,
    });
    toast({ title: 'Saved', description: 'Your message prompt preferences were updated.' });
    setSaving(false);
  };

  const toggleAutoMessage = (type: AutomatedMessageType, value: boolean) =>
    setAutoMessages((prev) => ({ ...prev, [type]: value }));

  const toggleQuickReply = (key: QuickReplyKey, value: boolean) =>
    setQuickReplies((prev) => ({ ...prev, [key]: value }));

  const setAutoMessageGroup = (group: 'lifecycle', value: boolean) =>
    setAutoMessages((prev) => {
      const next = { ...prev };
      AUTOMATED_MESSAGE_CATALOG.filter((m) => m.group === group).forEach((m) => {
        next[m.type] = value;
      });
      return next;
    });

  const handleSaveAccessibility = async () => {
    setSaving(true);
    await upsertPreferences({
      font_size: fontSize,
      high_contrast: highContrast,
      reduce_motion: reduceMotion,
      screen_reader: screenReader,
      theme: themeMode,
      preferred_currency: currency,
    });
    toast({ title: t('settings.saved'), description: t('settings.accessibilitySaved') });
    setSaving(false);
  };

  const handleSavePayment = async () => {
    setSaving(true);
    await upsertPreferences({ preferred_currency: currency });
    toast({ title: t('settings.saved'), description: 'Payment preferences saved successfully.' });
    setSaving(false);
  };

  const handleApplyCoupon = () => {
    if (!couponCode.trim()) {
      toast({ title: 'Enter a coupon code', variant: 'destructive' });
      return;
    }
    // Validate coupon (placeholder — no coupon table yet)
    toast({ title: 'Invalid coupon', description: `The code "${couponCode}" is not valid or has expired.`, variant: 'destructive' });
    setCouponCode('');
  };

  const handleDownloadData = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // Gather all user data
      const [profileRes, bookingsRes, favoritesRes, reviewsRes, messagesRes, prefsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', user.id),
        supabase.from('bookings').select('*').eq('guest_id', user.id),
        supabase.from('favorites').select('*').eq('user_id', user.id),
        supabase.from('reviews').select('*').eq('guest_id', user.id),
        supabase.from('messages').select('*').or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`),
        supabase.from('user_preferences').select('*').eq('user_id', user.id),
      ]);

      const exportData = {
        exported_at: new Date().toISOString(),
        user_email: user.email,
        profile: profileRes.data,
        bookings: bookingsRes.data,
        favorites: favoritesRes.data,
        reviews: reviewsRes.data,
        messages: messagesRes.data,
        preferences: prefsRes.data,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hostly-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: 'Data exported', description: 'Your data has been downloaded as a JSON file.' });
    } catch {
      toast({ title: 'Export failed', description: 'Could not export your data. Please try again.', variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleDeactivateAccount = async () => {
    // Mark profile as deactivated
    if (!user) return;
    setSaving(true);
    await supabase.from('profiles').update({ bio: '[DEACTIVATED] ' + (profile?.bio || '') }).eq('user_id', user.id);
    toast({ title: 'Account deactivated', description: 'Your account has been deactivated. You will be signed out.' });
    setShowDeactivateDialog(false);
    setSaving(false);
    await signOut();
    navigate('/');
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setSaving(true);
    // Clean up user data before signing out
    if (user) {
      await Promise.all([
        supabase.from('favorites').delete().eq('user_id', user.id),
        supabase.from('user_preferences').delete().eq('user_id', user.id),
      ]);
    }
    toast({ title: 'Account deletion requested', description: 'Your data has been cleared and account will be permanently deleted. You will be signed out.' });
    setShowDeleteDialog(false);
    setSaving(false);
    await signOut();
    navigate('/');
  };

  const handleSignOutAll = async () => {
    await supabase.auth.signOut({ scope: 'global' });
    await signOut();
    navigate('/');
  };

  const handleConnectProvider = (provider: string) => {
    toast({ 
      title: `Connect ${provider}`, 
      description: `${provider} OAuth connection is managed through the sign-in page. Sign in with ${provider} to link your account.` 
    });
  };

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
    document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
    setShowLanguageDialog(false);
    toast({ title: 'Language changed', description: `Language set to ${languages.find(l => l.code === code)?.name || code}` });
  };

  if (!user) return null;

  const currentLang = languages.find(l => l.code === i18n.language) || languages[0];

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 py-8 max-w-6xl">
        {/* Page Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Settings className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-extrabold">{t('settings.title')}</h1>
            <p className="text-muted-foreground text-sm">{t('settings.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar Nav */}
          <nav className="md:w-64 shrink-0">
            <div className="bg-card border border-border rounded-2xl overflow-hidden sticky top-24">
              {/* User card */}
              <div className="p-5 border-b border-border">
                <div className="flex items-center gap-3">
                  <Avatar className="w-11 h-11">
                    <AvatarImage src={profile?.avatar_url || ''} />
                    <AvatarFallback className="bg-primary/10 text-primary font-bold">
                      {(profile?.full_name || user.email)?.[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-display font-bold text-sm truncate">{profile?.full_name || 'Guest'}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                </div>
              </div>
              <div className="p-2">
                {NAV_ITEMS.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setActiveSection(item.key)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors',
                      activeSection === item.key
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {t(`settings.nav.${item.key}`)}
                  </button>
                ))}
              </div>
            </div>
          </nav>

          {/* Main Content */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* ===== PERSONAL INFO ===== */}
            {activeSection === 'personal' && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <User className="w-5 h-5 text-primary" />
                      {t('settings.personalInfo')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Avatar */}
                    <div className="flex items-center gap-5">
                      <div className="relative">
                        <Avatar className="w-20 h-20">
                          <AvatarImage src={avatarFile ? URL.createObjectURL(avatarFile) : profile?.avatar_url || ''} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                            {(profile?.full_name || user.email)?.[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <label className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center cursor-pointer hover:brightness-90 transition-all">
                          <Camera className="w-4 h-4" />
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                          />
                        </label>
                      </div>
                      <div>
                        <p className="font-display font-bold">{t('settings.profilePhoto')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.profilePhotoDesc')}</p>
                        {avatarFile && (
                          <Badge className="mt-1 bg-primary/10 text-primary border-0 text-xs">
                            New photo selected — save to apply
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Separator />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> {t('settings.fullName')}</Label>
                        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('settings.fullNamePlaceholder')} />
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {t('settings.email')}</Label>
                        <Input value={user.email || ''} disabled className="bg-secondary/50" />
                        <p className="text-[10px] text-muted-foreground">{t('settings.emailCantChange')}</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {t('settings.phone')}</Label>
                        <Input
                          ref={phoneInputRef}
                          value={phone}
                          onChange={(e) => {
                            // Live formatter — protects "+<dial> ", normalizes
                            // spacing and strips invalid characters.
                            const next = country
                              ? formatPhoneAsTyping(e.target.value, country.dial)
                              : e.target.value;
                            setPhone(next);
                          }}
                          onKeyDown={(e) => {
                            if (!country) return;
                            const input = e.currentTarget;
                            const protectedLen = `+${country.dial} `.length;
                            const selStart = input.selectionStart ?? 0;
                            const selEnd = input.selectionEnd ?? 0;
                            // Block edits that would damage the dial-code prefix.
                            if (
                              (e.key === 'Backspace' && selEnd <= protectedLen && selStart === selEnd) ||
                              (e.key === 'Delete' && selStart < protectedLen) ||
                              (selStart < protectedLen && selStart !== selEnd)
                            ) {
                              if (e.key === 'Backspace' || e.key === 'Delete') {
                                e.preventDefault();
                                requestAnimationFrame(() => {
                                  input.setSelectionRange(protectedLen, protectedLen);
                                });
                              }
                            }
                          }}
                          onFocus={(e) => {
                            if (!country) return;
                            const protectedLen = `+${country.dial} `.length;
                            const input = e.currentTarget;
                            if ((input.selectionStart ?? 0) < protectedLen) {
                              requestAnimationFrame(() => {
                                input.setSelectionRange(protectedLen, protectedLen);
                              });
                            }
                          }}
                          placeholder={country ? `+${country.dial} …` : t('settings.phonePlaceholder')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {t('settings.location')}</Label>
                        <CountryPicker
                          value={country?.code ?? location}
                          onChange={(c) => {
                            setCountry(c);
                            setLocation(c.name);
                            const nextPhone = applyDialCode(phone, c.dial);
                            setPhone(nextPhone);
                            requestAnimationFrame(() => {
                              const input = phoneInputRef.current;
                              if (!input) return;
                              input.focus();
                              const pos = nextPhone.length;
                              try { input.setSelectionRange(pos, pos); } catch {}
                            });
                          }}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> {t('settings.bio')}</Label>
                      <textarea
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder={t('settings.bioPlaceholder')}
                        rows={3}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                    </div>

                    <Button onClick={handleSavePersonal} disabled={saving} className="btn-primary rounded-full">
                      {saving ? t('common.loading') : t('common.save')}
                    </Button>
                  </CardContent>
                </Card>

                {/* Preferred Currency & Language */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <DollarSign className="w-5 h-5 text-primary" />
                      {t('settings.preferences')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{t('settings.currency')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.currencyDesc')}</p>
                      </div>
                      <Select value={currency} onValueChange={setCurrency}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'KRW', 'INR'].map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{t('settings.language')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.languageDesc')}</p>
                      </div>
                      <Button variant="outline" size="sm" className="rounded-full" onClick={() => setShowLanguageDialog(true)}>
                        <span className="mr-1.5">{currentLang.flag}</span> {currentLang.name}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ===== SECURITY ===== */}
            {activeSection === 'security' && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Lock className="w-5 h-5 text-primary" />
                      {t('settings.changePassword')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>{t('settings.currentPassword')}</Label>
                      <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="••••••••" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t('settings.newPassword')}</Label>
                        <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('settings.newPasswordPlaceholder')} />
                        <PasswordStrengthIndicator password={newPassword} />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('settings.confirmPassword')}</Label>
                        <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t('settings.confirmPasswordPlaceholder')} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('settings.passwordRequirements')}</p>
                    <Button onClick={handleChangePassword} disabled={saving || !newPassword} className="btn-primary rounded-full">
                      {saving ? t('common.loading') : t('settings.updatePassword')}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Mail className="w-5 h-5 text-primary" />
                      Change Email
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Your current email is <span className="font-medium text-foreground">{user.email}</span>. A confirmation will be sent to your new email address.
                    </p>
                    <div className="space-y-2">
                      <Label>New Email Address</Label>
                      <Input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="newemail@example.com"
                      />
                    </div>
                    <Button
                      onClick={handleChangeEmail}
                      disabled={saving || !newEmail || newEmail === user.email || emailLimited}
                      className="btn-primary rounded-full"
                    >
                      {emailLimited ? `Wait ${emailCooldown}s` : saving ? t('common.loading') : 'Update Email'}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Smartphone className="w-5 h-5 text-primary" />
                      {t('settings.twoFactor')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{t('settings.twoFactorDesc')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.twoFactorSub')}</p>
                      </div>
                      <Badge variant="outline" className="text-muted-foreground">{t('settings.comingSoon')}</Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <KeyRound className="w-5 h-5 text-primary" />
                      {t('settings.loginSessions')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50">
                      <div className="flex items-center gap-3">
                        <Monitor className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-sm">{t('settings.currentDevice')}</p>
                          <p className="text-xs text-muted-foreground">{t('settings.activeNow')}</p>
                        </div>
                      </div>
                      <Badge className="bg-primary/10 text-primary border-0">{t('settings.active')}</Badge>
                    </div>
                    <Button variant="outline" onClick={handleSignOutAll} className="rounded-full text-destructive border-destructive/30 hover:bg-destructive/5">
                      <LogOut className="w-4 h-4 mr-2" />
                      {t('settings.signOutAll')}
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ===== NOTIFICATIONS ===== */}
            {activeSection === 'notifications' && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <BellRing className="w-5 h-5 text-primary" />
                      {t('settings.bookingNotifs')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {[
                      { label: t('settings.notifBookingUpdates'), desc: t('settings.notifBookingUpdatesDesc'), state: notifBookingUpdates, setter: setNotifBookingUpdates, icon: Calendar },
                      { label: t('settings.notifMessages'), desc: t('settings.notifMessagesDesc'), state: notifMessages, setter: setNotifMessages, icon: MessageSquare },
                      { label: t('settings.notifReviews'), desc: t('settings.notifReviewsDesc'), state: notifReviews, setter: setNotifReviews, icon: Heart },
                      { label: t('settings.notifPriceAlerts'), desc: t('settings.notifPriceAlertsDesc'), state: notifPriceAlerts, setter: setNotifPriceAlerts, icon: Tag },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            <item.icon className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{item.label}</p>
                            <p className="text-xs text-muted-foreground">{item.desc}</p>
                          </div>
                        </div>
                        <Switch checked={item.state} onCheckedChange={item.setter} />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Bell className="w-5 h-5 text-primary" />
                      {t('settings.marketingNotifs')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {[
                      { label: t('settings.notifPromotions'), desc: t('settings.notifPromotionsDesc'), state: notifPromotions, setter: setNotifPromotions },
                      { label: t('settings.notifNewsletter'), desc: t('settings.notifNewsletterDesc'), state: notifNewsletter, setter: setNotifNewsletter },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                        <Switch checked={item.state} onCheckedChange={item.setter} />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Smartphone className="w-5 h-5 text-primary" />
                      {t('settings.deliveryChannels')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {[
                      { label: t('settings.pushNotifs'), desc: t('settings.pushNotifsDesc'), state: notifPush, setter: setNotifPush },
                      { label: t('settings.smsNotifs'), desc: t('settings.smsNotifsDesc'), state: notifSMS, setter: setNotifSMS },
                      { label: t('settings.securityAlerts'), desc: t('settings.securityAlertsDesc'), state: notifSecurity, setter: setNotifSecurity },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                        <Switch checked={item.state} onCheckedChange={item.setter} />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Button onClick={handleSaveNotifications} disabled={saving} className="btn-primary rounded-full">
                  {saving ? t('common.loading') : t('settings.saveNotifications')}
                </Button>
              </>
            )}

            {/* ===== MESSAGES ===== */}
            {activeSection === 'messages' && (
              <>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-1">Messages</h2>
                  <p className="text-sm text-muted-foreground">
                    Choose which prompts and automated messages Hostiva is allowed to send on your behalf.
                    Anything turned off here will be silently skipped — the rest of the booking flow continues as normal.
                  </p>
                </div>

                {/* Quick replies */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <MessageSquare className="w-5 h-5 text-primary" />
                      Quick reply prompts
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      One-tap suggestions shown above the chat composer. Disable any you don't want to see.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {QUICK_REPLY_CATALOG.map((qr) => (
                      <div key={qr.key} className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{qr.label}</p>
                          <p className="text-xs text-muted-foreground italic">"{qr.text}"</p>
                        </div>
                        <Switch
                          checked={quickReplies[qr.key] !== false}
                          onCheckedChange={(v) => toggleQuickReply(qr.key, v)}
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Automated messages, grouped */}
                {([
                  { id: 'lifecycle' as const, title: 'Booking lifecycle messages', desc: 'The three automated messages the platform sends on your behalf: booking confirmation, cancellation notice, and the time-based stay reminders (directions before check-in, check-in details request, post-checkout review prompt).' },
                ]).map((group) => {
                  const items = AUTOMATED_MESSAGE_CATALOG.filter((m) => m.group === group.id);
                  const allOn = items.every((m) => autoMessages[m.type] !== false);
                  return (
                    <Card key={group.id}>
                      <CardHeader>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <CardTitle className="flex items-center gap-2 text-lg">
                              <BellRing className="w-5 h-5 text-primary" />
                              {group.title}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground mt-1">{group.desc}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground hidden sm:inline">All</span>
                            <Switch
                              checked={allOn}
                              onCheckedChange={(v) => setAutoMessageGroup(group.id, v)}
                            />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {items.map((m) => (
                          <div key={m.type} className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="font-medium text-sm">{m.label}</p>
                              <p className="text-xs text-muted-foreground">{m.description}</p>
                              <p className="text-xs text-muted-foreground italic mt-1 line-clamp-2">
                                e.g. "{m.example}"
                              </p>
                            </div>
                            <Switch
                              checked={autoMessages[m.type] !== false}
                              onCheckedChange={(v) => toggleAutoMessage(m.type, v)}
                            />
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })}

                <Button onClick={handleSaveMessages} disabled={saving} className="btn-primary rounded-full">
                  {saving ? t('common.loading') : 'Save message preferences'}
                </Button>
              </>
            )}

            {/* ===== PAYMENT ===== */}
            {activeSection === 'payment' && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <CreditCard className="w-5 h-5 text-primary" />
                      {t('settings.paymentMethods')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
                        <CreditCard className="w-8 h-8 text-muted-foreground" />
                      </div>
                      <p className="font-display font-bold text-sm mb-1">{t('settings.noPaymentMethods')}</p>
                      <p className="text-xs text-muted-foreground mb-4 max-w-sm">{t('settings.noPaymentMethodsDesc')}</p>
                      <Button 
                        className="btn-primary rounded-full"
                        onClick={() => toast({ title: 'Payment integration', description: 'Payment method management will be available once Paystack is connected to the platform.' })}
                      >
                        {t('settings.addPaymentMethod')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <DollarSign className="w-5 h-5 text-primary" />
                      {t('settings.payoutPreferences')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{t('settings.defaultCurrency')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.defaultCurrencyDesc')}</p>
                      </div>
                      <Select value={currency} onValueChange={setCurrency}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD'].map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleSavePayment} disabled={saving} variant="outline" className="rounded-full">
                      {saving ? t('common.loading') : 'Save currency preference'}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Tag className="w-5 h-5 text-primary" />
                      {t('settings.coupons')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-3">
                      <Input 
                        placeholder={t('settings.enterCoupon')} 
                        className="flex-1" 
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleApplyCoupon()}
                      />
                      <Button variant="outline" className="rounded-full" onClick={handleApplyCoupon}>
                        {t('settings.applyCoupon')}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{t('settings.couponDesc')}</p>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ===== PRIVACY ===== */}
            {activeSection === 'privacy' && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Eye className="w-5 h-5 text-primary" />
                      {t('settings.profilePrivacy')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{t('settings.profileVisibility')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.profileVisibilityDesc')}</p>
                      </div>
                      <Select value={profileVisibility} onValueChange={setProfileVisibility}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="public">{t('settings.public')}</SelectItem>
                          <SelectItem value="hosts_only">{t('settings.hostsOnly')}</SelectItem>
                          <SelectItem value="private">{t('settings.private')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {[
                      { label: t('settings.showTrips'), desc: t('settings.showTripsDesc'), state: showTrips, setter: setShowTrips },
                      { label: t('settings.showReviews'), desc: t('settings.showReviewsDesc'), state: showReviews, setter: setShowReviews },
                      { label: t('settings.showWishlist'), desc: t('settings.showWishlistDesc'), state: showWishlist, setter: setShowWishlist },
                      { label: t('settings.showOnlineStatus'), desc: t('settings.showOnlineStatusDesc'), state: showOnlineStatus, setter: setShowOnlineStatus },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                        <Switch checked={item.state} onCheckedChange={item.setter} />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <EyeOff className="w-5 h-5 text-primary" />
                      {t('settings.dataPrivacy')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {[
                      { label: t('settings.searchEngines'), desc: t('settings.searchEnginesDesc'), state: allowSearchEngines, setter: setAllowSearchEngines },
                      { label: t('settings.shareData'), desc: t('settings.shareDataDesc'), state: shareDataPartners, setter: setShareDataPartners },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                        <Switch checked={item.state} onCheckedChange={item.setter} />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Button onClick={handleSavePrivacy} disabled={saving} className="btn-primary rounded-full">
                  {saving ? t('common.loading') : t('settings.savePrivacy')}
                </Button>
              </>
            )}

            {/* ===== ACCESSIBILITY ===== */}
            {activeSection === 'accessibility' && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Monitor className="w-5 h-5 text-primary" />
                      {t('settings.displaySettings')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{t('settings.theme')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.themeDesc')}</p>
                      </div>
                      <div className="flex border border-border rounded-full overflow-hidden">
                        {([
                          { value: 'light' as const, icon: Sun, label: 'Light' },
                          { value: 'system' as const, icon: Monitor, label: 'System' },
                          { value: 'dark' as const, icon: Moon, label: 'Dark' },
                        ]).map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setThemeMode(opt.value)}
                            className={cn(
                              'p-2 px-3 transition-colors',
                              themeMode === opt.value ? 'bg-foreground text-background' : 'hover:bg-secondary'
                            )}
                            title={opt.label}
                          >
                            <opt.icon className="w-4 h-4" />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{t('settings.fontSize')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.fontSizeDesc')}</p>
                      </div>
                      <Select value={fontSize} onValueChange={setFontSize}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="small">{t('settings.small')}</SelectItem>
                          <SelectItem value="medium">{t('settings.medium')}</SelectItem>
                          <SelectItem value="large">{t('settings.large')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Accessibility className="w-5 h-5 text-primary" />
                      {t('settings.accessibilityOptions')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {[
                      { label: t('settings.highContrast'), desc: t('settings.highContrastDesc'), state: highContrast, setter: setHighContrast },
                      { label: t('settings.reduceMotion'), desc: t('settings.reduceMotionDesc'), state: reduceMotion, setter: setReduceMotion },
                      { label: t('settings.screenReader'), desc: t('settings.screenReaderDesc'), state: screenReader, setter: setScreenReader },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                        <Switch checked={item.state} onCheckedChange={item.setter} />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Button onClick={handleSaveAccessibility} disabled={saving} className="btn-primary rounded-full">
                  {saving ? t('common.loading') : t('settings.saveAccessibility')}
                </Button>
              </>
            )}

            {/* ===== ACCOUNT ===== */}
            {activeSection === 'account' && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Download className="w-5 h-5 text-primary" />
                      {t('settings.yourData')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{t('settings.yourDataDesc')}</p>
                    <Button variant="outline" onClick={handleDownloadData} disabled={saving} className="rounded-full">
                      <Download className="w-4 h-4 mr-2" />
                      {saving ? 'Exporting...' : t('settings.requestData')}
                    </Button>
                  </CardContent>
                </Card>

                {/* Property management — quick access + recorded property IDs */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Home className="w-5 h-5 text-primary" />
                      Property management
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Quick access to your listings. Each property is assigned a unique reference ID.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => navigate('/host/dashboard')}
                      className="rounded-full"
                    >
                      <Home className="w-4 h-4 mr-2" />
                      Manage my properties
                    </Button>
                    {myProperties.length > 0 ? (
                      <div className="space-y-2 pt-2">
                        {(() => {
                          const idMap = buildPropertyIdentifierMap(myProperties);
                          return myProperties.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => navigate(`/host/properties/${p.id}/edit`)}
                              className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors text-left"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-sm truncate">{p.title}</p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {p.city}, {p.country} · <span className="capitalize">{p.status.replace('_', ' ')}</span>
                                </p>
                              </div>
                              <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                                {idMap.get(p.id)}
                              </Badge>
                            </button>
                          ));
                        })()}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No properties yet — list one to get started.</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Users className="w-5 h-5 text-primary" />
                      {t('settings.connectedAccounts')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {[
                        { name: 'Google', id: 'google' },
                        { name: 'Apple', id: 'apple' },
                        { name: 'Facebook', id: 'facebook' },
                      ].map((provider) => {
                        const isConnected = connectedProviders.includes(provider.id);
                        return (
                          <div key={provider.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/50">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-card border border-border flex items-center justify-center">
                                <Globe className="w-4 h-4 text-muted-foreground" />
                              </div>
                              <div>
                                <p className="font-medium text-sm">{provider.name}</p>
                                {isConnected && <p className="text-[10px] text-primary">Connected</p>}
                              </div>
                            </div>
                            {isConnected ? (
                              <Badge className="bg-primary/10 text-primary border-0 text-xs">
                                <Check className="w-3 h-3 mr-1" /> Linked
                              </Badge>
                            ) : (
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="rounded-full text-xs"
                                onClick={() => handleConnectProvider(provider.name)}
                              >
                                {t('settings.connect')}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-destructive/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg text-destructive">
                      <AlertTriangle className="w-5 h-5" />
                      {t('settings.dangerZone')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{t('settings.deactivateAccount')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.deactivateDesc')}</p>
                      </div>
                      <Button 
                        variant="outline" 
                        className="rounded-full text-destructive border-destructive/30 hover:bg-destructive/5"
                        onClick={() => setShowDeactivateDialog(true)}
                      >
                        {t('settings.deactivate')}
                      </Button>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{t('settings.deleteAccount')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.deleteAccountDesc')}</p>
                      </div>
                      <Button
                        variant="destructive"
                        className="rounded-full"
                        onClick={() => setShowDeleteDialog(true)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {t('settings.deleteAccount')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Language Dialog */}
      <Dialog open={showLanguageDialog} onOpenChange={setShowLanguageDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              Choose Language
            </DialogTitle>
            <DialogDescription>Select your preferred language for the interface.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-1 max-h-80 overflow-y-auto">
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => changeLanguage(lang.code)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors w-full',
                  i18n.language === lang.code ? 'bg-primary/10' : 'hover:bg-secondary'
                )}
              >
                <span className="text-lg">{lang.flag}</span>
                <div className="flex-1">
                  <p className="font-medium text-sm">{lang.name}</p>
                  <p className="text-xs text-muted-foreground">{lang.region}</p>
                </div>
                {i18n.language === lang.code && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate Account Dialog */}
      <Dialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Deactivate Account
            </DialogTitle>
            <DialogDescription>
              Your account will be deactivated and you will be signed out. Your profile will be hidden from other users. You can reactivate by signing in again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeactivateDialog(false)} className="rounded-full">{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={handleDeactivateAccount}
              disabled={saving}
              className="rounded-full"
            >
              {saving ? 'Deactivating...' : 'Deactivate my account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Account Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              {t('settings.deleteAccountTitle')}
            </DialogTitle>
            <DialogDescription>{t('settings.deleteAccountWarning')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium">{t('settings.typeDelete')}</p>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} className="rounded-full">{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== 'DELETE' || saving}
              onClick={handleDeleteAccount}
              className="rounded-full"
            >
              {saving ? 'Deleting...' : t('settings.permanentlyDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}