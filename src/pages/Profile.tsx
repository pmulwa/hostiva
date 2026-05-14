import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/layout/Layout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  User, Star, Calendar, MapPin, Briefcase, Heart,
  Globe, Camera, Shield, Upload, FileCheck, Home, Mail, Phone,
  CreditCard, Building, MessageSquare, Award, TrendingUp, Sparkles,
  Zap, Crown, CheckCircle2, Info, Pencil, Trophy, Target, Flame,
  Loader2, X, FileText, KeyRound
} from 'lucide-react';
import { format } from 'date-fns';
import VerificationBadges from '@/components/VerificationBadges';

const INTERESTS = [
  'Photography', 'Cooking', 'Art', 'Music', 'Sports', 'Reading',
  'Hiking', 'Swimming', 'Yoga', 'Wine tasting', 'Architecture', 'History',
  'Surfing', 'Gardening', 'Dancing', 'Gaming', 'Travel', 'Food'
];

const DIETARY_OPTIONS = [
  'Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'Halal', 'Kosher', 'Nut-free'
];

const ACCESSIBILITY_NEEDS = [
  'Wheelchair accessible', 'Step-free access', 'Wide doorways',
  'Accessible bathroom', 'Visual aids', 'Hearing assistance'
];

const TRAVEL_STYLES = [
  'Budget', 'Mid-range', 'Luxury', 'Adventure', 'Relaxation', 'Cultural', 'Eco-friendly'
];

type BadgeType = {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  earned: boolean;
};

type Verification = {
  id: string;
  verification_type: string;
  status: string;
  data: Record<string, unknown>;
  verified_at: string | null;
};

export default function Profile() {
  const { user, profile, isHost, isLoading, refreshProfile } = useAuth();
  const [extraFieldsLoaded, setExtraFieldsLoaded] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightMissing = searchParams.get('missing') === '1';
  const missingBannerRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState('about');
  const [isEditing, setIsEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Separate ref for the profile picture upload (kept distinct from the
  // government-ID file picker which also uses `fileInputRef`).
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Track host/guest "view mode" — a host user can flip to guest mode via the
  // header. When in guest mode we show the GUEST profile layout even if the
  // account technically has the host role.
  const [isHostMode, setIsHostMode] = useState<boolean>(() => {
    return isHost && localStorage.getItem('hostly_mode') === 'host';
  });
  useEffect(() => {
    const sync = () => {
      setIsHostMode(isHost && localStorage.getItem('hostly_mode') === 'host');
    };
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
    };
  }, [isHost]);

  // Guest-only "About You" inline editor
  const [isEditingGuestAbout, setIsEditingGuestAbout] = useState(false);

  // Profile form state — fields below are MANDATORY
  const [bio, setBio] = useState(profile?.bio || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [location, setLocation] = useState(profile?.location || ''); // = Hometown
  const [pronouns, setPronouns] = useState('');
  const [propertyRelation, setPropertyRelation] = useState(''); // Owner / Manager / Co-host / Agent / Other
  const [funFact, setFunFact] = useState('');
  const [languages, setLanguages] = useState('');
  const [travelStyle, setTravelStyle] = useState('');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [selectedDietary, setSelectedDietary] = useState<string[]>([]);
  const [selectedAccessibility, setSelectedAccessibility] = useState<string[]>([]);
  const [isEditingPrefs, setIsEditingPrefs] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // Persistence indicator for the guest auto-save flow ("Saving…" / "Saved")
  const [prefsAutoSaveState, setPrefsAutoSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Stats
  const [stats, setStats] = useState({ reviews: 0, rating: 0, trips: 0, countries: 0 });
  const [bookingsCount, setBookingsCount] = useState(0);
  const [guestRating, setGuestRating] = useState<{ avg: number; count: number } | null>(null);
  const [hostRating, setHostRating] = useState<{ avg: number; count: number } | null>(null);
  // Host-side stats (only meaningful in host mode): trips this user has hosted
  // and the number of distinct countries the guests came from.
  const [hostedTripsCount, setHostedTripsCount] = useState(0);
  const [guestCountriesCount, setGuestCountriesCount] = useState(0);
  // First property created date — used to show "Hosting since <year>".
  const [hostingSince, setHostingSince] = useState<Date | null>(null);

  // Verifications
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loadingVerifications, setLoadingVerifications] = useState(true);

  // Dialog states
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [workEmailDialogOpen, setWorkEmailDialogOpen] = useState(false);
  const [idDialogOpen, setIdDialogOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [selectedCountry, setSelectedCountry] = useState({ code: 'KE', dial: '+254', flag: '🇰🇪', name: 'Kenya' });
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);

  const countries = [
    { code: 'KE', dial: '+254', flag: '🇰🇪', name: 'Kenya' },
    { code: 'US', dial: '+1', flag: '🇺🇸', name: 'United States' },
    { code: 'GB', dial: '+44', flag: '🇬🇧', name: 'United Kingdom' },
    { code: 'AF', dial: '+93', flag: '🇦🇫', name: 'Afghanistan' },
    { code: 'AL', dial: '+355', flag: '🇦🇱', name: 'Albania' },
    { code: 'DZ', dial: '+213', flag: '🇩🇿', name: 'Algeria' },
    { code: 'AD', dial: '+376', flag: '🇦🇩', name: 'Andorra' },
    { code: 'AO', dial: '+244', flag: '🇦🇴', name: 'Angola' },
    { code: 'AG', dial: '+1268', flag: '🇦🇬', name: 'Antigua and Barbuda' },
    { code: 'AR', dial: '+54', flag: '🇦🇷', name: 'Argentina' },
    { code: 'AM', dial: '+374', flag: '🇦🇲', name: 'Armenia' },
    { code: 'AU', dial: '+61', flag: '🇦🇺', name: 'Australia' },
    { code: 'AT', dial: '+43', flag: '🇦🇹', name: 'Austria' },
    { code: 'AZ', dial: '+994', flag: '🇦🇿', name: 'Azerbaijan' },
    { code: 'BS', dial: '+1242', flag: '🇧🇸', name: 'Bahamas' },
    { code: 'BH', dial: '+973', flag: '🇧🇭', name: 'Bahrain' },
    { code: 'BD', dial: '+880', flag: '🇧🇩', name: 'Bangladesh' },
    { code: 'BB', dial: '+1246', flag: '🇧🇧', name: 'Barbados' },
    { code: 'BY', dial: '+375', flag: '🇧🇾', name: 'Belarus' },
    { code: 'BE', dial: '+32', flag: '🇧🇪', name: 'Belgium' },
    { code: 'BZ', dial: '+501', flag: '🇧🇿', name: 'Belize' },
    { code: 'BJ', dial: '+229', flag: '🇧🇯', name: 'Benin' },
    { code: 'BT', dial: '+975', flag: '🇧🇹', name: 'Bhutan' },
    { code: 'BO', dial: '+591', flag: '🇧🇴', name: 'Bolivia' },
    { code: 'BA', dial: '+387', flag: '🇧🇦', name: 'Bosnia and Herzegovina' },
    { code: 'BW', dial: '+267', flag: '🇧🇼', name: 'Botswana' },
    { code: 'BR', dial: '+55', flag: '🇧🇷', name: 'Brazil' },
    { code: 'BN', dial: '+673', flag: '🇧🇳', name: 'Brunei' },
    { code: 'BG', dial: '+359', flag: '🇧🇬', name: 'Bulgaria' },
    { code: 'BF', dial: '+226', flag: '🇧🇫', name: 'Burkina Faso' },
    { code: 'BI', dial: '+257', flag: '🇧🇮', name: 'Burundi' },
    { code: 'CV', dial: '+238', flag: '🇨🇻', name: 'Cabo Verde' },
    { code: 'KH', dial: '+855', flag: '🇰🇭', name: 'Cambodia' },
    { code: 'CM', dial: '+237', flag: '🇨🇲', name: 'Cameroon' },
    { code: 'CA', dial: '+1', flag: '🇨🇦', name: 'Canada' },
    { code: 'CF', dial: '+236', flag: '🇨🇫', name: 'Central African Republic' },
    { code: 'TD', dial: '+235', flag: '🇹🇩', name: 'Chad' },
    { code: 'CL', dial: '+56', flag: '🇨🇱', name: 'Chile' },
    { code: 'CN', dial: '+86', flag: '🇨🇳', name: 'China' },
    { code: 'CO', dial: '+57', flag: '🇨🇴', name: 'Colombia' },
    { code: 'KM', dial: '+269', flag: '🇰🇲', name: 'Comoros' },
    { code: 'CG', dial: '+242', flag: '🇨🇬', name: 'Congo' },
    { code: 'CD', dial: '+243', flag: '🇨🇩', name: 'Congo (DRC)' },
    { code: 'CR', dial: '+506', flag: '🇨🇷', name: 'Costa Rica' },
    { code: 'HR', dial: '+385', flag: '🇭🇷', name: 'Croatia' },
    { code: 'CU', dial: '+53', flag: '🇨🇺', name: 'Cuba' },
    { code: 'CY', dial: '+357', flag: '🇨🇾', name: 'Cyprus' },
    { code: 'CZ', dial: '+420', flag: '🇨🇿', name: 'Czech Republic' },
    { code: 'DK', dial: '+45', flag: '🇩🇰', name: 'Denmark' },
    { code: 'DJ', dial: '+253', flag: '🇩🇯', name: 'Djibouti' },
    { code: 'DM', dial: '+1767', flag: '🇩🇲', name: 'Dominica' },
    { code: 'DO', dial: '+1809', flag: '🇩🇴', name: 'Dominican Republic' },
    { code: 'EC', dial: '+593', flag: '🇪🇨', name: 'Ecuador' },
    { code: 'EG', dial: '+20', flag: '🇪🇬', name: 'Egypt' },
    { code: 'SV', dial: '+503', flag: '🇸🇻', name: 'El Salvador' },
    { code: 'GQ', dial: '+240', flag: '🇬🇶', name: 'Equatorial Guinea' },
    { code: 'ER', dial: '+291', flag: '🇪🇷', name: 'Eritrea' },
    { code: 'EE', dial: '+372', flag: '🇪🇪', name: 'Estonia' },
    { code: 'SZ', dial: '+268', flag: '🇸🇿', name: 'Eswatini' },
    { code: 'ET', dial: '+251', flag: '🇪🇹', name: 'Ethiopia' },
    { code: 'FJ', dial: '+679', flag: '🇫🇯', name: 'Fiji' },
    { code: 'FI', dial: '+358', flag: '🇫🇮', name: 'Finland' },
    { code: 'FR', dial: '+33', flag: '🇫🇷', name: 'France' },
    { code: 'GA', dial: '+241', flag: '🇬🇦', name: 'Gabon' },
    { code: 'GM', dial: '+220', flag: '🇬🇲', name: 'Gambia' },
    { code: 'GE', dial: '+995', flag: '🇬🇪', name: 'Georgia' },
    { code: 'DE', dial: '+49', flag: '🇩🇪', name: 'Germany' },
    { code: 'GH', dial: '+233', flag: '🇬🇭', name: 'Ghana' },
    { code: 'GR', dial: '+30', flag: '🇬🇷', name: 'Greece' },
    { code: 'GD', dial: '+1473', flag: '🇬🇩', name: 'Grenada' },
    { code: 'GT', dial: '+502', flag: '🇬🇹', name: 'Guatemala' },
    { code: 'GN', dial: '+224', flag: '🇬🇳', name: 'Guinea' },
    { code: 'GW', dial: '+245', flag: '🇬🇼', name: 'Guinea-Bissau' },
    { code: 'GY', dial: '+592', flag: '🇬🇾', name: 'Guyana' },
    { code: 'HT', dial: '+509', flag: '🇭🇹', name: 'Haiti' },
    { code: 'HN', dial: '+504', flag: '🇭🇳', name: 'Honduras' },
    { code: 'HU', dial: '+36', flag: '🇭🇺', name: 'Hungary' },
    { code: 'IS', dial: '+354', flag: '🇮🇸', name: 'Iceland' },
    { code: 'IN', dial: '+91', flag: '🇮🇳', name: 'India' },
    { code: 'ID', dial: '+62', flag: '🇮🇩', name: 'Indonesia' },
    { code: 'IR', dial: '+98', flag: '🇮🇷', name: 'Iran' },
    { code: 'IQ', dial: '+964', flag: '🇮🇶', name: 'Iraq' },
    { code: 'IE', dial: '+353', flag: '🇮🇪', name: 'Ireland' },
    { code: 'IL', dial: '+972', flag: '🇮🇱', name: 'Israel' },
    { code: 'IT', dial: '+39', flag: '🇮🇹', name: 'Italy' },
    { code: 'JM', dial: '+1876', flag: '🇯🇲', name: 'Jamaica' },
    { code: 'JP', dial: '+81', flag: '🇯🇵', name: 'Japan' },
    { code: 'JO', dial: '+962', flag: '🇯🇴', name: 'Jordan' },
    { code: 'KZ', dial: '+7', flag: '🇰🇿', name: 'Kazakhstan' },
    { code: 'KI', dial: '+686', flag: '🇰🇮', name: 'Kiribati' },
    { code: 'KW', dial: '+965', flag: '🇰🇼', name: 'Kuwait' },
    { code: 'KG', dial: '+996', flag: '🇰🇬', name: 'Kyrgyzstan' },
    { code: 'LA', dial: '+856', flag: '🇱🇦', name: 'Laos' },
    { code: 'LV', dial: '+371', flag: '🇱🇻', name: 'Latvia' },
    { code: 'LB', dial: '+961', flag: '🇱🇧', name: 'Lebanon' },
    { code: 'LS', dial: '+266', flag: '🇱🇸', name: 'Lesotho' },
    { code: 'LR', dial: '+231', flag: '🇱🇷', name: 'Liberia' },
    { code: 'LY', dial: '+218', flag: '🇱🇾', name: 'Libya' },
    { code: 'LI', dial: '+423', flag: '🇱🇮', name: 'Liechtenstein' },
    { code: 'LT', dial: '+370', flag: '🇱🇹', name: 'Lithuania' },
    { code: 'LU', dial: '+352', flag: '🇱🇺', name: 'Luxembourg' },
    { code: 'MG', dial: '+261', flag: '🇲🇬', name: 'Madagascar' },
    { code: 'MW', dial: '+265', flag: '🇲🇼', name: 'Malawi' },
    { code: 'MY', dial: '+60', flag: '🇲🇾', name: 'Malaysia' },
    { code: 'MV', dial: '+960', flag: '🇲🇻', name: 'Maldives' },
    { code: 'ML', dial: '+223', flag: '🇲🇱', name: 'Mali' },
    { code: 'MT', dial: '+356', flag: '🇲🇹', name: 'Malta' },
    { code: 'MH', dial: '+692', flag: '🇲🇭', name: 'Marshall Islands' },
    { code: 'MR', dial: '+222', flag: '🇲🇷', name: 'Mauritania' },
    { code: 'MU', dial: '+230', flag: '🇲🇺', name: 'Mauritius' },
    { code: 'MX', dial: '+52', flag: '🇲🇽', name: 'Mexico' },
    { code: 'FM', dial: '+691', flag: '🇫🇲', name: 'Micronesia' },
    { code: 'MD', dial: '+373', flag: '🇲🇩', name: 'Moldova' },
    { code: 'MC', dial: '+377', flag: '🇲🇨', name: 'Monaco' },
    { code: 'MN', dial: '+976', flag: '🇲🇳', name: 'Mongolia' },
    { code: 'ME', dial: '+382', flag: '🇲🇪', name: 'Montenegro' },
    { code: 'MA', dial: '+212', flag: '🇲🇦', name: 'Morocco' },
    { code: 'MZ', dial: '+258', flag: '🇲🇿', name: 'Mozambique' },
    { code: 'MM', dial: '+95', flag: '🇲🇲', name: 'Myanmar' },
    { code: 'NA', dial: '+264', flag: '🇳🇦', name: 'Namibia' },
    { code: 'NR', dial: '+674', flag: '🇳🇷', name: 'Nauru' },
    { code: 'NP', dial: '+977', flag: '🇳🇵', name: 'Nepal' },
    { code: 'NL', dial: '+31', flag: '🇳🇱', name: 'Netherlands' },
    { code: 'NZ', dial: '+64', flag: '🇳🇿', name: 'New Zealand' },
    { code: 'NI', dial: '+505', flag: '🇳🇮', name: 'Nicaragua' },
    { code: 'NE', dial: '+227', flag: '🇳🇪', name: 'Niger' },
    { code: 'NG', dial: '+234', flag: '🇳🇬', name: 'Nigeria' },
    { code: 'NO', dial: '+47', flag: '🇳🇴', name: 'Norway' },
    { code: 'OM', dial: '+968', flag: '🇴🇲', name: 'Oman' },
    { code: 'PK', dial: '+92', flag: '🇵🇰', name: 'Pakistan' },
    { code: 'PW', dial: '+680', flag: '🇵🇼', name: 'Palau' },
    { code: 'PA', dial: '+507', flag: '🇵🇦', name: 'Panama' },
    { code: 'PG', dial: '+675', flag: '🇵🇬', name: 'Papua New Guinea' },
    { code: 'PY', dial: '+595', flag: '🇵🇾', name: 'Paraguay' },
    { code: 'PE', dial: '+51', flag: '🇵🇪', name: 'Peru' },
    { code: 'PH', dial: '+63', flag: '🇵🇭', name: 'Philippines' },
    { code: 'PL', dial: '+48', flag: '🇵🇱', name: 'Poland' },
    { code: 'PT', dial: '+351', flag: '🇵🇹', name: 'Portugal' },
    { code: 'QA', dial: '+974', flag: '🇶🇦', name: 'Qatar' },
    { code: 'RO', dial: '+40', flag: '🇷🇴', name: 'Romania' },
    { code: 'RU', dial: '+7', flag: '🇷🇺', name: 'Russia' },
    { code: 'RW', dial: '+250', flag: '🇷🇼', name: 'Rwanda' },
    { code: 'KN', dial: '+1869', flag: '🇰🇳', name: 'Saint Kitts and Nevis' },
    { code: 'LC', dial: '+1758', flag: '🇱🇨', name: 'Saint Lucia' },
    { code: 'VC', dial: '+1784', flag: '🇻🇨', name: 'Saint Vincent and the Grenadines' },
    { code: 'WS', dial: '+685', flag: '🇼🇸', name: 'Samoa' },
    { code: 'SM', dial: '+378', flag: '🇸🇲', name: 'San Marino' },
    { code: 'ST', dial: '+239', flag: '🇸🇹', name: 'Sao Tome and Principe' },
    { code: 'SA', dial: '+966', flag: '🇸🇦', name: 'Saudi Arabia' },
    { code: 'SN', dial: '+221', flag: '🇸🇳', name: 'Senegal' },
    { code: 'RS', dial: '+381', flag: '🇷🇸', name: 'Serbia' },
    { code: 'SC', dial: '+248', flag: '🇸🇨', name: 'Seychelles' },
    { code: 'SL', dial: '+232', flag: '🇸🇱', name: 'Sierra Leone' },
    { code: 'SG', dial: '+65', flag: '🇸🇬', name: 'Singapore' },
    { code: 'SK', dial: '+421', flag: '🇸🇰', name: 'Slovakia' },
    { code: 'SI', dial: '+386', flag: '🇸🇮', name: 'Slovenia' },
    { code: 'SB', dial: '+677', flag: '🇸🇧', name: 'Solomon Islands' },
    { code: 'SO', dial: '+252', flag: '🇸🇴', name: 'Somalia' },
    { code: 'ZA', dial: '+27', flag: '🇿🇦', name: 'South Africa' },
    { code: 'SS', dial: '+211', flag: '🇸🇸', name: 'South Sudan' },
    { code: 'ES', dial: '+34', flag: '🇪🇸', name: 'Spain' },
    { code: 'LK', dial: '+94', flag: '🇱🇰', name: 'Sri Lanka' },
    { code: 'SD', dial: '+249', flag: '🇸🇩', name: 'Sudan' },
    { code: 'SR', dial: '+597', flag: '🇸🇷', name: 'Suriname' },
    { code: 'SE', dial: '+46', flag: '🇸🇪', name: 'Sweden' },
    { code: 'CH', dial: '+41', flag: '🇨🇭', name: 'Switzerland' },
    { code: 'SY', dial: '+963', flag: '🇸🇾', name: 'Syria' },
    { code: 'TW', dial: '+886', flag: '🇹🇼', name: 'Taiwan' },
    { code: 'TJ', dial: '+992', flag: '🇹🇯', name: 'Tajikistan' },
    { code: 'TZ', dial: '+255', flag: '🇹🇿', name: 'Tanzania' },
    { code: 'TH', dial: '+66', flag: '🇹🇭', name: 'Thailand' },
    { code: 'TL', dial: '+670', flag: '🇹🇱', name: 'Timor-Leste' },
    { code: 'TG', dial: '+228', flag: '🇹🇬', name: 'Togo' },
    { code: 'TO', dial: '+676', flag: '🇹🇴', name: 'Tonga' },
    { code: 'TT', dial: '+1868', flag: '🇹🇹', name: 'Trinidad and Tobago' },
    { code: 'TN', dial: '+216', flag: '🇹🇳', name: 'Tunisia' },
    { code: 'TR', dial: '+90', flag: '🇹🇷', name: 'Turkey' },
    { code: 'TM', dial: '+993', flag: '🇹🇲', name: 'Turkmenistan' },
    { code: 'TV', dial: '+688', flag: '🇹🇻', name: 'Tuvalu' },
    { code: 'UG', dial: '+256', flag: '🇺🇬', name: 'Uganda' },
    { code: 'UA', dial: '+380', flag: '🇺🇦', name: 'Ukraine' },
    { code: 'AE', dial: '+971', flag: '🇦🇪', name: 'United Arab Emirates' },
    { code: 'UY', dial: '+598', flag: '🇺🇾', name: 'Uruguay' },
    { code: 'UZ', dial: '+998', flag: '🇺🇿', name: 'Uzbekistan' },
    { code: 'VU', dial: '+678', flag: '🇻🇺', name: 'Vanuatu' },
    { code: 'VE', dial: '+58', flag: '🇻🇪', name: 'Venezuela' },
    { code: 'VN', dial: '+84', flag: '🇻🇳', name: 'Vietnam' },
    { code: 'YE', dial: '+967', flag: '🇾🇪', name: 'Yemen' },
    { code: 'ZM', dial: '+260', flag: '🇿🇲', name: 'Zambia' },
    { code: 'ZW', dial: '+263', flag: '🇿🇼', name: 'Zimbabwe' },
  ];

  const getFullPhone = () => selectedCountry.dial + phoneInput.replace(/^0+/, '').replace(/\s/g, '');
  const [countryCode, setCountryCode] = useState('+254'); // Default Kenya

  const [countrySearch, setCountrySearch] = useState('');
  const COUNTRY_CODES = [
    { code: '+254', flag: '🇰🇪', name: 'Kenya' },
    { code: '+1', flag: '🇺🇸', name: 'United States' },
    { code: '+44', flag: '🇬🇧', name: 'United Kingdom' },
    { code: '+93', flag: '🇦🇫', name: 'Afghanistan' },
    { code: '+355', flag: '🇦🇱', name: 'Albania' },
    { code: '+213', flag: '🇩🇿', name: 'Algeria' },
    { code: '+376', flag: '🇦🇩', name: 'Andorra' },
    { code: '+244', flag: '🇦🇴', name: 'Angola' },
    { code: '+1268', flag: '🇦🇬', name: 'Antigua and Barbuda' },
    { code: '+54', flag: '🇦🇷', name: 'Argentina' },
    { code: '+374', flag: '🇦🇲', name: 'Armenia' },
    { code: '+61', flag: '🇦🇺', name: 'Australia' },
    { code: '+43', flag: '🇦🇹', name: 'Austria' },
    { code: '+994', flag: '🇦🇿', name: 'Azerbaijan' },
    { code: '+1242', flag: '🇧🇸', name: 'Bahamas' },
    { code: '+973', flag: '🇧🇭', name: 'Bahrain' },
    { code: '+880', flag: '🇧🇩', name: 'Bangladesh' },
    { code: '+1246', flag: '🇧🇧', name: 'Barbados' },
    { code: '+375', flag: '🇧🇾', name: 'Belarus' },
    { code: '+32', flag: '🇧🇪', name: 'Belgium' },
    { code: '+501', flag: '🇧🇿', name: 'Belize' },
    { code: '+229', flag: '🇧🇯', name: 'Benin' },
    { code: '+975', flag: '🇧🇹', name: 'Bhutan' },
    { code: '+591', flag: '🇧🇴', name: 'Bolivia' },
    { code: '+387', flag: '🇧🇦', name: 'Bosnia and Herzegovina' },
    { code: '+267', flag: '🇧🇼', name: 'Botswana' },
    { code: '+55', flag: '🇧🇷', name: 'Brazil' },
    { code: '+673', flag: '🇧🇳', name: 'Brunei' },
    { code: '+359', flag: '🇧🇬', name: 'Bulgaria' },
    { code: '+226', flag: '🇧🇫', name: 'Burkina Faso' },
    { code: '+257', flag: '🇧🇮', name: 'Burundi' },
    { code: '+238', flag: '🇨🇻', name: 'Cabo Verde' },
    { code: '+855', flag: '🇰🇭', name: 'Cambodia' },
    { code: '+237', flag: '🇨🇲', name: 'Cameroon' },
    { code: '+1', flag: '🇨🇦', name: 'Canada' },
    { code: '+236', flag: '🇨🇫', name: 'Central African Republic' },
    { code: '+235', flag: '🇹🇩', name: 'Chad' },
    { code: '+56', flag: '🇨🇱', name: 'Chile' },
    { code: '+86', flag: '🇨🇳', name: 'China' },
    { code: '+57', flag: '🇨🇴', name: 'Colombia' },
    { code: '+269', flag: '🇰🇲', name: 'Comoros' },
    { code: '+242', flag: '🇨🇬', name: 'Congo' },
    { code: '+243', flag: '🇨🇩', name: 'Congo (DRC)' },
    { code: '+506', flag: '🇨🇷', name: 'Costa Rica' },
    { code: '+385', flag: '🇭🇷', name: 'Croatia' },
    { code: '+53', flag: '🇨🇺', name: 'Cuba' },
    { code: '+357', flag: '🇨🇾', name: 'Cyprus' },
    { code: '+420', flag: '🇨🇿', name: 'Czech Republic' },
    { code: '+45', flag: '🇩🇰', name: 'Denmark' },
    { code: '+253', flag: '🇩🇯', name: 'Djibouti' },
    { code: '+1767', flag: '🇩🇲', name: 'Dominica' },
    { code: '+1809', flag: '🇩🇴', name: 'Dominican Republic' },
    { code: '+593', flag: '🇪🇨', name: 'Ecuador' },
    { code: '+20', flag: '🇪🇬', name: 'Egypt' },
    { code: '+503', flag: '🇸🇻', name: 'El Salvador' },
    { code: '+240', flag: '🇬🇶', name: 'Equatorial Guinea' },
    { code: '+291', flag: '🇪🇷', name: 'Eritrea' },
    { code: '+372', flag: '🇪🇪', name: 'Estonia' },
    { code: '+268', flag: '🇸🇿', name: 'Eswatini' },
    { code: '+251', flag: '🇪🇹', name: 'Ethiopia' },
    { code: '+679', flag: '🇫🇯', name: 'Fiji' },
    { code: '+358', flag: '🇫🇮', name: 'Finland' },
    { code: '+33', flag: '🇫🇷', name: 'France' },
    { code: '+241', flag: '🇬🇦', name: 'Gabon' },
    { code: '+220', flag: '🇬🇲', name: 'Gambia' },
    { code: '+995', flag: '🇬🇪', name: 'Georgia' },
    { code: '+49', flag: '🇩🇪', name: 'Germany' },
    { code: '+233', flag: '🇬🇭', name: 'Ghana' },
    { code: '+30', flag: '🇬🇷', name: 'Greece' },
    { code: '+1473', flag: '🇬🇩', name: 'Grenada' },
    { code: '+502', flag: '🇬🇹', name: 'Guatemala' },
    { code: '+224', flag: '🇬🇳', name: 'Guinea' },
    { code: '+245', flag: '🇬🇼', name: 'Guinea-Bissau' },
    { code: '+592', flag: '🇬🇾', name: 'Guyana' },
    { code: '+509', flag: '🇭🇹', name: 'Haiti' },
    { code: '+504', flag: '🇭🇳', name: 'Honduras' },
    { code: '+36', flag: '🇭🇺', name: 'Hungary' },
    { code: '+354', flag: '🇮🇸', name: 'Iceland' },
    { code: '+91', flag: '🇮🇳', name: 'India' },
    { code: '+62', flag: '🇮🇩', name: 'Indonesia' },
    { code: '+98', flag: '🇮🇷', name: 'Iran' },
    { code: '+964', flag: '🇮🇶', name: 'Iraq' },
    { code: '+353', flag: '🇮🇪', name: 'Ireland' },
    { code: '+972', flag: '🇮🇱', name: 'Israel' },
    { code: '+39', flag: '🇮🇹', name: 'Italy' },
    { code: '+1876', flag: '🇯🇲', name: 'Jamaica' },
    { code: '+81', flag: '🇯🇵', name: 'Japan' },
    { code: '+962', flag: '🇯🇴', name: 'Jordan' },
    { code: '+7', flag: '🇰🇿', name: 'Kazakhstan' },
    { code: '+686', flag: '🇰🇮', name: 'Kiribati' },
    { code: '+965', flag: '🇰🇼', name: 'Kuwait' },
    { code: '+996', flag: '🇰🇬', name: 'Kyrgyzstan' },
    { code: '+856', flag: '🇱🇦', name: 'Laos' },
    { code: '+371', flag: '🇱🇻', name: 'Latvia' },
    { code: '+961', flag: '🇱🇧', name: 'Lebanon' },
    { code: '+266', flag: '🇱🇸', name: 'Lesotho' },
    { code: '+231', flag: '🇱🇷', name: 'Liberia' },
    { code: '+218', flag: '🇱🇾', name: 'Libya' },
    { code: '+423', flag: '🇱🇮', name: 'Liechtenstein' },
    { code: '+370', flag: '🇱🇹', name: 'Lithuania' },
    { code: '+352', flag: '🇱🇺', name: 'Luxembourg' },
    { code: '+261', flag: '🇲🇬', name: 'Madagascar' },
    { code: '+265', flag: '🇲🇼', name: 'Malawi' },
    { code: '+60', flag: '🇲🇾', name: 'Malaysia' },
    { code: '+960', flag: '🇲🇻', name: 'Maldives' },
    { code: '+223', flag: '🇲🇱', name: 'Mali' },
    { code: '+356', flag: '🇲🇹', name: 'Malta' },
    { code: '+692', flag: '🇲🇭', name: 'Marshall Islands' },
    { code: '+222', flag: '🇲🇷', name: 'Mauritania' },
    { code: '+230', flag: '🇲🇺', name: 'Mauritius' },
    { code: '+52', flag: '🇲🇽', name: 'Mexico' },
    { code: '+691', flag: '🇫🇲', name: 'Micronesia' },
    { code: '+373', flag: '🇲🇩', name: 'Moldova' },
    { code: '+377', flag: '🇲🇨', name: 'Monaco' },
    { code: '+976', flag: '🇲🇳', name: 'Mongolia' },
    { code: '+382', flag: '🇲🇪', name: 'Montenegro' },
    { code: '+212', flag: '🇲🇦', name: 'Morocco' },
    { code: '+258', flag: '🇲🇿', name: 'Mozambique' },
    { code: '+95', flag: '🇲🇲', name: 'Myanmar' },
    { code: '+264', flag: '🇳🇦', name: 'Namibia' },
    { code: '+674', flag: '🇳🇷', name: 'Nauru' },
    { code: '+977', flag: '🇳🇵', name: 'Nepal' },
    { code: '+31', flag: '🇳🇱', name: 'Netherlands' },
    { code: '+64', flag: '🇳🇿', name: 'New Zealand' },
    { code: '+505', flag: '🇳🇮', name: 'Nicaragua' },
    { code: '+227', flag: '🇳🇪', name: 'Niger' },
    { code: '+234', flag: '🇳🇬', name: 'Nigeria' },
    { code: '+47', flag: '🇳🇴', name: 'Norway' },
    { code: '+968', flag: '🇴🇲', name: 'Oman' },
    { code: '+92', flag: '🇵🇰', name: 'Pakistan' },
    { code: '+680', flag: '🇵🇼', name: 'Palau' },
    { code: '+507', flag: '🇵🇦', name: 'Panama' },
    { code: '+675', flag: '🇵🇬', name: 'Papua New Guinea' },
    { code: '+595', flag: '🇵🇾', name: 'Paraguay' },
    { code: '+51', flag: '🇵🇪', name: 'Peru' },
    { code: '+63', flag: '🇵🇭', name: 'Philippines' },
    { code: '+48', flag: '🇵🇱', name: 'Poland' },
    { code: '+351', flag: '🇵🇹', name: 'Portugal' },
    { code: '+974', flag: '🇶🇦', name: 'Qatar' },
    { code: '+40', flag: '🇷🇴', name: 'Romania' },
    { code: '+7', flag: '🇷🇺', name: 'Russia' },
    { code: '+250', flag: '🇷🇼', name: 'Rwanda' },
    { code: '+1869', flag: '🇰🇳', name: 'Saint Kitts and Nevis' },
    { code: '+1758', flag: '🇱🇨', name: 'Saint Lucia' },
    { code: '+1784', flag: '🇻🇨', name: 'Saint Vincent and the Grenadines' },
    { code: '+685', flag: '🇼🇸', name: 'Samoa' },
    { code: '+378', flag: '🇸🇲', name: 'San Marino' },
    { code: '+239', flag: '🇸🇹', name: 'Sao Tome and Principe' },
    { code: '+966', flag: '🇸🇦', name: 'Saudi Arabia' },
    { code: '+221', flag: '🇸🇳', name: 'Senegal' },
    { code: '+381', flag: '🇷🇸', name: 'Serbia' },
    { code: '+248', flag: '🇸🇨', name: 'Seychelles' },
    { code: '+232', flag: '🇸🇱', name: 'Sierra Leone' },
    { code: '+65', flag: '🇸🇬', name: 'Singapore' },
    { code: '+421', flag: '🇸🇰', name: 'Slovakia' },
    { code: '+386', flag: '🇸🇮', name: 'Slovenia' },
    { code: '+677', flag: '🇸🇧', name: 'Solomon Islands' },
    { code: '+252', flag: '🇸🇴', name: 'Somalia' },
    { code: '+27', flag: '🇿🇦', name: 'South Africa' },
    { code: '+211', flag: '🇸🇸', name: 'South Sudan' },
    { code: '+34', flag: '🇪🇸', name: 'Spain' },
    { code: '+94', flag: '🇱🇰', name: 'Sri Lanka' },
    { code: '+249', flag: '🇸🇩', name: 'Sudan' },
    { code: '+597', flag: '🇸🇷', name: 'Suriname' },
    { code: '+46', flag: '🇸🇪', name: 'Sweden' },
    { code: '+41', flag: '🇨🇭', name: 'Switzerland' },
    { code: '+963', flag: '🇸🇾', name: 'Syria' },
    { code: '+886', flag: '🇹🇼', name: 'Taiwan' },
    { code: '+992', flag: '🇹🇯', name: 'Tajikistan' },
    { code: '+255', flag: '🇹🇿', name: 'Tanzania' },
    { code: '+66', flag: '🇹🇭', name: 'Thailand' },
    { code: '+670', flag: '🇹🇱', name: 'Timor-Leste' },
    { code: '+228', flag: '🇹🇬', name: 'Togo' },
    { code: '+676', flag: '🇹🇴', name: 'Tonga' },
    { code: '+1868', flag: '🇹🇹', name: 'Trinidad and Tobago' },
    { code: '+216', flag: '🇹🇳', name: 'Tunisia' },
    { code: '+90', flag: '🇹🇷', name: 'Turkey' },
    { code: '+993', flag: '🇹🇲', name: 'Turkmenistan' },
    { code: '+688', flag: '🇹🇻', name: 'Tuvalu' },
    { code: '+256', flag: '🇺🇬', name: 'Uganda' },
    { code: '+380', flag: '🇺🇦', name: 'Ukraine' },
    { code: '+971', flag: '🇦🇪', name: 'United Arab Emirates' },
    { code: '+598', flag: '🇺🇾', name: 'Uruguay' },
    { code: '+998', flag: '🇺🇿', name: 'Uzbekistan' },
    { code: '+678', flag: '🇻🇺', name: 'Vanuatu' },
    { code: '+58', flag: '🇻🇪', name: 'Venezuela' },
    { code: '+84', flag: '🇻🇳', name: 'Vietnam' },
    { code: '+967', flag: '🇾🇪', name: 'Yemen' },
    { code: '+260', flag: '🇿🇲', name: 'Zambia' },
    { code: '+263', flag: '🇿🇼', name: 'Zimbabwe' },
  ];
  const filteredCountries = COUNTRY_CODES.filter(c =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
    c.code.includes(countrySearch)
  );
  const [workEmailInput, setWorkEmailInput] = useState('');
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [idDocType, setIdDocType] = useState<'national_id' | 'drivers_license' | 'passport' | ''>('');
  const idBackFileRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);

  // OTP state — phone & email use a 6-digit code flow.
  // Codes are generated client-side and shown in a toast (dev mode) since no
  // SMS / email-OTP provider is wired up yet. Once entered & matched, the
  // verification status flips to "verified".
  const [phoneStep, setPhoneStep] = useState<'enter' | 'code'>('enter');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneCodeInput, setPhoneCodeInput] = useState('');
  const [emailStep, setEmailStep] = useState<'send' | 'code'>('send');
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeInput, setEmailCodeInput] = useState('');

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/auth');
    }
  }, [user, isLoading, navigate]);

  useEffect(() => {
    if (profile) {
      const p = profile as typeof profile & {
        pronouns?: string | null;
        property_relation?: string | null;
        fun_fact?: string | null;
        languages?: string | null;
      };
      setBio(p.bio || '');
      setPhone(p.phone || '');
      setLocation(p.location || '');
      setPronouns(p.pronouns || '');
      setPropertyRelation(p.property_relation || '');
      setFunFact(p.fun_fact || '');
      setLanguages(p.languages || '');
    }
  }, [profile]);

  // Fallback: if AuthContext profile is stale, load extra fields directly from DB
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('pronouns, property_relation, fun_fact, languages')
        .eq('user_id', user.id)
        .maybeSingle() as unknown as {
          data: {
            pronouns?: string | null;
            property_relation?: string | null;
            fun_fact?: string | null;
            languages?: string | null;
          } | null;
        };
      if (data) {
        if (data.pronouns) setPronouns(data.pronouns);
        if (data.property_relation) setPropertyRelation(data.property_relation);
        if (data.fun_fact) setFunFact(data.fun_fact);
        if (data.languages) setLanguages(data.languages);
      }
      setExtraFieldsLoaded(true);
    })();
  }, [user]);

  // Mandatory completion check
  // Mandatory completion check.
  // - Guests only need a verified mobile number (email is verified at sign-up).
  // - Hosts also need the full extended profile (bio, hometown, pronouns,
  //   property relation, fun fact, languages spoken).
  const missingFields = (() => {
    const m: string[] = [];
    if (isHost) {
      if (!bio.trim() || bio.trim().length < 20) m.push('Bio (min. 20 characters)');
      if (!location.trim()) m.push('Hometown');
      if (!pronouns.trim()) m.push('Pronouns');
      if (!propertyRelation.trim()) m.push('Relation to property');
      if (!funFact.trim()) m.push('Fun fact');
      if (!languages.trim()) m.push('Languages');
    }
    return m;
  })();
  const isProfileComplete = missingFields.length === 0;

  // Auto-open the editor ONLY if the profile is genuinely incomplete
  // after all data has loaded — prevents the Save button flashing on every refresh.
  useEffect(() => {
    // Only auto-open the editor for HOSTS who still have missing extended fields.
    // Guests don't have any required extended fields, so we never auto-open.
    if (isHostMode && profile && extraFieldsLoaded && !isProfileComplete && !isEditing) {
      setIsEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, extraFieldsLoaded, isHostMode]);

  useEffect(() => {
    if (user) {
      fetchStats();
      fetchVerifications();
      fetchPreferences();
    }
  }, [user]);

  const fetchPreferences = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle() as unknown as { data: Record<string, unknown> | null };
    if (data) {
      setTravelStyle((data.travel_style as string) || '');
      setSelectedInterests((data.interests as string[]) || []);
      setSelectedDietary((data.dietary_preferences as string[]) || []);
      setSelectedAccessibility((data.accessibility_needs as string[]) || []);
    }
    setPrefsLoaded(true);
  };

  // When arriving from the booking-gate modal (/profile?missing=1),
  // jump to the About tab, open the editor, scroll the missing-fields
  // banner into view and pulse it briefly so the user sees what to fix.
  useEffect(() => {
    if (!highlightMissing || !extraFieldsLoaded) return;
    setActiveTab('about');
    if (!isProfileComplete) setIsEditing(true);
    const id = window.setTimeout(() => {
      missingBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightMissing, extraFieldsLoaded, isProfileComplete]);

  const fetchStats = async () => {
    if (!user) return;
    const { count } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('guest_id', user.id)
      .eq('status', 'completed');
    setBookingsCount(count || 0);
    setStats(prev => ({ ...prev, trips: count || 0 }));

    // Fetch guest rating (host reviews about this user as guest)
    const { data: guestReviews } = await supabase
      .from('mutual_reviews')
      .select('overall_rating')
      .eq('guest_id', user.id)
      .eq('reviewer_type', 'host')
      .eq('is_published', true);
    if (guestReviews && guestReviews.length > 0) {
      const avg = guestReviews.reduce((s, r) => s + Number(r.overall_rating || 0), 0) / guestReviews.length;
      setGuestRating({ avg: Math.round(avg * 10) / 10, count: guestReviews.length });
    }

    // Fetch host rating (guest reviews about this user as host)
    const { data: hostReviews } = await supabase
      .from('mutual_reviews')
      .select('overall_rating')
      .eq('host_id', user.id)
      .eq('reviewer_type', 'guest')
      .eq('is_published', true);
    if (hostReviews && hostReviews.length > 0) {
      const avg = hostReviews.reduce((s, r) => s + Number(r.overall_rating || 0), 0) / hostReviews.length;
      setHostRating({ avg: Math.round(avg * 10) / 10, count: hostReviews.length });
    }

    // ===== HOST-SIDE STATS =====
    // Count completed bookings where current user is the HOST.
    const { count: hostedCount } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('host_id', user.id)
      .eq('status', 'completed');
    setHostedTripsCount(hostedCount || 0);

    // Count distinct countries of the guests this host has welcomed.
    // We pull the guest_id list, then look up profile.location and dedupe by
    // the trailing country segment ("City, Country" → "Country").
    const { data: hostedBookings } = await supabase
      .from('bookings')
      .select('guest_id')
      .eq('host_id', user.id)
      .eq('status', 'completed');
    const guestIds = Array.from(new Set((hostedBookings || []).map(b => b.guest_id))).filter(Boolean);
    if (guestIds.length > 0) {
      const { data: guestProfiles } = await supabase
        .from('profiles')
        .select('location')
        .in('user_id', guestIds);
      const countries = new Set(
        (guestProfiles || [])
          .map(p => (p.location || '').split(',').pop()?.trim().toLowerCase())
          .filter(Boolean) as string[]
      );
      setGuestCountriesCount(countries.size);
    } else {
      setGuestCountriesCount(0);
    }

    // "Hosting since" — earliest property created_at for this host.
    const { data: firstProp } = await supabase
      .from('properties')
      .select('created_at')
      .eq('host_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstProp?.created_at) setHostingSince(new Date(firstProp.created_at));
  };

  const fetchVerifications = async () => {
    if (!user) return;
    setLoadingVerifications(true);
    const { data, error } = await supabase
      .from('user_verifications')
      .select('*')
      .eq('user_id', user.id);

    if (!error && data) {
      setVerifications(data as unknown as Verification[]);
    }
    setLoadingVerifications(false);
  };

  const getVerification = (type: string): Verification | undefined => {
    return verifications.find(v => v.verification_type === type);
  };

  const isVerified = (type: string): boolean => {
    const v = getVerification(type);
    return v?.status === 'verified';
  };

  const isPending = (type: string): boolean => {
    const v = getVerification(type);
    return v?.status === 'pending';
  };

  const handleSaveProfile = async () => {
    if (!user) return;

    // Mandatory validation — only enforced for HOSTS. Guests can save freely.
    if (isHost) {
      if (!bio.trim() || bio.trim().length < 20) {
        toast.error('Please write a bio of at least 20 characters.');
        return;
      }
      const required: Array<[string, string]> = [
        [location.trim(), 'Hometown'],
        [pronouns.trim(), 'Pronouns'],
        [propertyRelation.trim(), 'Relation to property'],
        [funFact.trim(), 'Fun fact'],
        [languages.trim(), 'Languages I speak'],
      ];
      const missing = required.filter(([v]) => !v).map(([, label]) => label);
      if (missing.length) {
        toast.error(`Please fill required fields: ${missing.join(', ')}`);
        return;
      }
    }

    const updatePayload = {
      bio: bio.trim(),
      phone,
      location: location.trim(),
      pronouns: pronouns.trim(),
      property_relation: propertyRelation.trim(),
      fun_fact: funFact.trim(),
      languages: languages.trim(),
    } as unknown as Record<string, never>;

    const { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('user_id', user.id);

    if (error) {
      toast.error(t('common.error'));
      return;
    }

    // Refresh AuthContext so the saved values are reflected immediately and
    // the form does not flash back into edit mode after re-render / refresh.
    await refreshProfile();

    toast.success(t('common.success'));
    setIsEditing(false);
  };

  // ===== AVATAR UPLOAD =====
  // Uploads the chosen image to the public `avatars` bucket under the
  // user's folder, then writes the public URL onto profiles.avatar_url so
  // it persists across refreshes for both host and guest views.
  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file (JPG or PNG).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be smaller than 5MB.');
      return;
    }
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = pub.publicUrl;
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('user_id', user.id);
      if (updateError) throw updateError;
      await refreshProfile();
      toast.success('Profile photo updated');
    } catch (err) {
      console.error('[avatar] upload failed', err);
      toast.error('Could not upload photo. Please try again.');
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleSavePreferences = async () => {
    if (!user) return;
    const payload = {
      user_id: user.id,
      travel_style: travelStyle || null,
      interests: selectedInterests,
      dietary_preferences: selectedDietary,
      accessibility_needs: selectedAccessibility,
    } as unknown as Record<string, never>;

    const { error } = await (supabase as any)
      .from('user_preferences')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      toast.error(t('common.error'));
      return;
    }
    toast.success(t('profile.preferencesSaved'));
    setIsEditingPrefs(false);
  };

  // ===== AUTO-SAVE: Travel Style / Interests / Dietary / Accessibility =====
  // Once preferences have been hydrated from the DB we treat any in-memory
  // change as a write intent. We debounce by 700ms so rapid toggling doesn't
  // hammer the API, and we silently upsert without a toast — the inline
  // "Saved" indicator is sufficient feedback. Persists across refreshes
  // because we re-hydrate from `user_preferences` in fetchPreferences().
  useEffect(() => {
    if (!user || !prefsLoaded) return;
    setPrefsAutoSaveState('saving');
    const timer = window.setTimeout(async () => {
      const payload = {
        user_id: user.id,
        travel_style: travelStyle || null,
        interests: selectedInterests,
        dietary_preferences: selectedDietary,
        accessibility_needs: selectedAccessibility,
      } as unknown as Record<string, never>;
      const { error } = await (supabase as any)
        .from('user_preferences')
        .upsert(payload, { onConflict: 'user_id' });
      if (error) {
        console.error('[prefs] auto-save failed', error);
        setPrefsAutoSaveState('idle');
        return;
      }
      setPrefsAutoSaveState('saved');
      // Reset the "Saved" badge after a moment so it doesn't linger forever
      window.setTimeout(() => setPrefsAutoSaveState('idle'), 1500);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [user, prefsLoaded, travelStyle, selectedInterests, selectedDietary, selectedAccessibility]);

  const toggleInterest = (interest: string) => {
    setSelectedInterests(prev =>
      prev.includes(interest) ? prev.filter(i => i !== interest) : [...prev, interest]
    );
  };

  const toggleDietary = (option: string) => {
    setSelectedDietary(prev =>
      prev.includes(option) ? prev.filter(i => i !== option) : [...prev, option]
    );
  };

  // ===== VERIFICATION HANDLERS =====

  // ===== PHONE OTP FLOW =====
  // Step 1: user enters phone → we generate a 6-digit code (shown via toast in dev).
  // Step 2: user types the code → we compare and flip status to "verified" on match.
  const handleSendPhoneCode = async () => {
    if (!phoneInput.trim()) return;
    setSubmitting(true);
    try {
      const fullPhone = countryCode + phoneInput.trim();
    const { data, error } = await supabase.functions.invoke('send-sms-otp', {
        body: { phone: fullPhone, action: 'send' },
      });
      if (error || !data?.success) throw new Error(data?.message || 'Failed to send SMS');
      setPhoneCodeInput('');
      setPhoneStep('code');
      toast.success(`Verification code sent to ${countryCode}${phoneInput}`, {
        description: 'Please check your phone for the 6-digit code.',
        duration: 10000,
      });
    } catch (err: any) {
      toast.error(err.message || 'Failed to send verification code');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPhoneCode = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      const fullPhone = countryCode + phoneInput.trim();
      const { data, error } = await supabase.functions.invoke('send-sms-otp', {
        body: { phone: fullPhone, action: 'verify', code: phoneCodeInput.trim() },
      });
      if (error || !data?.success) throw new Error(data?.message || 'Incorrect code');
      setPhone(countryCode + phoneInput.trim());
      await fetchVerifications();
      setPhoneDialogOpen(false);
      setPhoneStep('enter');
      setPhoneInput('');
      setPhoneCodeInput('');
      toast.success(t('profile.phoneVerified'));
    } catch (err: any) {
      toast.error(err.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  // ===== EMAIL OTP RE-VERIFICATION =====
  const handleSendEmailCode = () => {
    if (!user?.email) return;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setEmailCode(code);
    setEmailCodeInput('');
    setEmailStep('code');
    toast.success(`Verification code sent to ${user.email}`, {
      description: `Your code is ${code}`,
      duration: 15000,
    });
  };

  const handleConfirmEmailCode = async () => {
    if (!user) return;
    if (emailCodeInput.trim() !== emailCode) {
      toast.error('Incorrect code. Please check your inbox and try again.');
      return;
    }
    setSubmitting(true);
    try {
      const existing = getVerification('email');
      if (existing) {
        await supabase.from('user_verifications')
          .update({ status: 'verified', data: { email: user.email } as unknown as Record<string, never>, verified_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase.from('user_verifications').insert({
          user_id: user.id,
          verification_type: 'email',
          status: 'verified',
          data: { email: user.email } as unknown as Record<string, never>,
          verified_at: new Date().toISOString(),
        });
      }
      await fetchVerifications();
      setEmailDialogOpen(false);
      setEmailStep('send');
      setEmailCode('');
      setEmailCodeInput('');
      toast.success('Email verified');
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitWorkEmail = async () => {
    if (!user || !workEmailInput.trim()) return;
    setSubmitting(true);

    try {
      const existing = getVerification('work_email');
      if (existing) {
        await supabase.from('user_verifications')
          .update({ status: 'verified', data: { work_email: workEmailInput.trim() } as unknown as Record<string, never>, verified_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase.from('user_verifications').insert({
          user_id: user.id,
          verification_type: 'work_email',
          status: 'verified',
          data: { work_email: workEmailInput.trim() } as unknown as Record<string, never>,
          verified_at: new Date().toISOString(),
        });
      }

      await fetchVerifications();
      setWorkEmailDialogOpen(false);
      setWorkEmailInput('');
      toast.success(t('profile.workEmailVerified'));
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitGovernmentID = async () => {
    if (!user || !idFile) return;
    if (!idDocType) {
      toast.error('Please select your ID document type.');
      return;
    }
    // National ID requires both front and back
    if (idDocType === 'national_id' && !idBackFile) {
      toast.error('Please upload BOTH the front and back of your National ID.');
      return;
    }
    setSubmitting(true);

    try {
      const frontExt = idFile.name.split('.').pop();
      const frontPath = `${user.id}/government-id-${idDocType}-front.${frontExt}`;

      const { error: uploadError } = await supabase.storage
        .from('verification-documents')
        .upload(frontPath, idFile, { upsert: true });

      if (uploadError) throw uploadError;

      let backPath: string | null = null;
      let backName: string | null = null;
      if (idDocType === 'national_id' && idBackFile) {
        const backExt = idBackFile.name.split('.').pop();
        backPath = `${user.id}/government-id-${idDocType}-back.${backExt}`;
        const { error: backErr } = await supabase.storage
          .from('verification-documents')
          .upload(backPath, idBackFile, { upsert: true });
        if (backErr) throw backErr;
        backName = idBackFile.name;
      }

      const docPayload = {
        file_path: frontPath,
        file_name: idFile.name,
        document_type: idDocType,
        ...(backPath ? { file_path_back: backPath, file_name_back: backName } : {}),
      } as unknown as Record<string, never>;

      const existing = getVerification('government_id');
      if (existing) {
        await supabase.from('user_verifications')
          .update({ status: 'pending', data: docPayload })
          .eq('id', existing.id);
      } else {
        await supabase.from('user_verifications').insert({
          user_id: user.id,
          verification_type: 'government_id',
          status: 'pending',
          data: docPayload,
        });
      }

      await fetchVerifications();
      setIdDialogOpen(false);
      setIdFile(null);
      setIdBackFile(null);
      setIdDocType('');
      toast.success(t('profile.idUploaded'));
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  // (Background-check & Property-standards uploads were removed —
  //  only Government ID is required for host verification now.)

  const joinDate = user?.created_at ? format(new Date(user.created_at), 'MMM yyyy') : '';

  // Host trust verifications: email + phone + government ID
  const hostVerifTypes = ['email', 'phone', 'government_id'] as const;
  const verifiedCount = hostVerifTypes.filter(type =>
    type === 'email' ? (isVerified('email') || !!user?.email_confirmed_at) : isVerified(type)
  ).length;
  const isFullyHostVerified = verifiedCount === hostVerifTypes.length;

  // Badges system
  const badges: BadgeType[] = [
    {
      id: 'new_member',
      label: t('profile.badges.newMember'),
      description: t('profile.badges.newMemberDesc'),
      icon: <Sparkles className="w-5 h-5" />,
      color: 'bg-blue-100 text-blue-700 border-blue-200',
      earned: true,
    },
    {
      id: 'verified',
      label: t('profile.badges.verified'),
      description: t('profile.badges.verifiedDesc'),
      icon: <CheckCircle2 className="w-5 h-5" />,
      color: 'bg-green-100 text-green-700 border-green-200',
      earned: profile?.is_verified || isVerified('government_id') || isVerified('phone'),
    },
    {
      id: 'superhost',
      label: t('profile.badges.superhost'),
      description: t('profile.badges.superhostDesc'),
      icon: <Crown className="w-5 h-5" />,
      color: 'bg-amber-100 text-amber-700 border-amber-200',
      earned: false,
    },
    {
      id: 'top_performer',
      label: t('profile.badges.topPerformer'),
      description: t('profile.badges.topPerformerDesc'),
      icon: <Trophy className="w-5 h-5" />,
      color: 'bg-purple-100 text-purple-700 border-purple-200',
      earned: false,
    },
    {
      id: 'first_booking',
      label: t('profile.badges.firstBooking'),
      description: t('profile.badges.firstBookingDesc'),
      icon: <Zap className="w-5 h-5" />,
      color: 'bg-orange-100 text-orange-700 border-orange-200',
      earned: bookingsCount >= 1,
    },
    {
      id: 'explorer',
      label: t('profile.badges.explorer'),
      description: t('profile.badges.explorerDesc'),
      icon: <Target className="w-5 h-5" />,
      color: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      earned: bookingsCount >= 10,
    },
    {
      id: 'hot_streak',
      label: t('profile.badges.hotStreak'),
      description: t('profile.badges.hotStreakDesc'),
      icon: <Flame className="w-5 h-5" />,
      color: 'bg-red-100 text-red-700 border-red-200',
      earned: false,
    },
  ];

  const earnedBadges = badges.filter(b => b.earned);
  const unearnedBadges = badges.filter(b => !b.earned);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-muted-foreground">{t('common.loading')}</p>
        </div>
      </Layout>
    );
  }

  if (!user) return null;

  // Build trust verification items dynamically
  const phoneVerification = getVerification('phone');
  const govIdVerification = getVerification('government_id');
  const workEmailVerification = getVerification('work_email');

  const trustItems = [
    {
      icon: <Mail className="w-5 h-5 text-green-600 dark:text-green-400" />,
      bg: 'bg-green-500/10',
      title: t('profile.email'),
      desc: user.email || '',
      // Email is verified once user confirms an OTP we send to their inbox.
      // Auth-confirmed users are treated as verified by default; otherwise we
      // require the OTP step.
      verified: isVerified('email') || !!user.email_confirmed_at,
      pending: isPending('email'),
      onVerify: () => { setEmailStep('send'); setEmailDialogOpen(true); },
    },
    {
      icon: <Phone className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
      bg: 'bg-blue-500/10',
      title: t('profile.phoneNumber'),
      desc: phoneVerification?.status === 'verified'
        ? (phoneVerification.data as { phone?: string })?.phone || phone || t('profile.verified')
        : phone || t('profile.addPhone'),
      verified: isVerified('phone'),
      pending: isPending('phone'),
      onVerify: () => { setPhoneInput(phone); setPhoneStep('enter'); setPhoneDialogOpen(true); },
    },
    {
      icon: <CreditCard className="w-5 h-5 text-purple-600 dark:text-purple-400" />,
      bg: 'bg-purple-500/10',
      title: t('profile.governmentID'),
      desc: isVerified('government_id')
        ? t('profile.verified')
        : isPending('government_id')
          ? t('profile.pendingReview')
          : t('profile.uploadYourID'),
      verified: isVerified('government_id'),
      pending: isPending('government_id'),
      onVerify: () => setIdDialogOpen(true),
    },
    {
      icon: <Building className="w-5 h-5 text-muted-foreground" />,
      bg: 'bg-muted',
      title: t('profile.workEmail'),
      desc: workEmailVerification?.status === 'verified'
        ? (workEmailVerification.data as { work_email?: string })?.work_email || t('profile.verified')
        : t('profile.verifyWorkEmail'),
      verified: isVerified('work_email'),
      pending: isPending('work_email'),
      onVerify: () => setWorkEmailDialogOpen(true),
    },
  ];

  // Host verification items — requires admin approval
  const hostVerificationItems = [
    {
      icon: <Mail className="w-5 h-5" />,
      title: t('profile.email'),
      desc: user.email || '',
      action: t('profile.verify'),
      actionIcon: <Mail className="w-4 h-4" />,
      type: 'email',
      onAction: () => { setEmailStep('send'); setEmailDialogOpen(true); },
    },
    {
      icon: <Phone className="w-5 h-5" />,
      title: t('profile.phoneNumber'),
      desc: phoneVerification?.status === 'verified'
        ? (phoneVerification.data as { phone?: string })?.phone || phone || t('profile.verified')
        : phone || t('profile.addPhone'),
      action: t('profile.verify'),
      actionIcon: <Phone className="w-4 h-4" />,
      type: 'phone',
      onAction: () => { setPhoneInput(phone); setPhoneStep('enter'); setPhoneDialogOpen(true); },
    },
    {
      icon: <User className="w-5 h-5" />,
      title: t('profile.identityVerified'),
      desc: t('profile.identityVerifiedDesc'),
      action: t('profile.uploadID'),
      actionIcon: <Upload className="w-4 h-4" />,
      type: 'government_id',
      onAction: () => setIdDialogOpen(true),
    },
  ];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="font-display text-3xl font-bold mb-8">{t('profile.title')}</h1>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8">
          {/* Left Sidebar */}
          <div className="space-y-6">
            {/* Profile Card */}
            <Card className="text-center">
              <CardContent className="pt-8 pb-6">
                <div className="relative inline-block mb-4">
                  <Avatar className="w-28 h-28 mx-auto">
                    <AvatarImage src={profile?.avatar_url || ''} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-3xl font-bold">
                      {profile?.full_name?.[0] || user.email?.[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <button
                    type="button"
                    aria-label="Change profile photo"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="absolute bottom-1 right-1 w-8 h-8 bg-card border border-border rounded-full flex items-center justify-center shadow-sm hover:shadow-md transition-shadow disabled:opacity-60"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarFileChange}
                  />
                </div>
                <h2 className="font-display text-xl font-bold">{profile?.full_name || t('profile.guest')}</h2>
                <p className="text-sm text-muted-foreground flex items-center justify-center gap-1 mt-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {isHostMode
                    ? `Hosting since ${hostingSince ? format(hostingSince, 'yyyy') : format(new Date(profile?.created_at || Date.now()), 'yyyy')}`
                    : `${t('profile.joined')} ${joinDate}`}
                </p>

                {/* Host: profile picture is MANDATORY — show a prompt if missing */}
                {isHostMode && !profile?.avatar_url && (
                  <div className="mt-3 mx-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive flex items-center gap-1.5 justify-center">
                    <Camera className="w-3.5 h-3.5" />
                    <span>Profile photo required for hosts</span>
                  </div>
                )}

                {/* Host: surface the highest "current" badge as a quick chip */}
                {isHostMode && earnedBadges.length > 0 && (
                  <div className="mt-3 flex justify-center">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${earnedBadges[0].color}`}>
                      {earnedBadges[0].icon}
                      <span>{earnedBadges[0].label}</span>
                    </div>
                  </div>
                )}

                {/* Profile completeness badge — host mode only */}
                {isHostMode && (() => {
                  // Guests: only need verified email (always) + verified phone.
                  // Hosts: need 6 extended fields on top of email/phone.
                  const phoneOk = isVerified('phone');
                  const guestRequired = 2; // email + phone
                  const guestDone = (1 /* email always */) + (phoneOk ? 1 : 0);
                  const totalRequired = isHost ? guestRequired + 6 : guestRequired;
                  const completed = isHost
                    ? guestDone + (6 - missingFields.length)
                    : guestDone;
                  const pct = Math.round((completed / totalRequired) * 100);
                  const isFull = pct === 100;
                  return (
                    <div className="mt-3 flex justify-center">
                      <div
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                          isFull
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : pct >= 60
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-destructive/10 text-destructive border-destructive/30'
                        }`}
                        title={
                          isFull
                            ? 'Profile is fully complete'
                            : `Missing: ${missingFields.join(', ')}`
                        }
                      >
                        {isFull && <CheckCircle2 className="w-3.5 h-3.5" />}
                        <span>{completed}/{totalRequired} complete · {pct}%</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Verification badges */}
                <VerificationBadges
                  status={{
                    email: true,
                    phone: isVerified('phone'),
                    // Hide ID Verified + Host pills when in guest mode — guests
                    // should only see the guest-relevant verification badges.
                    governmentId: isHostMode ? isVerified('government_id') : false,
                    workEmail: isHostMode ? isVerified('work_email') : false,
                    isHost: isHostMode ? (isHost || false) : false,
                  }}
                  size="sm"
                  className="justify-center mt-3"
                />
              </CardContent>
            </Card>

            {/* Rating Performance Card — host mode only */}
            {isHostMode && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Rating Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  <span>Member since <span className="font-medium text-foreground">{joinDate}</span></span>
                </div>
                <Separator />

                {/* Guest Rating */}
                {/* Hidden in host mode — host context shows host rating only */}
                {!isHostMode && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <User className="w-4 h-4 text-primary" />
                      As Guest
                    </span>
                    {guestRating ? (
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-rating text-rating" />
                        <span className="text-sm font-bold text-rating">{guestRating.avg}</span>
                        <span className="text-xs text-rating/80">/ 5</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">No ratings yet</span>
                    )}
                  </div>
                  {guestRating && (
                    <>
                      <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                        <div className="bg-primary rounded-full h-1.5 transition-all" style={{ width: `${(guestRating.avg / 5) * 100}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground">{guestRating.count} review{guestRating.count !== 1 ? 's' : ''} from hosts</p>
                    </>
                  )}
                </div>
                )}

                {/* Host Rating - only show if user is host */}
                {isHost && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium flex items-center gap-1.5">
                        <Home className="w-4 h-4 text-primary" />
                        As Host
                      </span>
                      {hostRating ? (
                        <div className="flex items-center gap-1">
                          <Star className="w-4 h-4 fill-rating text-rating" />
                          <span className="text-sm font-bold text-rating">{hostRating.avg}</span>
                          <span className="text-xs text-rating/80">/ 5</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No ratings yet</span>
                      )}
                    </div>
                    {hostRating && (
                      <>
                        <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                          <div className="bg-primary rounded-full h-1.5 transition-all" style={{ width: `${(hostRating.avg / 5) * 100}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground">{hostRating.count} review{hostRating.count !== 1 ? 's' : ''} from guests</p>
                      </>
                    )}
                  </div>
                )}

                {/* Trips counter — labelled per role */}
                <div className="flex items-center justify-between text-sm pt-1">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Briefcase className="w-4 h-4" />
                    {isHostMode ? 'Trips Hosted' : 'Completed Trips'}
                  </span>
                  <span className="font-bold text-foreground">{isHostMode ? hostedTripsCount : bookingsCount}</span>
                </div>
              </CardContent>
            </Card>
            )}

            {/* Badges Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Award className="w-5 h-5 text-primary" />
                  {t('profile.yourBadges')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {earnedBadges.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('profile.noBadgesYet')}</p>
                ) : (
                  earnedBadges.map((badge) => (
                    <div
                      key={badge.id}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border ${badge.color}`}
                    >
                      {badge.icon}
                      <div>
                        <p className="text-sm font-semibold">{badge.label}</p>
                        <p className="text-xs opacity-80">{badge.description}</p>
                      </div>
                    </div>
                  ))
                )}
                {/* "Up Next" suggestions (Superhost / Top Performer etc.) are
                    host-only — guests should not see host-bound goals. */}
                {isHostMode && unearnedBadges.length > 0 && (
                  <>
                    <Separator className="my-3" />
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{t('profile.upNext')}</p>
                    {unearnedBadges.slice(0, 3).map((badge) => (
                      <div
                        key={badge.id}
                        className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-muted/30 opacity-60"
                      >
                        {badge.icon}
                        <div>
                          <p className="text-sm font-medium">{badge.label}</p>
                          <p className="text-xs text-muted-foreground">{badge.description}</p>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Content */}
          <div>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className={`w-full grid ${isHostMode ? 'grid-cols-4' : 'grid-cols-2'} mb-6`}>
                <TabsTrigger value="about" className="flex items-center gap-1.5">
                  <User className="w-4 h-4" />
                  {t('profile.tabs.about')}
                </TabsTrigger>
                {isHostMode && (
                  <TabsTrigger value="social" className="flex items-center gap-1.5">
                    <Star className="w-4 h-4" />
                    {t('profile.tabs.socialProof')}
                  </TabsTrigger>
                )}
                {isHostMode && (
                  <TabsTrigger value="host" className="flex items-center gap-1.5">
                    <Home className="w-4 h-4" />
                    {t('profile.tabs.host')}
                  </TabsTrigger>
                )}
                <TabsTrigger value="settings" className="flex items-center gap-1.5">
                  <Briefcase className="w-4 h-4" />
                  {t('profile.tabs.settings')}
                </TabsTrigger>
              </TabsList>

              {/* ========== ABOUT TAB ========== */}
              <TabsContent value="about" className="space-y-6">
                {/* Mandatory profile completion banner — hosts only */}
                {isHostMode && !isProfileComplete && (
                  <div
                    ref={missingBannerRef}
                    className={`rounded-xl border-2 border-amber-300 bg-amber-50 p-4 flex items-start gap-3 transition-all ${
                      highlightMissing ? 'ring-4 ring-amber-400/60 animate-pulse' : ''
                    }`}
                  >
                    <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-amber-900 text-sm">Complete your host profile</p>
                      <p className="text-xs text-amber-800 mt-1">
                        Hosts must complete every field below before guests can book. Missing:{' '}
                        <span className="font-medium">{missingFields.join(', ')}</span>.
                      </p>
                    </div>
                    {!isEditing && (
                      <Button size="sm" onClick={() => setIsEditing(true)} className="btn-primary shrink-0">
                        Complete now
                      </Button>
                    )}
                  </div>
                )}

                {/* ===== GUEST: minimized profile card =====
                    Only essentials. To book a stay, a guest only needs a
                    verified email (always true after sign-up) + a verified
                    mobile number. Bio / pronouns / etc. are NOT required. */}
                {!isHostMode && (
                  <>
                    {/* ===== GUEST: About Me card — joined date, ratings, badges, contact ===== */}
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <User className="w-5 h-5 text-primary" />
                          {t('profile.aboutMe')}
                        </CardTitle>
                        <Badge variant="secondary" className="text-xs">Guest profile</Badge>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                            <Calendar className="w-4 h-4 mx-auto mb-1 text-primary" />
                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Joined</p>
                            <p className="text-sm font-bold">{joinDate || '—'}</p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                            <Star className="w-4 h-4 mx-auto mb-1 fill-rating text-rating" />
                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Avg rating</p>
                            <p className="text-sm font-bold text-rating">
                              {guestRating ? `${guestRating.avg} ★` : '—'}
                            </p>
                            <p className="text-[10px] font-bold text-rating">
                              {guestRating ? `${guestRating.count} rating${guestRating.count !== 1 ? 's' : ''}` : 'No ratings yet'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                            <Briefcase className="w-4 h-4 mx-auto mb-1 text-primary" />
                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Trips</p>
                            <p className="text-sm font-bold">{bookingsCount}</p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                            <Globe className="w-4 h-4 mx-auto mb-1 text-primary" />
                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Countries</p>
                            <p className="text-sm font-bold">{stats.countries}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                            <Mail className="w-4 h-4 text-primary" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Email</p>
                              <p className="text-sm font-medium truncate">{user?.email}</p>
                            </div>
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          </div>
                          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                            <Phone className="w-4 h-4 text-primary" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Mobile</p>
                              <p className="text-sm font-medium truncate">
                                {phone || <span className="italic text-muted-foreground">Not provided</span>}
                              </p>
                            </div>
                            {isVerified('phone') ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => { setPhoneInput(phone); setPhoneStep('enter'); setPhoneDialogOpen(true); }}
                              >
                                Verify
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Quick badges */}
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Badge className="bg-blue-100 text-blue-700 border-blue-200 gap-1">
                            <Sparkles className="w-3 h-3" /> {t('profile.badges.newMember')}
                          </Badge>
                          {(profile?.is_verified || isVerified('government_id') || isVerified('phone')) && (
                            <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
                              <CheckCircle2 className="w-3 h-3" /> {t('profile.badges.verified')}
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* ===== GUEST: About You — bio + languages (editable, persisted) ===== */}
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <Heart className="w-5 h-5 text-primary" />
                          {t('profile.aboutYou')}
                        </CardTitle>
                        {!isEditingGuestAbout ? (
                          <Button variant="outline" size="sm" onClick={() => setIsEditingGuestAbout(true)}>
                            <Pencil className="w-4 h-4 mr-1" /> {t('common.edit')}
                          </Button>
                        ) : null}
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div>
                          <Label className="text-sm">{t('profile.bio')}</Label>
                          {isEditingGuestAbout ? (
                            <Textarea
                              value={bio}
                              onChange={e => setBio(e.target.value)}
                              placeholder={t('profile.bioPlaceholder')}
                              className="mt-1 min-h-[90px]"
                            />
                          ) : (
                            <p className="text-sm mt-1 text-muted-foreground">
                              {bio || <span className="italic">Not set — click Edit to add.</span>}
                            </p>
                          )}
                        </div>
                        <div>
                          <Label className="text-sm">{t('profile.languages')}</Label>
                          {isEditingGuestAbout ? (
                            <Input
                              value={languages}
                              onChange={e => setLanguages(e.target.value)}
                              placeholder={t('profile.languagesPlaceholder')}
                              className="mt-1"
                            />
                          ) : (
                            <p className="text-sm mt-1 text-muted-foreground">
                              {languages || <span className="italic">Not set — click Edit to add.</span>}
                            </p>
                          )}
                        </div>
                        {isEditingGuestAbout && (
                          <div className="flex gap-2 pt-1">
                            <Button
                              className="btn-primary"
                              onClick={async () => {
                                await handleSaveProfile();
                                setIsEditingGuestAbout(false);
                              }}
                            >
                              {t('common.save')}
                            </Button>
                            <Button variant="outline" onClick={() => setIsEditingGuestAbout(false)}>
                              {t('common.cancel')}
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                )}

                {/* ===== HOST: full extended profile card ===== */}
                {isHostMode && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <User className="w-5 h-5 text-primary" />
                      {t('profile.aboutMe')}
                      {isProfileComplete && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                    </CardTitle>
                    <Button variant="outline" size="sm" onClick={() => setIsEditing(!isEditing)}>
                      <Pencil className="w-4 h-4 mr-1" />
                      {t('common.edit')}
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* BIO — required, min 20 chars */}
                    <div>
                      <Label className="text-sm font-medium text-foreground flex items-center gap-1">
                        {t('profile.bio')} <span className="text-destructive">*</span>
                      </Label>
                      {isEditing ? (
                        <>
                          <Textarea
                            value={bio}
                            onChange={e => setBio(e.target.value)}
                            placeholder={t('profile.bioPlaceholder')}
                            className="mt-1 min-h-[100px]"
                            required
                          />
                          <p className={`text-xs mt-1 ${bio.trim().length >= 20 ? 'text-green-600' : 'text-muted-foreground'}`}>
                            {bio.trim().length}/20 characters minimum
                          </p>
                        </>
                      ) : (
                        <p className="text-sm mt-1 text-muted-foreground italic">
                          {bio || <span className="text-destructive">Required — please add a bio.</span>}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* PRONOUNS */}
                      <div className="flex items-start gap-2">
                        <User className="w-4 h-4 mt-0.5 text-muted-foreground" />
                        <div className="flex-1">
                          <p className="text-sm font-medium flex items-center gap-1">
                            {t('profile.pronouns')} <span className="text-destructive">*</span>
                          </p>
                          {isEditing ? (
                            <Select value={pronouns} onValueChange={setPronouns}>
                              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select pronouns" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="she/her">she/her</SelectItem>
                                <SelectItem value="he/him">he/him</SelectItem>
                                <SelectItem value="they/them">they/them</SelectItem>
                                <SelectItem value="prefer not to say">Prefer not to say</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className={`text-sm ${pronouns ? 'text-primary' : 'text-destructive'}`}>{pronouns || 'Required'}</p>
                          )}
                        </div>
                      </div>

                      {/* HOMETOWN */}
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground" />
                        <div className="flex-1">
                          <p className="text-sm font-medium flex items-center gap-1">
                            {t('profile.hometown')} <span className="text-destructive">*</span>
                          </p>
                          {isEditing ? (
                            <Input
                              value={location}
                              onChange={e => setLocation(e.target.value)}
                              placeholder={t('profile.hometownPlaceholder')}
                              className="mt-1 h-8 text-sm"
                              required
                            />
                          ) : (
                            <p className={`text-sm ${location ? 'text-primary' : 'text-destructive'}`}>{location || 'Required'}</p>
                          )}
                        </div>
                      </div>

                      {/* RELATION TO PROPERTY */}
                      <div className="flex items-start gap-2">
                        <Home className="w-4 h-4 mt-0.5 text-muted-foreground" />
                        <div className="flex-1">
                          <p className="text-sm font-medium flex items-center gap-1">
                            Relation to property <span className="text-destructive">*</span>
                          </p>
                          {isEditing ? (
                            <Select value={propertyRelation} onValueChange={setPropertyRelation}>
                              <SelectTrigger className="mt-1 h-8 text-sm">
                                <SelectValue placeholder="Select your role" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="owner">Owner</SelectItem>
                                <SelectItem value="manager">Property Manager</SelectItem>
                                <SelectItem value="co_host">Co-host</SelectItem>
                                <SelectItem value="agent">Agent</SelectItem>
                                <SelectItem value="family">Family member</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className={`text-sm capitalize ${propertyRelation ? 'text-primary' : 'text-destructive'}`}>
                              {propertyRelation ? propertyRelation.replace(/_/g, ' ') : 'Required'}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* FUN FACT */}
                    <div className="flex items-start gap-2">
                      <Info className="w-4 h-4 mt-0.5 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="text-sm font-medium flex items-center gap-1">
                          {t('profile.funFact')} <span className="text-destructive">*</span>
                        </p>
                        {isEditing ? (
                          <Input
                            value={funFact}
                            onChange={e => setFunFact(e.target.value)}
                            placeholder="I've visited 27 countries on a backpack"
                            className="mt-1 h-8 text-sm"
                            required
                          />
                        ) : (
                          <p className={`text-sm ${funFact ? 'text-primary' : 'text-destructive'}`}>{funFact || 'Required'}</p>
                        )}
                      </div>
                    </div>

                    {/* LANGUAGES */}
                    <div className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 mt-0.5 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="text-sm font-medium flex items-center gap-1">
                          {t('profile.languagesSpeak')} <span className="text-destructive">*</span>
                        </p>
                        {isEditing ? (
                          <Input
                            value={languages}
                            onChange={e => setLanguages(e.target.value)}
                            placeholder="English, Swahili, French"
                            className="mt-1 h-8 text-sm"
                            required
                          />
                        ) : (
                          <p className={`text-sm ${languages ? 'text-primary' : 'text-destructive'}`}>{languages || 'Required'}</p>
                        )}
                      </div>
                    </div>

                    {isEditing && (
                      <div className="flex gap-2 pt-2">
                        <Button onClick={handleSaveProfile} className="btn-primary">
                          {t('common.save')}
                        </Button>
                        <Button variant="outline" onClick={() => setIsEditing(false)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
                )}

                {/* ===== PREFERENCES SUMMARY (Travel Style & Interests) =====
                    Guests-only card. Hosts do not see travel-style/interests on
                    their profile — those are guest-traveller traits. */}
                {prefsLoaded && !isHostMode ? (
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Globe className="w-5 h-5 text-primary" />
                        {t('profile.travelStyle')} & {t('profile.interests')}
                        {/* Auto-save indicator — appears whenever a change is being persisted */}
                        {isEditingPrefs && prefsAutoSaveState !== 'idle' && (
                          <span className={`text-xs font-normal ml-2 ${prefsAutoSaveState === 'saved' ? 'text-green-600' : 'text-muted-foreground'}`}>
                            {prefsAutoSaveState === 'saving' ? '· Saving…' : '· Saved'}
                          </span>
                        )}
                      </CardTitle>
                      {!isEditingPrefs ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            // Guests edit inline on the About tab; hosts jump to
                            // the dedicated Settings preferences section.
                            if (isHostMode) {
                              setActiveTab('settings');
                            }
                            setIsEditingPrefs(true);
                          }}
                        >
                          <Pencil className="w-4 h-4 mr-1" />
                          {t('common.edit')}
                        </Button>
                      ) : null}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* INLINE EDIT MODE (guest) — show editable controls + Save */}
                      {isEditingPrefs && !isHostMode ? (
                        <>
                          <div>
                            <Label>{t('profile.preferredTravelStyle')}</Label>
                            <Select value={travelStyle} onValueChange={setTravelStyle}>
                              <SelectTrigger className="mt-1">
                                <SelectValue placeholder={t('profile.selectYourStyle')} />
                              </SelectTrigger>
                              <SelectContent>
                                {TRAVEL_STYLES.map(style => (
                                  <SelectItem key={style} value={style.toLowerCase()}>{style}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>{t('profile.interests')}</Label>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {INTERESTS.map(interest => (
                                <Badge
                                  key={interest}
                                  variant={selectedInterests.includes(interest) ? 'default' : 'outline'}
                                  className="cursor-pointer transition-colors"
                                  onClick={() => toggleInterest(interest)}
                                >
                                  {interest}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <Label>{t('profile.dietaryPreferences')}</Label>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {DIETARY_OPTIONS.map(option => (
                                <Badge
                                  key={option}
                                  variant={selectedDietary.includes(option) ? 'default' : 'outline'}
                                  className="cursor-pointer transition-colors"
                                  onClick={() => toggleDietary(option)}
                                >
                                  🍽 {option}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <Label>{t('profile.accessibilityNeeds')}</Label>
                            <div className="space-y-2 mt-2">
                              {ACCESSIBILITY_NEEDS.map(need => (
                                <div key={need} className="flex items-center gap-2">
                                  <Checkbox
                                    id={`about-${need}`}
                                    checked={selectedAccessibility.includes(need)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setSelectedAccessibility(prev => [...prev, need]);
                                      } else {
                                        setSelectedAccessibility(prev => prev.filter(n => n !== need));
                                      }
                                    }}
                                  />
                                  <label htmlFor={`about-${need}`} className="text-sm cursor-pointer">{need}</label>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-2 pt-2">
                            <Button
                              className="btn-primary flex-1"
                              onClick={handleSavePreferences}
                            >
                              {t('common.save')}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => { setIsEditingPrefs(false); fetchPreferences(); }}
                            >
                              {t('common.cancel')}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                      {travelStyle && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">{t('profile.preferredTravelStyle')}</p>
                          <Badge variant="secondary" className="capitalize">{travelStyle}</Badge>
                        </div>
                      )}
                      {selectedInterests.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1.5">{t('profile.interests')}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedInterests.map(i => (
                              <Badge key={i} variant="outline">{i}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedDietary.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1.5">{t('profile.dietaryPreferences')}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedDietary.map(d => (
                              <Badge key={d} variant="outline">🍽 {d}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedAccessibility.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1.5">{t('profile.accessibilityNeeds')}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedAccessibility.map(a => (
                              <Badge key={a} variant="outline">{a}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {!travelStyle && !selectedInterests.length && !selectedDietary.length && !selectedAccessibility.length && (
                        <p className="text-sm text-muted-foreground italic">
                          Nothing set yet — click Edit to add your travel style, interests, dietary preferences and accessibility needs.
                        </p>
                      )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                ) : null}
              </TabsContent>

              {/* ========== SOCIAL PROOF TAB ========== */}
              <TabsContent value="social" className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { icon: <MessageSquare className="w-5 h-5" />, value: stats.reviews, label: t('profile.reviewsReceived'), color: 'bg-blue-50 border-blue-100' },
                    { icon: <Star className="w-5 h-5 fill-rating text-rating" />, value: stats.rating || '—', label: t('profile.averageRating'), color: 'bg-rating/5 border-rating/20', isRating: true },
                    isHostMode
                      ? { icon: <Calendar className="w-5 h-5" />, value: hostedTripsCount, label: 'Trips Hosted', color: 'bg-green-50 border-green-100' }
                      : { icon: <Calendar className="w-5 h-5" />, value: stats.trips, label: t('profile.tripsCompleted'), color: 'bg-green-50 border-green-100' },
                    isHostMode
                      ? { icon: <MapPin className="w-5 h-5" />, value: guestCountriesCount, label: 'Guest Countries', color: 'bg-purple-50 border-purple-100' }
                      : { icon: <MapPin className="w-5 h-5" />, value: stats.countries, label: t('profile.countriesVisited'), color: 'bg-purple-50 border-purple-100' },
                  ].map((stat, i) => (
                    <Card key={i} className={`${stat.color} border text-center`}>
                      <CardContent className="pt-5 pb-4">
                        <div className="flex justify-center mb-2 text-muted-foreground">{stat.icon}</div>
                        <p className={`text-2xl font-bold ${(stat as any).isRating ? 'text-rating' : 'text-primary'}`}>{stat.value}</p>
                        <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-primary" />
                      {t('profile.reviewsFromHosts')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col items-center py-8 text-center">
                      <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-3" />
                      <p className="font-medium text-muted-foreground">{t('profile.noReviewsYet')}</p>
                      <p className="text-sm text-muted-foreground mt-1">{t('profile.reviewsAppearAfterTrips')}</p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      {t('profile.travelHistory')}
                      <Badge variant="secondary" className="text-xs">{t('profile.optional')}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col items-center py-8 text-center">
                      <MapPin className="w-12 h-12 text-muted-foreground/30 mb-3" />
                      <p className="text-muted-foreground">{t('profile.noTravelHistory')}</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ========== HOST TAB ========== */}
              <TabsContent value="host" className="space-y-6">
                {/* Host Verification Badges */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      {t('profile.hostVerificationBadges')}
                    </CardTitle>
                    <span className="text-sm text-muted-foreground">{t('profile.verifiedCount', { count: verifiedCount, total: hostVerifTypes.length })}</span>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm text-muted-foreground mb-4">{t('profile.verifiedHostsEarn')}</p>

                    {hostVerificationItems.map((item, i) => {
                      const verified = item.type === 'email'
                        ? (isVerified('email') || !!user.email_confirmed_at)
                        : isVerified(item.type);
                      const pending = isPending(item.type);
                      const verif = getVerification(item.type);
                      const rejected = verif?.status === 'rejected';
                      const rejectReason = (verif?.data as { reject_reason?: string } | null)?.reject_reason;
                      return (
                        <div key={i} className={`flex flex-col gap-3 p-4 rounded-xl border ${verified ? 'bg-green-50 border-green-200' : pending ? 'bg-amber-50 border-amber-200' : rejected ? 'bg-destructive/5 border-destructive/30' : 'bg-muted/30 border-border'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${verified ? 'bg-green-100 text-green-600' : pending ? 'bg-amber-100 text-amber-600' : rejected ? 'bg-destructive/10 text-destructive' : 'bg-background border border-border text-muted-foreground'}`}>
                                {verified ? <CheckCircle2 className="w-5 h-5" /> : rejected ? <X className="w-5 h-5" /> : item.icon}
                              </div>
                              <div>
                                <p className="font-medium text-sm flex items-center gap-1.5">
                                  {item.title}
                                  {verified && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                                  {pending && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">{t('profile.pending')}</Badge>}
                                  {rejected && <Badge variant="destructive" className="text-xs">Rejected</Badge>}
                                </p>
                                <p className="text-xs text-muted-foreground">{item.desc}</p>
                              </div>
                            </div>
                            {!verified && !pending && !rejected && (
                              <Button variant="outline" size="sm" className="flex items-center gap-1.5 shrink-0" onClick={item.onAction}>
                                {item.actionIcon}
                                {item.action}
                              </Button>
                            )}
                            {pending && (
                              <Badge variant="outline" className="text-amber-600 border-amber-300 shrink-0">
                                {t('profile.pendingReview')}
                              </Badge>
                            )}
                            {rejected && (
                              <Button variant="destructive" size="sm" className="flex items-center gap-1.5 shrink-0" onClick={item.onAction}>
                                <Upload className="w-4 h-4" />
                                Resubmit
                              </Button>
                            )}
                            {verified && (
                              <Badge className="bg-green-100 text-green-700 border-green-200 shrink-0">
                                {t('profile.verified')}
                              </Badge>
                            )}
                          </div>

                          {/* Rejection reason — shown inline so the host knows what to fix */}
                          {rejected && (
                            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3">
                              <p className="text-xs font-semibold text-destructive mb-1 flex items-center gap-1.5">
                                <Info className="w-3.5 h-3.5" />
                                Why your submission was rejected
                              </p>
                              <p className="text-xs text-foreground/80 leading-relaxed">
                                {rejectReason || 'No reason was provided. Please re-upload a clearer document.'}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-4">
                      <Info className="w-3.5 h-3.5" />
                      {t('profile.verificationReviewTime')}
                    </p>
                  </CardContent>
                </Card>

                {/* Trust & Verification */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      {t('profile.trustVerification')}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{t('profile.trustVerificationDesc')}</p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {trustItems.map((item, i) => (
                      <div key={i} className={`flex items-center justify-between p-4 rounded-xl border ${item.verified ? 'bg-green-50/50 border-green-100' : item.pending ? 'bg-amber-50/50 border-amber-100' : 'bg-muted/20 border-border'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg ${item.bg} flex items-center justify-center`}>
                            {item.icon}
                          </div>
                          <div>
                            <p className="font-medium text-sm flex items-center gap-1.5">
                              {item.title}
                              {item.verified && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                              {item.pending && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">{t('profile.pending')}</Badge>}
                            </p>
                            <p className="text-xs text-muted-foreground">{item.desc}</p>
                          </div>
                        </div>
                        {!item.verified && !item.pending && (
                          <Button variant="outline" size="sm" onClick={item.onVerify}>{t('profile.verify')}</Button>
                        )}
                        {item.verified && (
                          <Badge className="bg-green-100 text-green-700 border-green-200">
                            {t('profile.verified')}
                          </Badge>
                        )}
                        {item.pending && (
                          <Badge variant="outline" className="text-amber-600 border-amber-300">
                            {t('profile.pendingReview')}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ========== SETTINGS TAB ========== */}
              <TabsContent value="settings" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Heart className="w-5 h-5 text-primary" />
                      {t('profile.aboutYou')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>{t('profile.bio')}</Label>
                      <Textarea
                        value={bio}
                        onChange={e => setBio(e.target.value)}
                        placeholder={t('profile.bioPlaceholder')}
                        className="mt-1"
                        rows={4}
                      />
                    </div>
                    <div>
                      <Label>{t('profile.languages')}</Label>
                      <Input
                        value={languages}
                        onChange={e => setLanguages(e.target.value)}
                        placeholder={t('profile.languagesPlaceholder')}
                        className="mt-1"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Travel Style — guest-only preference, hidden in host mode */}
                {!isHostMode && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="w-5 h-5 text-primary" />
                      {t('profile.travelStyle')}
                    </CardTitle>
                    {!isEditingPrefs && (
                      <Button variant="outline" size="sm" onClick={() => setIsEditingPrefs(true)}>
                        <Pencil className="w-4 h-4 mr-1" />
                        {t('common.edit')}
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>{t('profile.preferredTravelStyle')}</Label>
                      {isEditingPrefs ? (
                        <Select value={travelStyle} onValueChange={setTravelStyle}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder={t('profile.selectYourStyle')} />
                          </SelectTrigger>
                          <SelectContent>
                            {TRAVEL_STYLES.map(style => (
                              <SelectItem key={style} value={style.toLowerCase()}>{style}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm mt-1 capitalize text-foreground">
                          {travelStyle || <span className="text-muted-foreground italic">Not set</span>}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label>{t('profile.interests')}</Label>
                      {isEditingPrefs ? (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {INTERESTS.map(interest => (
                            <Badge
                              key={interest}
                              variant={selectedInterests.includes(interest) ? 'default' : 'outline'}
                              className="cursor-pointer transition-colors"
                              onClick={() => toggleInterest(interest)}
                            >
                              {interest}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {selectedInterests.length > 0 ? (
                            selectedInterests.map(i => <Badge key={i} variant="outline">{i}</Badge>)
                          ) : (
                            <span className="text-sm text-muted-foreground italic">None selected</span>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
                )}

                {/* Accessibility & Dietary — guest-only, hidden in host mode */}
                {!isHostMode && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Heart className="w-5 h-5 text-primary" />
                      {t('profile.accessibilityDietary')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>{t('profile.accessibilityNeeds')}</Label>
                      {isEditingPrefs ? (
                        <div className="space-y-3 mt-2">
                          {ACCESSIBILITY_NEEDS.map(need => (
                            <div key={need} className="flex items-center gap-2">
                              <Checkbox
                                id={need}
                                checked={selectedAccessibility.includes(need)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedAccessibility(prev => [...prev, need]);
                                  } else {
                                    setSelectedAccessibility(prev => prev.filter(n => n !== need));
                                  }
                                }}
                              />
                              <label htmlFor={need} className="text-sm cursor-pointer">{need}</label>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {selectedAccessibility.length > 0 ? (
                            selectedAccessibility.map(a => <Badge key={a} variant="outline">{a}</Badge>)
                          ) : (
                            <span className="text-sm text-muted-foreground italic">None selected</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <Label>{t('profile.dietaryPreferences')}</Label>
                      {isEditingPrefs ? (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {DIETARY_OPTIONS.map(option => (
                            <Badge
                              key={option}
                              variant={selectedDietary.includes(option) ? 'default' : 'outline'}
                              className="cursor-pointer transition-colors"
                              onClick={() => toggleDietary(option)}
                            >
                              🍽 {option}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {selectedDietary.length > 0 ? (
                            selectedDietary.map(d => <Badge key={d} variant="outline">🍽 {d}</Badge>)
                          ) : (
                            <span className="text-sm text-muted-foreground italic">None selected</span>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
                )}

                {/* Save/Cancel only relevant when there's any guest-pref card to edit */}
                {!isHostMode && isEditingPrefs && (
                  <div className="flex gap-2">
                    <Button onClick={handleSavePreferences} className="flex-1 btn-primary" size="lg">
                      {t('profile.savePreferences')}
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => { setIsEditingPrefs(false); fetchPreferences(); }}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* ===== PHONE OTP VERIFICATION DIALOG ===== */}
      <Dialog
        open={phoneDialogOpen}
        onOpenChange={(open) => {
          setPhoneDialogOpen(open);
          if (!open) { setPhoneStep('enter'); setPhoneCode(''); setPhoneCodeInput(''); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-primary" />
              {phoneStep === 'enter' ? t('profile.verifyPhoneTitle') : 'Enter verification code'}
            </DialogTitle>
            <DialogDescription>
              {phoneStep === 'enter'
                ? "We'll send a 6-digit code to your phone via SMS."
                : `Enter the 6-digit code we sent to ${phoneInput}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {phoneStep === 'enter' ? (
              <div>
                <Label>{t('profile.phoneNumber')}</Label>
                <div className="mt-1 flex gap-2 relative">
                  {/* Country code dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                      className="flex items-center gap-1.5 h-10 px-3 border border-input rounded-md bg-background text-sm font-medium hover:bg-accent transition-colors whitespace-nowrap"
                    >
                      <span>{COUNTRY_CODES.find(c => c.code === countryCode)?.flag}</span>
                      <span>{countryCode}</span>
                      <span className="text-muted-foreground text-xs">▼</span>
                    </button>
                    {showCountryDropdown && (
                      <div className="absolute z-50 top-11 left-0 w-72 bg-background border border-input rounded-md shadow-lg">
                        <div className="p-2 border-b">
                          <input
                            autoFocus
                            type="text"
                            placeholder="Search country or code..."
                            value={countrySearch}
                            onChange={e => setCountrySearch(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border rounded bg-background outline-none"
                            onClick={e => e.stopPropagation()}
                          />
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {filteredCountries.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-3">No country found</p>
                          ) : filteredCountries.map(c => (
                            <button
                              key={c.code + c.name}
                              type="button"
                              onClick={() => { setCountryCode(c.code); setShowCountryDropdown(false); setCountrySearch(''); }}
                              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                            >
                              <span>{c.flag}</span>
                              <span className="flex-1">{c.name}</span>
                              <span className="text-muted-foreground text-xs">{c.code}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Phone number input */}
                  <Input
                    value={phoneInput}
                    onChange={e => setPhoneInput(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="712 345 678"
                    className="flex-1"
                    type="tel"
                    inputMode="numeric"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">Enter number without country code</p>
              </div>
            ) : (
              <div>
                <Label>Verification code</Label>
                <Input
                  value={phoneCodeInput}
                  onChange={e => setPhoneCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="mt-1 text-center text-2xl tracking-[0.5em] font-mono"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSendPhoneCode}
                  className="text-xs text-primary hover:underline mt-2"
                >
                  Resend code
                </button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPhoneDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            {phoneStep === 'enter' ? (
              <Button onClick={handleSendPhoneCode} disabled={!phoneInput.trim()} className="btn-primary">
                Send code
              </Button>
            ) : (
              <Button onClick={handleConfirmPhoneCode} disabled={submitting || phoneCodeInput.length !== 6} className="btn-primary">
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Verify
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== EMAIL OTP VERIFICATION DIALOG ===== */}
      <Dialog
        open={emailDialogOpen}
        onOpenChange={(open) => {
          setEmailDialogOpen(open);
          if (!open) { setEmailStep('send'); setEmailCode(''); setEmailCodeInput(''); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              {emailStep === 'send' ? 'Verify your email' : 'Enter verification code'}
            </DialogTitle>
            <DialogDescription>
              {emailStep === 'send'
                ? `We'll send a 6-digit code to ${user.email}.`
                : `Enter the 6-digit code we sent to ${user.email}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {emailStep === 'code' && (
              <div>
                <Label>Verification code</Label>
                <Input
                  value={emailCodeInput}
                  onChange={e => setEmailCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="mt-1 text-center text-2xl tracking-[0.5em] font-mono"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSendEmailCode}
                  className="text-xs text-primary hover:underline mt-2"
                >
                  Resend code
                </button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            {emailStep === 'send' ? (
              <Button onClick={handleSendEmailCode} className="btn-primary">
                <KeyRound className="w-4 h-4 mr-2" /> Send code
              </Button>
            ) : (
              <Button onClick={handleConfirmEmailCode} disabled={submitting || emailCodeInput.length !== 6} className="btn-primary">
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Verify
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== WORK EMAIL VERIFICATION DIALOG ===== */}
      <Dialog open={workEmailDialogOpen} onOpenChange={setWorkEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building className="w-5 h-5 text-primary" />
              {t('profile.verifyWorkEmailTitle')}
            </DialogTitle>
            <DialogDescription>{t('profile.verifyWorkEmailDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>{t('profile.workEmail')}</Label>
              <Input
                value={workEmailInput}
                onChange={e => setWorkEmailInput(e.target.value)}
                placeholder="you@company.com"
                className="mt-1"
                type="email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkEmailDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmitWorkEmail} disabled={submitting || !workEmailInput.trim()} className="btn-primary">
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('profile.verify')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== GOVERNMENT ID UPLOAD DIALOG ===== */}
      <Dialog open={idDialogOpen} onOpenChange={(open) => { setIdDialogOpen(open); if (!open) { setIdFile(null); setIdBackFile(null); setIdDocType(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary" />
              {t('profile.uploadIDTitle')}
            </DialogTitle>
            <DialogDescription>
              Choose your document type and upload a clear photo or scan. An admin will review within 1–3 business days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Document type selector */}
            <div>
              <Label>Document type <span className="text-destructive">*</span></Label>
              <Select value={idDocType} onValueChange={(v) => { setIdDocType(v as typeof idDocType); setIdBackFile(null); }}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select your ID type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="national_id">National ID card (front + back)</SelectItem>
                  <SelectItem value="drivers_license">Driver's license</SelectItem>
                  <SelectItem value="passport">Passport</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* FRONT (or single document) uploader */}
            <div>
              <Label className="text-sm">
                {idDocType === 'national_id' ? 'Front of ID' : 'Document'} <span className="text-destructive">*</span>
              </Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => setIdFile(e.target.files?.[0] || null)}
              />
              {idFile ? (
                <div className="mt-1 flex items-center gap-3 p-4 bg-muted/30 rounded-xl border border-border">
                  <FileText className="w-8 h-8 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{idFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(idFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setIdFile(null)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div
                  className="mt-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">{t('profile.clickToUpload')}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t('profile.acceptedFormats')}</p>
                </div>
              )}
            </div>

            {/* BACK uploader — only required for National ID */}
            {idDocType === 'national_id' && (
              <div>
                <Label className="text-sm">
                  Back of ID <span className="text-destructive">*</span>
                </Label>
                <input
                  ref={idBackFileRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => setIdBackFile(e.target.files?.[0] || null)}
                />
                {idBackFile ? (
                  <div className="mt-1 flex items-center gap-3 p-4 bg-muted/30 rounded-xl border border-border">
                    <FileText className="w-8 h-8 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{idBackFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(idBackFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setIdBackFile(null)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div
                    className="mt-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => idBackFileRef.current?.click()}
                  >
                    <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                    <p className="text-sm font-medium">Upload back side</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('profile.acceptedFormats')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIdDialogOpen(false); setIdFile(null); setIdBackFile(null); setIdDocType(''); }}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmitGovernmentID}
              disabled={submitting || !idFile || !idDocType || (idDocType === 'national_id' && !idBackFile)}
              className="btn-primary"
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('profile.uploadID')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* (Background Check & Property Standards dialogs removed —
          host verification now requires only Government ID.) */}
    </Layout>
  );
}