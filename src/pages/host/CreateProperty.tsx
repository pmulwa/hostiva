import { useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
const LocationMap = lazy(() => import('@/components/LocationMap'));
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { optimizeImage } from '@/lib/imageOptimizer';
import { BulkPhotoImporter } from '@/components/host/BulkPhotoImporter';
import { getPlatformControls } from '@/hooks/usePlatformControls';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft, Home, MapPin, Sparkles, Upload, Plus, X, Minus,
  Wifi, CookingPot, Car, Wind, Tv, Flame, Dumbbell, Waves,
  Droplets, WashingMachine, Zap, ChevronRight, Loader2, Users, BedDouble, Bath,
  Download, Search, Check, GripVertical, Globe, AlertCircle,
  ShieldCheck, Baby, Coffee, Utensils, Dog, Cigarette, Mountain, TreePine,
  Shirt, Thermometer, UtensilsCrossed, Microwave, Refrigerator, DoorOpen,
  Armchair, BookOpen, Music, Gamepad2, Camera, Bike, Anchor, Sailboat,
  Tent, FireExtinguisher, BriefcaseMedical, Lock, Eye, Bell, CircleDollarSign,
  ImagePlus, FolderUp
} from 'lucide-react';

const platforms = [
  { id: 'airbnb', label: 'Airbnb', emoji: '🏠', placeholder: 'https://www.airbnb.com/rooms/12345' },
  { id: 'booking', label: 'Booking.com', emoji: '🔵', placeholder: 'https://www.booking.com/hotel/...' },
  { id: 'vrbo', label: 'VRBO', emoji: '🏡', placeholder: 'https://www.vrbo.com/...' },
  { id: 'expedia', label: 'Expedia', emoji: '✈️', placeholder: 'https://www.expedia.com/...' },
  { id: 'tripadvisor', label: 'TripAdvisor', emoji: '🦉', placeholder: 'https://www.tripadvisor.com/...' },
  { id: 'other', label: 'Other', emoji: '🌐', placeholder: 'https://...' },
];
import type { Database } from '@/integrations/supabase/types';

type PropertyType = Database['public']['Enums']['property_type'];

// ─── Constants ───────────────────────────────────────────────

const steps = [
  { id: 1, title: 'Property Type', emoji: '🏠' },
  { id: 2, title: 'Location', emoji: '📍' },
  { id: 3, title: 'Size & Basics', emoji: '📐' },
  { id: 4, title: 'Cover Photo', emoji: '📸' },
  { id: 5, title: 'Amenities', emoji: '✨' },
  { id: 6, title: 'Name & Description', emoji: '✍️' },
  { id: 7, title: 'Pricing', emoji: '💰' },
  { id: 8, title: 'House Rules', emoji: '📋' },
  { id: 9, title: 'Review & Publish', emoji: '🚀' },
];

const placeTypes = [
  { value: 'entire', label: 'Entire place', desc: 'Guests have the whole place', icon: '🏡' },
  { value: 'private', label: 'Private room', desc: 'Private room, shared spaces', icon: '🚪' },
  { value: 'shared', label: 'Shared room', desc: 'Share a room with others', icon: '🛏️' },
  { value: 'hotel', label: 'Hotel room', desc: 'Hotel-style experience', icon: '🏨' },
];

const categories = [
  { emoji: '🏖️', label: 'Beachfront' },
  { emoji: '🏕️', label: 'Cabins' },
  { emoji: '🔥', label: 'Trending' },
  { emoji: '🌾', label: 'Countryside' },
  { emoji: '🏊', label: 'Amazing Pools' },
  { emoji: '🏝️', label: 'Islands' },
  { emoji: '🏞️', label: 'Lakefront' },
  { emoji: '⛰️', label: 'National Parks' },
  { emoji: '🎨', label: 'Design' },
  { emoji: '🏰', label: 'Castles' },
  { emoji: '💎', label: 'Luxury' },
  { emoji: '🌳', label: 'Treehouses' },
  { emoji: '🌴', label: 'Tropical' },
  { emoji: '⛺', label: 'Camping' },
  { emoji: '🐄', label: 'Farms' },
  { emoji: '⛷️', label: 'Skiing' },
];

const amenityGroups = [
  {
    label: 'Essentials',
    items: [
      { id: 'wifi', label: 'Wifi', icon: Wifi },
      { id: 'kitchen', label: 'Kitchen', icon: CookingPot },
      { id: 'parking', label: 'Parking', icon: Car },
      { id: 'ac', label: 'Air conditioning', icon: Wind },
      { id: 'tv', label: 'TV', icon: Tv },
      { id: 'heating', label: 'Heating', icon: Flame },
      { id: 'iron', label: 'Iron', icon: Thermometer },
      { id: 'hair_dryer', label: 'Hair dryer', icon: Wind },
    ],
  },
  {
    label: 'Kitchen & Dining',
    items: [
      { id: 'microwave', label: 'Microwave', icon: Microwave },
      { id: 'refrigerator', label: 'Refrigerator', icon: Refrigerator },
      { id: 'dishwasher', label: 'Dishwasher', icon: UtensilsCrossed },
      { id: 'coffee_maker', label: 'Coffee maker', icon: Coffee },
      { id: 'oven', label: 'Oven / Stove', icon: Flame },
      { id: 'dining_table', label: 'Dining table', icon: Utensils },
    ],
  },
  {
    label: 'Standout',
    items: [
      { id: 'gym', label: 'Gym', icon: Dumbbell },
      { id: 'pool', label: 'Pool', icon: Waves },
      { id: 'hottub', label: 'Hot tub', icon: Droplets },
      { id: 'sauna', label: 'Sauna', icon: Flame },
      { id: 'ev', label: 'EV charger', icon: Zap },
    ],
  },
  {
    label: 'Laundry',
    items: [
      { id: 'washer', label: 'Washer', icon: WashingMachine },
      { id: 'dryer', label: 'Dryer', icon: WashingMachine },
      { id: 'closet', label: 'Walk-in closet', icon: Shirt },
    ],
  },
  {
    label: 'Outdoor & Nature',
    items: [
      { id: 'balcony', label: 'Balcony / Patio', icon: DoorOpen },
      { id: 'garden', label: 'Garden', icon: TreePine },
      { id: 'bbq', label: 'BBQ grill', icon: Flame },
      { id: 'mountain_view', label: 'Mountain view', icon: Mountain },
      { id: 'lake_access', label: 'Lake access', icon: Anchor },
      { id: 'beach_access', label: 'Beach access', icon: Sailboat },
      { id: 'bike', label: 'Bikes available', icon: Bike },
      { id: 'camping_gear', label: 'Camping gear', icon: Tent },
    ],
  },
  {
    label: 'Entertainment',
    items: [
      { id: 'game_console', label: 'Game console', icon: Gamepad2 },
      { id: 'board_games', label: 'Board games', icon: BookOpen },
      { id: 'sound_system', label: 'Sound system', icon: Music },
      { id: 'projector', label: 'Projector', icon: Camera },
      { id: 'library', label: 'Library / Books', icon: BookOpen },
    ],
  },
  {
    label: 'Family',
    items: [
      { id: 'baby_crib', label: 'Baby crib', icon: Baby },
      { id: 'high_chair', label: 'High chair', icon: Armchair },
      { id: 'pets_allowed', label: 'Pets allowed', icon: Dog },
    ],
  },
  {
    label: 'Safety & Security',
    items: [
      { id: 'smoke_detector', label: 'Smoke detector', icon: Bell },
      { id: 'fire_extinguisher', label: 'Fire extinguisher', icon: FireExtinguisher },
      { id: 'first_aid', label: 'First aid kit', icon: BriefcaseMedical },
      { id: 'security_cameras', label: 'Security cameras', icon: Eye },
      { id: 'safe', label: 'Safe / Lockbox', icon: Lock },
      { id: 'gated', label: 'Gated property', icon: ShieldCheck },
    ],
  },
];

// Flatten for lookups
const allAmenities = amenityGroups.flatMap(g => g.items);

const allCountries = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria",
  "Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan",
  "Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cabo Verde","Cambodia",
  "Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica",
  "Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt",
  "El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon",
  "Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana",
  "Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel",
  "Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan","Laos",
  "Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi",
  "Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova",
  "Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands",
  "New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau",
  "Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania",
  "Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal",
  "Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea",
  "South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan",
  "Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu",
  "Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela",
  "Vietnam","Yemen","Zambia","Zimbabwe"
];

const propertyTypeMap: Record<string, PropertyType> = {
  'entire': 'house', 'private': 'apartment', 'shared': 'apartment', 'hotel': 'hotel',
};

// ─── Sortable Photo Component ────────────────────────────────

function SortablePhoto({ id, photo, index, onRemove }: {
  id: string; photo: { file?: File; preview: string; isUrl?: boolean }; index: number; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto' as any,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group rounded-xl overflow-hidden aspect-[4/3] border border-border bg-card">
      <div {...attributes} {...listeners} className="absolute top-2 left-2 z-10 bg-foreground/60 text-background rounded-md p-1 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      <img
        src={photo.isUrl
          ? `https://images.weserv.nl/?url=${encodeURIComponent(photo.preview)}&w=800&output=jpg&q=80`
          : photo.preview
        }
        alt={`Photo ${index + 1}`}
        className="w-full h-full object-cover"
        onError={(e) => {
          // Fallback: try original URL directly if proxy fails
          const img = e.currentTarget;
          if (img.src.includes('weserv.nl')) {
            img.src = photo.preview;
          }
        }}
      />
      {index === 0 && (
        <span className="absolute top-2 left-10 bg-primary text-primary-foreground text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm">
          Cover
        </span>
      )}
      <span className="absolute top-2 right-2 bg-foreground/70 text-background text-[10px] font-bold w-6 h-6 rounded-md flex items-center justify-center shadow-sm">
        {index + 1}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="absolute bottom-2 right-2 bg-destructive text-destructive-foreground rounded-full w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Counter Component ───────────────────────────────────────

function Counter({ label, subtitle, value, onChange, min = 0 }: {
  label: string; subtitle: string; value: number; onChange: (v: number) => void; min?: number;
}) {
  return (
    <div className="flex items-center justify-between py-5 border-b border-border last:border-b-0">
      <div>
        <p className="font-semibold text-foreground text-[15px]">{label}</p>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="font-bold text-xl w-8 text-center text-foreground tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Country Combobox ────────────────────────────────────────

function CountryCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return allCountries;
    const q = search.toLowerCase();
    return allCountries.filter(c => c.toLowerCase().includes(q));
  }, [search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-between w-full h-10 px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background text-left hover:bg-accent/50 transition-colors"
        >
          <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
            {value || 'Search countries...'}
          </span>
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0 z-[2000]" align="start">
        <div className="p-2 border-b border-border">
          <div className="flex items-center gap-2 px-2">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
              placeholder="Type to search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-[240px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground px-3 py-4 text-center">No country found.</p>
          )}
          {filtered.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setOpen(false); setSearch(''); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md text-left transition-colors ${
                value === c ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-accent'
              }`}
            >
              {value === c && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
              <span className={value === c ? '' : 'ml-5'}>{c}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main Component ──────────────────────────────────────────

export default function CreateProperty() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Import mode
  const [showImport, setShowImport] = useState(false);
  const [importPlatform, setImportPlatform] = useState('airbnb');
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importStep, setImportStep] = useState(0);
  const [importedImageUrls, setImportedImageUrls] = useState<string[]>([]);

  // Step 1
  const [placeType, setPlaceType] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  // Step 2
  const [address, setAddress] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLng, setPinLng] = useState<number | null>(null);

  // Step 3
  const [guests, setGuests] = useState(4);
  const [bedrooms, setBedrooms] = useState(2);
  const [beds, setBeds] = useState(2);
  const [bathrooms, setBathrooms] = useState(1);

  // Step 4
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [amenityPricing, setAmenityPricing] = useState<Record<string, 'free' | 'paid'>>({});
  const [amenityPhotos, setAmenityPhotos] = useState<Record<string, { id: string; file: File; preview: string }[]>>({});
  const amenityPhotoRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Extra amenity details (parking onsite, pool location/heated)
  const [amenityExtras, setAmenityExtras] = useState<Record<string, Record<string, string>>>({});

  // Step 5
  const [photos, setPhotos] = useState<{ id: string; file?: File; preview: string; isUrl?: boolean }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Step 6
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Step 7
  const [nightlyRate, setNightlyRate] = useState(100);
  const [cleaningFee, setCleaningFee] = useState(0);
  const [minNights, setMinNights] = useState(1);
  const [instantBook, setInstantBook] = useState(false);
  const [serviceFeeChargedTo, setServiceFeeChargedTo] = useState<'guest' | 'host' | 'split'>('guest');

  // Step 9 — Insurance acknowledgement (one-time, persisted in localStorage)
  const [insuranceAck, setInsuranceAck] = useState<boolean>(() => {
    try { return localStorage.getItem('hostly_insurance_ack') === 'true'; } catch { return false; }
  });
  const previouslyAcknowledged = useMemo(() => {
    try { return localStorage.getItem('hostly_insurance_ack') === 'true'; } catch { return false; }
  }, []);

  // Step 8 - Standard rules (checkbox-based)
  const [standardRules, setStandardRules] = useState<Record<string, boolean>>({
    'No smoking': true,
    'No parties or events': true,
    'No pets': false,
    'Pets allowed — ask host': false,
    'Quiet hours': true,
    'No shoes in the house': false,
    'No unregistered guests': false,
    'No loud music after quiet hours': false,
    'Self check-in with lockbox': false,
  });
  // Time settings for rules
  const [quietHoursStart, setQuietHoursStart] = useState('22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('08:00');
  const [checkInTime, setCheckInTime] = useState('15:00');
  const [checkOutTime, setCheckOutTime] = useState('11:00');
  const toggleStandardRule = (rule: string) => {
    setStandardRules(prev => {
      const next = { ...prev, [rule]: !prev[rule] };
      // Mutually exclusive: pets
      if (rule === 'No pets' && next['No pets']) next['Pets allowed — ask host'] = false;
      if (rule === 'Pets allowed — ask host' && next['Pets allowed — ask host']) next['No pets'] = false;
      return next;
    });
  };
  // Custom rules
  const [houseRules, setHouseRules] = useState<string[]>([]);
  const [newCustomRule, setNewCustomRule] = useState('');

  // Import summary
  const [showImportSummary, setShowImportSummary] = useState(false);
  const [importedData, setImportedData] = useState<any>(null);

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ─── URL Validation ─────────────────────────────────────────
  const validateImportUrl = (rawUrl: string): string | null => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return 'Please enter a URL.';
    
    let parsed: URL;
    try { parsed = new URL(trimmed); } catch {
      return 'Invalid URL format. Please paste a full URL like https://www.airbnb.com/rooms/12345';
    }
    
    if (parsed.protocol !== 'https:') return 'URL must use HTTPS.';
    
    const hostname = parsed.hostname.replace(/^www\./, '');
    
    const platformDomains: Record<string, string[]> = {
      airbnb: ['airbnb.com', 'airbnb.co.uk', 'airbnb.ca', 'airbnb.com.au', 'airbnb.de', 'airbnb.fr', 'airbnb.es', 'airbnb.it', 'airbnb.co.in', 'airbnb.co.ke'],
      booking: ['booking.com'],
      vrbo: ['vrbo.com', 'homeaway.com'],
      expedia: ['expedia.com', 'expedia.co.uk', 'expedia.ca'],
      tripadvisor: ['tripadvisor.com', 'tripadvisor.co.uk', 'tripadvisor.ca'],
    };

    if (importPlatform !== 'other') {
      const allowed = platformDomains[importPlatform] || [];
      if (!allowed.some(d => hostname === d || hostname.endsWith('.' + d))) {
        return `This URL doesn't appear to be from ${platforms.find(p => p.id === importPlatform)?.label}. Please paste a valid listing URL or select "Other".`;
      }
    }

    if (importPlatform === 'airbnb') {
      if (!parsed.pathname.match(/^\/(rooms|luxury)\/\d+/) && !parsed.pathname.match(/^\/h\/[a-z0-9-]+/)) {
        return 'This is not a valid Airbnb listing. Please use a direct listing URL like https://www.airbnb.com/rooms/12345 — not a search page or homepage.';
      }
    }

    if (importPlatform === 'booking') {
      if (!parsed.pathname.includes('/hotel/')) {
        return 'This is not a valid Booking.com property page. Please use a direct hotel URL like https://www.booking.com/hotel/us/hotel-name.html';
      }
    }

    const rejectedPaths = ['/search', '/s/', '/login', '/signup', '/help', '/contact', '/about'];
    if (rejectedPaths.some(p => parsed.pathname.toLowerCase().startsWith(p))) {
      return 'This looks like a search, login, or help page — not a property listing. Please paste a direct link to a specific property.';
    }

    return null; // Valid
  };

  // ─── Import Handler ────────────────────────────────────────
  const handleImport = async () => {
    const validationError = validateImportUrl(importUrl);
    if (validationError) {
      toast({ title: 'Invalid URL', description: validationError, variant: 'destructive' });
      return;
    }
    setIsImporting(true);
    setImportStep(1);
    const stepTimer1 = setTimeout(() => setImportStep(2), 4000);
    const stepTimer2 = setTimeout(() => setImportStep(3), 9000);
    const stepTimer3 = setTimeout(() => setImportStep(4), 14000);
    try {
      const { data, error } = await supabase.functions.invoke('import-listing', {
        body: { url: importUrl.trim(), platform: importPlatform },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const d = data?.data;
      if (!d) throw new Error('No data returned');

      // Auto-fill form fields
      if (d.title) setTitle(d.title.slice(0, 60));
      if (d.description) setDescription(d.description);
      if (d.place_type) setPlaceType(d.place_type);
      if (d.property_type) {
        // Map property_type to placeType if place_type wasn't set
        if (!d.place_type) {
          const ptMap: Record<string, string> = { hotel: 'hotel', resort: 'hotel' };
          setPlaceType(ptMap[d.property_type] || 'entire');
        }
      }
      if (d.category) setSelectedCategory(d.category);
      if (d.address) setAddress(d.address);
      if (d.city) setCity(d.city);
      if (d.state) setState(d.state);
      if (d.country) setCountry(d.country);
      if (d.postal_code) setPostalCode(d.postal_code);
      
      // Auto-pin location from geocoded coordinates
      if (d.latitude && d.longitude) {
        setPinLat(d.latitude);
        setPinLng(d.longitude);
      }
      
      if (d.bedrooms != null) setBedrooms(d.bedrooms);
      if (d.beds != null) setBeds(d.beds);
      if (d.bathrooms != null) setBathrooms(d.bathrooms);
      if (d.max_guests != null) setGuests(d.max_guests);
      if (d.price_per_night != null) setNightlyRate(d.price_per_night);
      if (d.cleaning_fee != null) setCleaningFee(d.cleaning_fee);
      if (d.house_rules?.length) setHouseRules(d.house_rules);
      if (d.check_in_time) setCheckInTime(d.check_in_time);
      if (d.check_out_time) setCheckOutTime(d.check_out_time);

      // Store imported image URLs AND auto-populate cover photos.
      // Many third-party CDNs block hotlinking, which causes blank tiles in
      // the gallery. We mirror those URLs into our own storage bucket via the
      // `mirror-image-urls` edge function so they always render.
      if (d.image_urls?.length) {
        let usableUrls: string[] = d.image_urls;
        try {
          const { data: m } = await supabase.functions.invoke('mirror-image-urls', {
            body: { urls: d.image_urls },
          });
          const mirrored: { source: string; url: string }[] = m?.mirrored || [];
          if (mirrored.length) {
            const map = new Map(mirrored.map((x) => [x.source, x.url]));
            usableUrls = d.image_urls
              .map((u: string) => map.get(u))
              .filter((u: string | undefined): u is string => !!u);
            if (usableUrls.length === 0) usableUrls = d.image_urls; // fallback
          }
        } catch (e) {
          // Non-fatal — fall back to remote URLs (may render blank if blocked).
          console.warn('mirror-image-urls failed, using remote URLs:', e);
        }
        setImportedImageUrls(usableUrls);
        const urlPhotos = usableUrls.map((url: string, i: number) => ({
          id: `imported-${i}-${Date.now()}`,
          preview: url,
          isUrl: true,
        }));
        setPhotos(urlPhotos);
      }

      // Comprehensive amenity mapping
      if (d.amenities?.length) {
        const amenityMap: Record<string, string> = {
          'wifi': 'wifi', 'wi-fi': 'wifi', 'wireless internet': 'wifi', 'internet': 'wifi', 'broadband': 'wifi',
          'kitchen': 'kitchen', 'full kitchen': 'kitchen', 'kitchenette': 'kitchen', 'shared kitchen': 'kitchen',
          'parking': 'parking', 'free parking': 'parking', 'garage': 'parking', 'car park': 'parking', 'street parking': 'parking', 'driveway': 'parking', 'parking space': 'parking',
          'air conditioning': 'ac', 'ac': 'ac', 'a/c': 'ac', 'central air': 'ac', 'air conditioner': 'ac', 'climate control': 'ac', 'cooling': 'ac',
          'tv': 'tv', 'television': 'tv', 'smart tv': 'tv', 'flat screen tv': 'tv', 'cable tv': 'tv', 'hdtv': 'tv', 'netflix': 'tv', 'streaming': 'tv',
          'heating': 'heating', 'central heating': 'heating', 'radiator': 'heating', 'heater': 'heating', 'underfloor heating': 'heating', 'fireplace': 'heating',
          'iron': 'iron', 'ironing board': 'iron', 'clothes iron': 'iron',
          'hair dryer': 'hair_dryer', 'hairdryer': 'hair_dryer', 'blow dryer': 'hair_dryer',
          'microwave': 'microwave', 'microwave oven': 'microwave',
          'refrigerator': 'refrigerator', 'fridge': 'refrigerator', 'mini fridge': 'refrigerator', 'freezer': 'refrigerator',
          'dishwasher': 'dishwasher', 'dish washer': 'dishwasher',
          'coffee maker': 'coffee_maker', 'coffee machine': 'coffee_maker', 'espresso machine': 'coffee_maker', 'nespresso': 'coffee_maker', 'coffee': 'coffee_maker', 'keurig': 'coffee_maker',
          'oven': 'oven', 'stove': 'oven', 'cooktop': 'oven', 'gas stove': 'oven', 'electric stove': 'oven', 'induction': 'oven',
          'dining table': 'dining_table', 'dining area': 'dining_table', 'breakfast bar': 'dining_table',
          'gym': 'gym', 'fitness center': 'gym', 'fitness room': 'gym', 'exercise room': 'gym', 'workout room': 'gym', 'fitness': 'gym',
          'pool': 'pool', 'swimming pool': 'pool', 'indoor pool': 'pool', 'outdoor pool': 'pool', 'shared pool': 'pool', 'private pool': 'pool', 'infinity pool': 'pool', 'plunge pool': 'pool',
          'hot tub': 'hottub', 'hottub': 'hottub', 'jacuzzi': 'hottub', 'spa': 'hottub', 'whirlpool': 'hottub',
          'sauna': 'sauna', 'steam room': 'sauna',
          'ev charger': 'ev', 'electric vehicle charger': 'ev', 'tesla charger': 'ev', 'ev charging': 'ev',
          'washer': 'washer', 'washing machine': 'washer', 'laundry': 'washer',
          'dryer': 'dryer', 'tumble dryer': 'dryer', 'clothes dryer': 'dryer',
          'walk-in closet': 'closet', 'closet': 'closet', 'wardrobe': 'closet',
          'balcony': 'balcony', 'patio': 'balcony', 'terrace': 'balcony', 'deck': 'balcony', 'veranda': 'balcony', 'porch': 'balcony', 'outdoor space': 'balcony',
          'garden': 'garden', 'backyard': 'garden', 'yard': 'garden', 'lawn': 'garden', 'courtyard': 'garden',
          'bbq': 'bbq', 'bbq grill': 'bbq', 'barbecue': 'bbq', 'grill': 'bbq', 'outdoor grill': 'bbq',
          'mountain view': 'mountain_view', 'mountain views': 'mountain_view', 'scenic view': 'mountain_view',
          'lake access': 'lake_access', 'lake view': 'lake_access', 'lakefront': 'lake_access', 'waterfront': 'lake_access',
          'beach access': 'beach_access', 'beachfront': 'beach_access', 'beach': 'beach_access', 'ocean view': 'beach_access', 'sea view': 'beach_access',
          'bikes': 'bike', 'bicycles': 'bike', 'bike': 'bike', 'bicycle': 'bike', 'bikes available': 'bike',
          'camping gear': 'camping_gear', 'camping equipment': 'camping_gear',
          'game console': 'game_console', 'playstation': 'game_console', 'xbox': 'game_console', 'nintendo': 'game_console', 'gaming': 'game_console', 'video games': 'game_console',
          'board games': 'board_games', 'games': 'board_games', 'puzzles': 'board_games',
          'sound system': 'sound_system', 'bluetooth speaker': 'sound_system', 'speaker': 'sound_system', 'sonos': 'sound_system', 'stereo': 'sound_system',
          'projector': 'projector', 'home theater': 'projector', 'cinema': 'projector', 'home cinema': 'projector',
          'library': 'library', 'books': 'library', 'bookshelf': 'library', 'reading room': 'library',
          'baby crib': 'baby_crib', 'crib': 'baby_crib', 'cot': 'baby_crib', 'baby bed': 'baby_crib', 'pack n play': 'baby_crib',
          'high chair': 'high_chair', 'highchair': 'high_chair', 'booster seat': 'high_chair',
          'pets allowed': 'pets_allowed', 'pet friendly': 'pets_allowed', 'dog friendly': 'pets_allowed', 'cat friendly': 'pets_allowed',
          'smoke detector': 'smoke_detector', 'smoke alarm': 'smoke_detector', 'carbon monoxide detector': 'smoke_detector', 'carbon monoxide alarm': 'smoke_detector',
          'fire extinguisher': 'fire_extinguisher',
          'first aid kit': 'first_aid', 'first aid': 'first_aid', 'medical kit': 'first_aid',
          'security cameras': 'security_cameras', 'cctv': 'security_cameras', 'surveillance': 'security_cameras', 'security camera': 'security_cameras',
          'safe': 'safe', 'lockbox': 'safe', 'safe box': 'safe', 'in-room safe': 'safe', 'safety box': 'safe',
          'gated property': 'gated', 'gated community': 'gated', 'gated': 'gated', 'security gate': 'gated',
        };
        const matched = d.amenities
          .map((a: string) => amenityMap[a.toLowerCase()] || amenityMap[a.toLowerCase().replace(/[^a-z0-9\s/'-]/g, '').trim()])
          .filter((v: string | undefined): v is string => !!v);
        const unique = [...new Set(matched)] as string[];
        if (unique.length) setSelectedAmenities(unique);
      }

      setImportedData(d);
      setShowImportSummary(true);
      toast({
        title: '✅ Listing imported!',
        description: `"${d.title}" — Review the summary below before proceeding.`,
      });
    } catch (err: any) {
      toast({
        title: 'Import failed',
        description: err.message || 'Could not import listing. Try a different URL.',
        variant: 'destructive',
      });
    } finally {
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      clearTimeout(stepTimer3);
      setIsImporting(false);
      setImportStep(0);
    }
  };

  const toggleAmenity = (id: string) => {
    setSelectedAmenities(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const handlePhotoDrop = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newPhotos = files.map(file => ({
      id: `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      preview: URL.createObjectURL(file),
    }));
    setPhotos(prev => [...prev, ...newPhotos]);
    // Reset input so same file can be re-selected
    if (e.target) e.target.value = '';
  }, []);

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setPhotos((prev) => {
        const oldIndex = prev.findIndex(p => p.id === active.id);
        const newIndex = prev.findIndex(p => p.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1: return placeType !== '' && selectedCategory !== '';
      case 2: return address.trim() && country.trim() && city.trim() && state.trim() && pinLat !== null && pinLng !== null;
      case 3: return guests >= 1;
      case 4: return photos.length >= 1;
      case 5: {
        if (selectedAmenities.length === 0) return false;
        return selectedAmenities.every(id => (amenityPhotos[id] || []).length >= 1);
      }
      case 6: return title.trim().length > 0;
      case 7: return nightlyRate > 0;
      case 8: return true;
      case 9: return insuranceAck;
      default: return true;
    }
  };

  const handleSubmit = async () => {
    if (!user) { navigate('/auth'); return; }

    // Admin control: multiple_listings. When OFF, hosts may only own one
    // active or pending listing.
    const platformControls = await getPlatformControls();
    if (platformControls.host_rights.multiple_listings === false) {
      const { count } = await supabase
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('host_id', user.id)
        .in('status', ['active', 'pending_approval', 'paused'] as any);
      if ((count ?? 0) >= 1) {
        toast({
          title: 'Multiple listings disabled',
          description: 'The platform currently allows only one listing per host. Remove your existing listing before publishing a new one.',
          variant: 'destructive',
        });
        return;
      }
    }

    if (!insuranceAck) {
      toast({
        title: 'Acknowledgement required',
        description: 'Please confirm you understand Hostiva does not provide damage insurance before publishing.',
        variant: 'destructive',
      });
      return;
    }
    try { localStorage.setItem('hostly_insurance_ack', 'true'); } catch {}
    setIsSubmitting(true);

    let coverImageUrl: string | null = null;
    const imageUrls: string[] = [];

    // Upload property photos
    for (const photo of photos) {
      if (photo.isUrl) {
        imageUrls.push(photo.preview);
        if (!coverImageUrl) coverImageUrl = photo.preview;
      } else if (photo.file) {
        const optimized = await optimizeImage(photo.file);
        if (!optimized) {
          toast({
            title: 'Photo skipped',
            description: `"${photo.file.name}" is below 1024px on the long edge. Please upload a higher-resolution image (2048px+ recommended).`,
            variant: 'destructive',
          });
          continue;
        }
        const filePath = `properties/${user.id}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('property-images')
          .upload(filePath, optimized.file, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('property-images').getPublicUrl(filePath);
          imageUrls.push(urlData.publicUrl);
          if (!coverImageUrl) coverImageUrl = urlData.publicUrl;
        } else {
          console.error('Upload error:', uploadError.message);
        }
      }
    }

    // Upload amenity photos and merge into property images
    for (const amenityId of selectedAmenities) {
      const aPhotos = amenityPhotos[amenityId] || [];
      for (const aPhoto of aPhotos) {
        // If this is an imported URL photo (no real file), just use the URL directly
        if (!aPhoto.file || (aPhoto.file as any) === null) {
          if (aPhoto.preview.startsWith('http')) {
            imageUrls.push(aPhoto.preview);
          }
          continue;
        }
        const optimized = await optimizeImage(aPhoto.file);
        if (!optimized) {
          toast({
            title: 'Amenity photo skipped',
            description: `"${aPhoto.file.name}" is below the 1024px minimum. Use a sharper photo (2048px+ recommended).`,
            variant: 'destructive',
          });
          continue;
        }
        const filePath = `properties/${user.id}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('property-images')
          .upload(filePath, optimized.file, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('property-images').getPublicUrl(filePath);
          imageUrls.push(urlData.publicUrl);
        } else {
          console.error('Amenity photo upload error:', uploadError.message);
        }
      }
    }

    // Admin control: auto_approve_verified — verified hosts skip the
    // moderation queue when the platform allows it.
    let initialStatus: 'active' | 'pending_approval' = 'pending_approval';
    if (platformControls.property_approvals.auto_approve_verified === true) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('is_verified')
        .eq('user_id', user.id)
        .maybeSingle();
      if (prof?.is_verified) initialStatus = 'active';
    }

    const { data: propertyData, error } = await supabase
      .from('properties')
      .insert({
        host_id: user.id,
        title,
        description: description || null,
        property_type: propertyTypeMap[placeType] || 'apartment',
        address,
        city,
        state: state || null,
        country,
        postal_code: postalCode || null,
        latitude: pinLat,
        longitude: pinLng,
        bedrooms,
        beds,
        bathrooms,
        max_guests: guests,
        price_per_night: nightlyRate,
        cleaning_fee: cleaningFee,
        min_nights: minNights,
        instant_booking: instantBook,
        service_fee_charged_to: serviceFeeChargedTo,
        cover_image: coverImageUrl,
        images: imageUrls,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        house_rules: [
          ...Object.entries(standardRules).filter(([, v]) => v).map(([k]) => {
            if (k === 'Quiet hours') return `Quiet hours (${quietHoursStart} – ${quietHoursEnd})`;
            if (k === 'No loud music after quiet hours') return `No loud music after ${quietHoursStart}`;
            return k;
          }),
          ...houseRules,
        ],
        status: initialStatus,
      } as any)
      .select()
      .single();

    if (error || !propertyData) {
      toast({ title: 'Error creating listing', description: error?.message, variant: 'destructive' });
      setIsSubmitting(false);
      return;
    }

    // Save amenities to property_amenities join table
    if (selectedAmenities.length > 0) {
      // Map local amenity IDs to DB amenity IDs by name
      const { data: dbAmenities } = await supabase.from('amenities').select('id, name');
      if (dbAmenities) {
        const nameToDbId: Record<string, string> = {};
        dbAmenities.forEach(a => { nameToDbId[a.name.toLowerCase()] = a.id; });
        
        // Map local IDs to labels then to DB IDs
        const amenityRows = selectedAmenities
          .map(localId => {
            const localAmenity = allAmenities.find(a => a.id === localId);
            if (!localAmenity) return null;
            const dbId = nameToDbId[localAmenity.label.toLowerCase()];
            return dbId ? { property_id: (propertyData as any).id, amenity_id: dbId } : null;
          })
          .filter(Boolean);

        if (amenityRows.length > 0) {
          await supabase.from('property_amenities').insert(amenityRows as any);
        }
      }
    }

    toast({ title: '🎉 Property submitted!', description: 'Your listing will be reviewed within 24 hours.' });
    navigate('/host/dashboard');
    setIsSubmitting(false);
  };

  if (!user) { navigate('/auth'); return null; }

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background">
        <div className="container mx-auto px-4 py-8 max-w-[760px]">

          {/* ════════ IMPORT SUMMARY ════════ */}
          {showImportSummary && importedData ? (
            <>
              <button
                type="button"
                onClick={() => { setShowImportSummary(false); setShowImport(true); }}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 font-medium"
              >
                <ArrowLeft className="w-4 h-4" /> Back to import
              </button>

              <div className="bg-card rounded-2xl shadow-[0_2px_24px_-4px_hsl(var(--foreground)/0.06)] border border-border/60 p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Check className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-[22px] font-extrabold text-foreground leading-tight">Import Summary</h3>
                    <p className="text-muted-foreground text-sm">Review what we extracted. You can edit everything in the next steps.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Title & Description */}
                  {title && (
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Title</p>
                      <p className="text-foreground font-semibold">{title}</p>
                    </div>
                  )}
                  {description && (
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                      <p className="text-foreground text-sm leading-relaxed line-clamp-4">{description}</p>
                    </div>
                  )}

                  {/* Location */}
                  {(city || country || address) && (
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">📍 Location</p>
                      <p className="text-foreground text-sm">
                        {[address, city, state, postalCode, country].filter(Boolean).join(', ')}
                      </p>
                    </div>
                  )}

                  {/* Size & Basics */}
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">📐 Size & Basics</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="text-center p-2 rounded-lg bg-background border border-border">
                        <p className="text-lg font-bold text-foreground">{guests}</p>
                        <p className="text-xs text-muted-foreground">Guests</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-background border border-border">
                        <p className="text-lg font-bold text-foreground">{bedrooms}</p>
                        <p className="text-xs text-muted-foreground">Bedrooms</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-background border border-border">
                        <p className="text-lg font-bold text-foreground">{beds}</p>
                        <p className="text-xs text-muted-foreground">Beds</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-background border border-border">
                        <p className="text-lg font-bold text-foreground">{bathrooms}</p>
                        <p className="text-xs text-muted-foreground">Bathrooms</p>
                      </div>
                    </div>
                  </div>

                  {/* Pricing */}
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">💰 Pricing</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-extrabold text-rating">${nightlyRate}</span>
                      <span className="text-sm text-rating/80">/ night</span>
                      {cleaningFee > 0 && (
                        <span className="text-sm text-muted-foreground ml-3">+ ${cleaningFee} cleaning fee</span>
                      )}
                    </div>
                  </div>

                  {/* Amenities */}
                  {selectedAmenities.length > 0 && (
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">✨ Amenities</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedAmenities.map((a) => {
                          const amenity = allAmenities.find(am => am.id === a);
                          return (
                            <span key={a} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20">
                              {amenity ? <amenity.icon className="w-3 h-3" /> : null}
                              {amenity?.label || a}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* House Rules */}
                  {houseRules.length > 0 && (
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">📋 House Rules</p>
                      <ul className="space-y-1">
                        {houseRules.map((rule, i) => (
                          <li key={i} className="text-sm text-foreground flex items-start gap-2">
                            <span className="text-muted-foreground mt-0.5">•</span>
                            {rule}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Place Type */}
                  {placeType && (
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">🏠 Property Type</p>
                      <p className="text-foreground text-sm font-semibold capitalize">{placeType.replace('_', ' ')}</p>
                    </div>
                  )}

                  {/* Imported Photos */}
                  {importedImageUrls.length > 0 && (
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">📸 Photos ({importedImageUrls.length})</p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {importedImageUrls.slice(0, 8).map((imgUrl, i) => (
                          <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border bg-background">
                            <img
                              src={imgUrl}
                              alt={`Property photo ${i + 1}`}
                              className="w-full h-full object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            {i === 0 && (
                              <span className="absolute top-1 left-1 bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0.5 rounded">Cover</span>
                            )}
                          </div>
                        ))}
                        {importedImageUrls.length > 8 && (
                          <div className="aspect-square rounded-lg border border-border bg-muted flex items-center justify-center">
                            <span className="text-sm font-bold text-muted-foreground">+{importedImageUrls.length - 8}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-3 mt-6">
                  <Button
                    onClick={() => {
                      setShowImportSummary(false);
                      setShowImport(false);
                      setCurrentStep(1);
                    }}
                    className="w-full h-12 text-[15px] font-bold gap-2"
                  >
                    ✏️ Edit & Review Details
                  </Button>
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Preview & Publish will be available after you review all steps. Click "Edit & Review Details" to start.
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : showImport ? (
            <>
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 font-medium"
              >
                <ArrowLeft className="w-4 h-4" /> Fill manually instead
              </button>

              <div className="bg-card rounded-2xl shadow-[0_2px_24px_-4px_hsl(var(--foreground)/0.06)] border border-border/60 p-6 md:p-8">
                <h3 className="text-[26px] font-extrabold text-foreground leading-tight mb-1">Import your listing</h3>
                <p className="text-muted-foreground text-[15px] mb-6">
                  Paste your listing URL and we'll auto-fill everything — title, photos, amenities, pricing & more.
                </p>

                {/* Platform Selection */}
                <p className="font-bold text-foreground text-sm mb-3">Select your platform</p>
                <div className="grid grid-cols-3 gap-2.5 mb-6">
                  {platforms.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setImportPlatform(p.id)}
                      className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 transition-all ${
                        importPlatform === p.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/30 bg-card'
                      }`}
                    >
                      <span className="text-2xl">{p.emoji}</span>
                      <span className="text-xs font-semibold text-foreground">{p.label}</span>
                    </button>
                  ))}
                </div>

                {/* URL Input */}
                <div className="space-y-2 mb-4">
                  <Label className="text-foreground font-bold text-sm flex items-center gap-2">
                    <span className="text-lg">{platforms.find(p => p.id === importPlatform)?.emoji}</span>
                    {platforms.find(p => p.id === importPlatform)?.label} Listing URL
                  </Label>
                  <Input
                    placeholder={platforms.find(p => p.id === importPlatform)?.placeholder}
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    className="text-sm"
                  />
                  {/* Inline URL validation feedback */}
                  {importUrl.trim() && (() => {
                    const err = validateImportUrl(importUrl);
                    if (err) return (
                      <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                        <AlertCircle className="w-3 h-3 shrink-0" /> {err}
                      </p>
                    );
                    return (
                      <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 mt-1">
                        <Check className="w-3 h-3 shrink-0" /> Valid listing URL — ready to import
                      </p>
                    );
                  })()}
                </div>

                {/* Warning */}
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-6 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
                    AI will extract all details from the public listing. Private/paywalled pages may not work. Always verify imported data before publishing.
                  </p>
                </div>

                {/* Import Button / Loading State */}
                {isImporting ? (
                  <div className="space-y-5 py-2">
                    {[
                      { step: 1, label: 'Connecting to listing page...', icon: '🔗' },
                      { step: 2, label: 'Scraping content & photos...', icon: '📸' },
                      { step: 3, label: 'AI extracting property details...', icon: '🤖' },
                      { step: 4, label: 'Almost done, finalizing...', icon: '✨' },
                    ].map((s) => (
                      <div key={s.step} className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 ${
                          importStep > s.step
                            ? 'bg-primary/15'
                            : importStep === s.step
                            ? 'bg-primary/10 ring-2 ring-primary/30'
                            : 'bg-muted'
                        }`}>
                          {importStep > s.step ? (
                            <Check className="w-4 h-4 text-primary" />
                          ) : importStep === s.step ? (
                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                          ) : (
                            <span className="text-sm">{s.icon}</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={`text-sm font-medium transition-colors duration-300 ${
                            importStep >= s.step ? 'text-foreground' : 'text-muted-foreground/50'
                          }`}>
                            {s.label}
                          </p>
                          {importStep === s.step && (
                            <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                              <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }} />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Button
                    onClick={handleImport}
                    disabled={!importUrl.trim()}
                    className="w-full h-12 text-[15px] font-bold gap-2"
                  >
                    <Download className="w-4 h-4" /> Import from {platforms.find(p => p.id === importPlatform)?.label} <ChevronRight className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </>
          ) : (
          <>

          {/* ── Progress Dots ── */}
          <div className="flex items-center justify-center gap-1.5 mb-8">
            {steps.map((step) => (
              <div
                key={step.id}
                className={`h-[5px] rounded-full transition-all duration-500 ease-out ${
                  step.id < currentStep
                    ? 'bg-primary w-7'
                    : step.id === currentStep
                    ? 'bg-primary w-10'
                    : 'bg-muted w-3'
                }`}
              />
            ))}
          </div>

          {/* ── Step Header ── */}
          <div className="text-center mb-8">
            <p className="text-[11px] font-bold tracking-[0.2em] text-primary uppercase mb-1.5">
              Step {currentStep} of {steps.length}
            </p>
            <h2 className="text-lg font-bold text-foreground">
              <span className="mr-2">{steps[currentStep - 1].emoji}</span>
              {steps[currentStep - 1].title}
            </h2>
          </div>

          {/* ── Step Card ── */}
          <div className="bg-card rounded-2xl shadow-[0_2px_24px_-4px_hsl(var(--foreground)/0.06)] border border-border/60 p-6 md:p-8 mb-8">

            {/* ════════════ STEP 1: Property Type ════════════ */}
            {currentStep === 1 && (
              <div className="space-y-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-[26px] font-extrabold text-foreground leading-tight mb-1">What type of place?</h3>
                    <p className="text-muted-foreground text-[15px]">Choose the option that best describes your property.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowImport(true)} className="shrink-0 border-primary/40 bg-transparent hover:bg-primary/10 text-primary hover:text-primary gap-1.5 font-semibold text-xs">
                    <Download className="w-3.5 h-3.5" /> Import Listing
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {placeTypes.map((pt) => (
                    <button
                      key={pt.value}
                      type="button"
                      onClick={() => setPlaceType(pt.value)}
                      className={`flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 transition-all text-center ${
                        placeType === pt.value
                          ? 'border-primary bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]'
                          : 'border-border hover:border-muted-foreground/30 bg-card'
                      }`}
                    >
                      <span className="text-3xl">{pt.icon}</span>
                      <div>
                        <p className="font-bold text-foreground text-[15px]">{pt.label}</p>
                        <p className="text-xs text-muted-foreground">{pt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="pt-2">
                  <h4 className="text-lg font-bold text-foreground mb-0.5">Select a category</h4>
                  <p className="text-sm text-muted-foreground mb-4">Help guests discover your listing.</p>
                  <div className="grid grid-cols-4 gap-2.5">
                    {categories.map((cat) => (
                      <button
                        key={cat.label}
                        type="button"
                        onClick={() => setSelectedCategory(cat.label)}
                        className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition-all ${
                          selectedCategory === cat.label
                            ? 'border-primary bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]'
                            : 'border-border hover:border-muted-foreground/30 bg-card'
                        }`}
                      >
                        <span className="text-[26px] leading-none">{cat.emoji}</span>
                        <span className="text-[11px] font-semibold text-foreground text-center leading-tight">{cat.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ════════════ STEP 2: Location ════════════ */}
            {currentStep === 2 && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-[26px] font-extrabold text-foreground leading-tight mb-1">Where's your place?</h3>
                  <p className="text-muted-foreground text-[15px]">All fields are required. Pin your exact property location on the map.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-foreground font-semibold text-sm">Country <span className="text-destructive">*</span></Label>
                    <CountryCombobox value={country} onChange={setCountry} />
                  </div>
                </div>

                {/* Interactive Map */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-semibold flex items-center gap-1.5 ${pinLat !== null ? 'text-primary' : 'text-destructive'}`}>
                      📍 {pinLat !== null ? 'Location pinned!' : '⚠️ Click on the map to pin your exact location (required)'}
                    </p>
                    {pinLat !== null && (
                      <span className="text-xs text-muted-foreground">
                        {pinLat.toFixed(5)}, {pinLng!.toFixed(5)}
                      </span>
                    )}
                  </div>
                  <Suspense fallback={<div className="w-full h-[280px] rounded-xl bg-muted animate-pulse border border-border" />}>
                    <LocationMap
                      lat={pinLat}
                      lng={pinLng}
                      onLocationSelect={(lat, lng, reverseData) => {
                        setPinLat(lat);
                        setPinLng(lng);
                        if (reverseData) {
                          if (reverseData.address) setAddress(reverseData.address);
                          if (reverseData.city) setCity(reverseData.city);
                          if (reverseData.state) setState(reverseData.state);
                          if (reverseData.country) setCountry(reverseData.country);
                          if (reverseData.postalCode) setPostalCode(reverseData.postalCode);
                        }
                      }}
                      country={country}
                      city={city}
                      address={address}
                    />
                  </Suspense>
                  <p className="text-xs text-muted-foreground">💡 Click anywhere on the map to place a pin. Drag the pin to adjust. The map auto-zooms when you select a country or enter a city.</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-foreground font-semibold text-sm flex items-center gap-1.5">Street address <span className="text-destructive">*</span></Label>
                  <Input placeholder="Enter street address (e.g. 123 Main St)" value={address} onChange={(e) => setAddress(e.target.value)} />
                  <p className="text-xs text-muted-foreground">You can type the street address manually. City, state, and postal code are auto-filled from the map pin.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-foreground font-semibold text-sm flex items-center gap-1.5">City / Town <span className="text-destructive">*</span> <span className="text-xs text-muted-foreground font-normal">(auto-filled from map)</span></Label>
                    <Input placeholder="Auto-filled from map pin" value={city} readOnly disabled className="bg-muted/50 cursor-not-allowed" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-foreground font-semibold text-sm flex items-center gap-1.5">State / Region <span className="text-destructive">*</span> <span className="text-xs text-muted-foreground font-normal">(auto-filled from map)</span></Label>
                    <Input placeholder="Auto-filled from map pin" value={state} readOnly disabled className="bg-muted/50 cursor-not-allowed" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-foreground font-semibold text-sm flex items-center gap-1.5">Postal code <span className="text-xs text-muted-foreground font-normal">(optional · auto-filled from map)</span></Label>
                    <Input placeholder="Auto-filled from map pin" value={postalCode} readOnly disabled className="bg-muted/50 cursor-not-allowed" />
                  </div>
                </div>
              </div>
            )}

            {/* ════════════ STEP 3: Size & Basics ════════════ */}
            {currentStep === 3 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-[26px] font-extrabold text-foreground leading-tight mb-1">How big is your place?</h3>
                  <p className="text-muted-foreground text-[15px]">This helps guests know what to expect.</p>
                </div>
                <div className="rounded-xl border border-border bg-card px-5">
                  <Counter label="Guests" subtitle="Max number of guests" value={guests} onChange={setGuests} min={1} />
                  <Counter label="Bedrooms" subtitle="Number of bedrooms" value={bedrooms} onChange={setBedrooms} min={0} />
                  <Counter label="Beds" subtitle="Number of beds" value={beds} onChange={setBeds} min={1} />
                  <Counter label="Bathrooms" subtitle="Number of bathrooms" value={bathrooms} onChange={setBathrooms} min={1} />
                </div>
              </div>
            )}

            {/* ════════════ STEP 5: Amenities ════════════ */}
            {currentStep === 5 && (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-[26px] font-extrabold text-foreground leading-tight mb-1">What do you offer?</h3>
                    <p className="text-muted-foreground text-[15px]">Select amenities, mark free or paid, and add at least 1 photo to showcase each.</p>
                  </div>
                  {photos.some(p => p.isUrl) && selectedAmenities.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 border-primary/40 bg-transparent hover:bg-primary/10 text-primary hover:text-primary gap-1.5 font-semibold text-xs"
                      onClick={() => {
                        // Distribute cover photos round-robin across amenities that still need photos
                        const needPhotos = selectedAmenities.filter(id => (amenityPhotos[id] || []).length < 1);
                        if (needPhotos.length === 0) {
                          toast({ title: 'All set!', description: 'Every amenity already has at least one photo.' });
                          return;
                        }
                        // Only use URL-based photos from cover
                        const availableCoverPhotos = photos.filter(p => p.isUrl && !Object.values(amenityPhotos).some(aps => aps.some(ap => ap.preview === p.preview)));
                        if (availableCoverPhotos.length === 0) {
                          toast({ title: 'No cover photos left', description: 'All cover photos are already assigned to amenities.', variant: 'destructive' });
                          return;
                        }
                        const newAmenityPhotos = { ...amenityPhotos };
                        const movedUrls: string[] = [];
                        let photoIdx = 0;
                        for (const amenityId of needPhotos) {
                          if (photoIdx >= availableCoverPhotos.length) break;
                          const coverPhoto = availableCoverPhotos[photoIdx];
                          newAmenityPhotos[amenityId] = [
                            ...(newAmenityPhotos[amenityId] || []),
                            { id: `auto-${amenityId}-${Date.now()}-${photoIdx}`, file: null as unknown as File, preview: coverPhoto.preview },
                          ];
                          movedUrls.push(coverPhoto.preview);
                          photoIdx++;
                        }
                        setAmenityPhotos(newAmenityPhotos);
                        // MOVE: remove assigned photos from cover
                        setPhotos(prev => prev.filter(p => !movedUrls.includes(p.preview)));
                        const assigned = movedUrls.length;
                        toast({ title: `📸 ${assigned} photo${assigned > 1 ? 's' : ''} moved`, description: 'Photos moved from cover to amenities. You can swap them manually.' });
                      }}
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Auto-assign photos
                    </Button>
                  )}
                </div>

                {amenityGroups.map((group) => (
                  <div key={group.label}>
                    <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-3">{group.label}</p>
                    <div className="space-y-2">
                      {group.items.map((a) => {
                        const selected = selectedAmenities.includes(a.id);
                        const pricing = amenityPricing[a.id] || 'free';
                        const aPhotos = amenityPhotos[a.id] || [];
                        return (
                          <div key={a.id} className={`rounded-xl border-2 transition-all ${
                            selected ? 'border-primary bg-primary/5' : 'border-border bg-card'
                          }`}>
                            {/* Toggle row */}
                            <button
                              type="button"
                              onClick={() => toggleAmenity(a.id)}
                              className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                            >
                              <a.icon className={`w-5 h-5 shrink-0 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                              <span className="font-medium text-foreground text-[15px] flex-1">{a.label}</span>
                              {selected && <Check className="w-4 h-4 text-primary" />}
                            </button>

                            {/* Expanded details when selected */}
                            {selected && (
                              <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                                {/* Parking-specific: Onsite toggle */}
                                {a.id === 'parking' && (
                                  <div className="flex items-center gap-3">
                                    <Car className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-sm text-foreground font-medium">Location:</span>
                                    <div className="flex rounded-lg border border-border overflow-hidden">
                                      {['Onsite', 'Offsite'].map((opt) => (
                                        <button
                                          key={opt}
                                          type="button"
                                          onClick={() => setAmenityExtras(prev => ({ ...prev, parking: { ...prev.parking, location: opt } }))}
                                          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                                            (amenityExtras.parking?.location || 'Onsite') === opt ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'
                                          }`}
                                        >
                                          {opt}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Pool-specific: Location + Heated */}
                                {a.id === 'pool' && (
                                  <>
                                    <div className="flex items-center gap-3">
                                      <Waves className="w-4 h-4 text-muted-foreground" />
                                      <span className="text-sm text-foreground font-medium">Location:</span>
                                      <div className="flex rounded-lg border border-border overflow-hidden">
                                        {['Ground', 'Rooftop', 'Indoor'].map((opt) => (
                                          <button
                                            key={opt}
                                            type="button"
                                            onClick={() => setAmenityExtras(prev => ({ ...prev, pool: { ...prev.pool, location: opt } }))}
                                            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                                              (amenityExtras.pool?.location || 'Ground') === opt ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'
                                            }`}
                                          >
                                            {opt}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <Flame className="w-4 h-4 text-muted-foreground" />
                                      <span className="text-sm text-foreground font-medium">Heated:</span>
                                      <div className="flex rounded-lg border border-border overflow-hidden">
                                        {['Yes', 'No'].map((opt) => (
                                          <button
                                            key={opt}
                                            type="button"
                                            onClick={() => setAmenityExtras(prev => ({ ...prev, pool: { ...prev.pool, heated: opt } }))}
                                            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                                              (amenityExtras.pool?.heated || 'No') === opt ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'
                                            }`}
                                          >
                                            {opt}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* Free / Paid toggle */}
                                <div className="flex items-center gap-3">
                                  <CircleDollarSign className="w-4 h-4 text-muted-foreground" />
                                  <span className="text-sm text-foreground font-medium">Pricing:</span>
                                  <div className="flex rounded-lg border border-border overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => setAmenityPricing(prev => ({ ...prev, [a.id]: 'free' }))}
                                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                                        pricing === 'free' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'
                                      }`}
                                    >
                                      Free
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setAmenityPricing(prev => ({ ...prev, [a.id]: 'paid' }))}
                                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                                        pricing === 'paid' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'
                                      }`}
                                    >
                                      Paid
                                    </button>
                                  </div>
                                </div>

                                {/* Photo upload */}
                                <div>
                                  <div className="flex items-center gap-2 mb-2">
                                    <ImagePlus className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-sm text-foreground font-medium">Photos</span>
                                    <span className="text-xs text-muted-foreground">(min 1 required)</span>
                                    {aPhotos.length >= 1 && <Check className="w-3.5 h-3.5 text-primary" />}
                                  </div>
                                  <div className="flex gap-2 flex-wrap">
                                    {aPhotos.map((photo, idx) => (
                                      <div key={photo.id} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border group">
                                        <img src={photo.preview} alt={`${a.label} ${idx + 1}`} className="w-full h-full object-cover" />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setAmenityPhotos(prev => ({
                                              ...prev,
                                              [a.id]: prev[a.id].filter(p => p.id !== photo.id),
                                            }));
                                          }}
                                          className="absolute top-0.5 right-0.5 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </div>
                                    ))}
                                    {aPhotos.length < 5 && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => amenityPhotoRefs.current[a.id]?.click()}
                                          className="w-20 h-20 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center gap-1 transition-colors bg-muted/30"
                                        >
                                          <Upload className="w-4 h-4 text-muted-foreground" />
                                          <span className="text-[10px] text-muted-foreground font-medium">Upload</span>
                                        </button>
                                        {/* Pick from cover photos to move here */}
                                        {photos.some(p => p.isUrl) && (
                                          <Popover>
                                            <PopoverTrigger asChild>
                                              <button
                                                type="button"
                                                className="w-20 h-20 rounded-lg border-2 border-dashed border-primary/40 hover:border-primary flex flex-col items-center justify-center gap-1 transition-colors bg-primary/5"
                                              >
                                                <Download className="w-4 h-4 text-primary" />
                                                <span className="text-[10px] text-primary font-semibold">Import</span>
                                              </button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-[340px] p-3 z-[2000]" align="start" side="bottom">
                                              <p className="text-xs font-bold text-foreground mb-2">Move from cover photos</p>
                                              <div className="grid grid-cols-4 gap-1.5 max-h-[240px] overflow-y-auto">
                                                {/* Show photos currently in cover gallery */}
                                                {photos.filter(p => p.isUrl).map((photo, imgIdx) => {
                                                  const alreadyUsedInAmenity = Object.values(amenityPhotos).some(aps => aps.some(p => p.preview === photo.preview));
                                                  return (
                                                    <button
                                                      key={imgIdx}
                                                      type="button"
                                                      disabled={alreadyUsedInAmenity || (amenityPhotos[a.id] || []).length >= 5}
                                                      onClick={() => {
                                                        // MOVE: add to amenity
                                                        const newPhoto = {
                                                          id: `imported-${a.id}-${imgIdx}-${Date.now()}`,
                                                          file: null as unknown as File,
                                                          preview: photo.preview,
                                                        };
                                                        setAmenityPhotos(prev => ({
                                                          ...prev,
                                                          [a.id]: [...(prev[a.id] || []), newPhoto],
                                                        }));
                                                        // MOVE: remove from cover photos
                                                        setPhotos(prev => prev.filter(p => p.preview !== photo.preview));
                                                      }}
                                                      className={`relative aspect-square rounded-md overflow-hidden border transition-all ${
                                                        alreadyUsedInAmenity
                                                          ? 'border-primary/40 opacity-50 cursor-not-allowed'
                                                          : 'border-border hover:border-primary hover:ring-2 hover:ring-primary/20 cursor-pointer'
                                                      }`}
                                                    >
                                                      <img
                                                        src={photo.isUrl
                                                          ? `https://images.weserv.nl/?url=${encodeURIComponent(photo.preview)}&w=400&output=jpg&q=80`
                                                          : photo.preview
                                                        }
                                                        alt={`Photo ${imgIdx + 1}`}
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => { if (e.currentTarget.src.includes('weserv.nl')) e.currentTarget.src = photo.preview; }}
                                                      />
                                                      {alreadyUsedInAmenity && (
                                                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                                                          <Check className="w-4 h-4 text-primary" />
                                                        </div>
                                                      )}
                                                    </button>
                                                  );
                                                })}
                                                {photos.filter(p => p.isUrl).length === 0 && (
                                                  <p className="col-span-4 text-xs text-muted-foreground text-center py-4">No cover photos available to import</p>
                                                )}
                                              </div>
                                              <p className="text-[10px] text-muted-foreground mt-2 text-center">Click a photo to move it to {a.label}</p>
                                            </PopoverContent>
                                          </Popover>
                                        )}
                                      </>
                                    )}
                                    <input
                                      ref={(el) => { amenityPhotoRefs.current[a.id] = el; }}
                                      type="file"
                                      accept="image/*"
                                      multiple
                                      className="hidden"
                                      onChange={(e) => {
                                        const files = Array.from(e.target.files || []);
                                        const newPhotos = files.slice(0, 5 - aPhotos.length).map(file => ({
                                          id: `${a.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                                          file,
                                          preview: URL.createObjectURL(file),
                                        }));
                                        setAmenityPhotos(prev => ({
                                          ...prev,
                                          [a.id]: [...(prev[a.id] || []), ...newPhotos],
                                        }));
                                        e.target.value = '';
                                      }}
                                    />
                                  </div>
                                  {aPhotos.length === 0 && (
                                    <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                                      <AlertCircle className="w-3 h-3" /> Add at least 1 photo — use "Import" to move from cover photos
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Validation summary */}
                {selectedAmenities.length > 0 && (() => {
                  const missing = selectedAmenities.filter(id => (amenityPhotos[id] || []).length < 1);
                  if (missing.length === 0) return (
                    <p className="text-sm text-center text-green-600 dark:text-green-400 flex items-center justify-center gap-1 font-medium">
                      <Check className="w-4 h-4" /> All amenities have photos — ready to continue
                    </p>
                  );
                  return (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4">
                      <p className="text-sm text-destructive font-semibold flex items-center gap-1.5 mb-2">
                        <AlertCircle className="w-4 h-4" /> {missing.length} amenit{missing.length === 1 ? 'y needs' : 'ies need'} at least 1 photo
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {missing.map(id => {
                          const am = allAmenities.find(a => a.id === id);
                          return (
                            <span key={id} className="text-xs px-2 py-1 bg-destructive/10 text-destructive rounded-full font-medium">
                              {am?.label || id} (0/1)
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {selectedAmenities.length === 0 && (
                  <p className="text-sm text-center text-muted-foreground">Select at least one amenity to continue.</p>
                )}
              </div>
            )}

            {/* ════════════ STEP 4: Cover Photo (Drag & Drop) ════════════ */}
            {currentStep === 4 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-[26px] font-extrabold text-foreground leading-tight mb-1">Add cover photo</h3>
                  <p className="text-muted-foreground text-[15px]">At least 1 photo required. Drag to reorder — first photo is your cover.</p>
                </div>

                <div
                  className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 transition-colors bg-secondary/20"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="font-bold text-foreground mb-1">Drop photos here or click to browse</p>
                  <p className="text-sm text-muted-foreground">JPG, PNG, WEBP — multiple files at once</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handlePhotoDrop}
                  />
                </div>

                {photos.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-bold text-foreground">{photos.length} photos — drag to reorder</p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5 font-semibold text-xs" onClick={() => setBulkOpen(true)}>
                          <FolderUp className="w-3.5 h-3.5" /> Bulk import
                        </Button>
                        <Button variant="outline" size="sm" className="text-primary border-primary/40 gap-1.5 font-semibold text-xs" onClick={() => fileInputRef.current?.click()}>
                          <Plus className="w-3.5 h-3.5" /> Add more
                        </Button>
                      </div>
                    </div>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={photos.map(p => p.id)} strategy={rectSortingStrategy}>
                        <div className="grid grid-cols-3 gap-3">
                          {photos.map((photo, i) => (
                            <SortablePhoto
                              key={photo.id}
                              id={photo.id}
                              photo={photo}
                              index={i}
                              onRemove={() => removePhoto(i)}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                    <p className="text-xs text-muted-foreground mt-3">💡 First photo is your cover — drag to set the best shot first. Photos moved to amenities will be removed from here.</p>
                  </div>
                )}

                {photos.length === 0 && importedImageUrls.length > 0 && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-destructive">At least 1 cover photo required</p>
                      <p className="text-xs text-destructive/80 mt-1">
                        All imported photos have been moved to amenities. Upload a new cover photo or go back to amenities to free up a photo.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ════════════ STEP 6: Name & Description ════════════ */}
            {currentStep === 6 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-[26px] font-extrabold text-foreground leading-tight mb-1">Name & describe it</h3>
                  <p className="text-muted-foreground text-[15px]">Your title must be unique — no two listings can share the same name.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-foreground font-semibold text-sm">Listing title <span className="text-destructive">*</span></Label>
                    <span className="text-xs text-muted-foreground tabular-nums">{title.length}/60</span>
                  </div>
                  <Input
                    placeholder="e.g. Cozy Beachfront Cottage with Ocean Views"
                    value={title}
                    onChange={(e) => setTitle(e.target.value.slice(0, 60))}
                    maxLength={60}
                  />
                  <p className="text-xs text-muted-foreground">💡 Mention your best feature: ocean view, city center, private pool...</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-foreground font-semibold text-sm">Description <span className="text-destructive">*</span></Label>
                  <Textarea
                    placeholder="Describe what makes your place special — the vibe, highlights, unique features, nearby attractions..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={7}
                    className="resize-none"
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-primary font-medium">Aim for 150+ characters</span>
                    <span className="text-muted-foreground tabular-nums">{description.length} chars</span>
                  </div>
                </div>
              </div>
            )}

            {/* ════════════ STEP 7: Pricing ════════════ */}
            {currentStep === 7 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-[26px] font-extrabold text-foreground leading-tight mb-1">Set your price</h3>
                  <p className="text-muted-foreground text-[15px]">You can always change this later.</p>
                </div>

                <div className="rounded-xl border border-border p-6 bg-secondary/30">
                  <Label className="text-foreground font-bold text-sm mb-3 block">Nightly rate <span className="text-destructive">*</span></Label>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl text-rating font-bold">$</span>
                    <input
                      type="number"
                      min={1}
                      value={nightlyRate}
                      onChange={(e) => setNightlyRate(Number(e.target.value))}
                      className="text-6xl font-extrabold bg-transparent border-none outline-none w-48 text-rating [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-rating/80 text-base">/night</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-foreground font-bold text-sm">Cleaning fee</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input type="number" min={0} className="pl-7" value={cleaningFee} onChange={(e) => setCleaningFee(Number(e.target.value))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-foreground font-bold text-sm">Minimum nights</Label>
                    <Input type="number" min={1} value={minNights} onChange={(e) => setMinNights(Number(e.target.value))} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-foreground font-bold text-sm">Who pays the service fee?</Label>
                  <p className="text-xs text-muted-foreground">Choose whether the guest, host, or both share the platform service fee</p>
                  <Select value={serviceFeeChargedTo} onValueChange={(v: 'guest' | 'host' | 'split') => setServiceFeeChargedTo(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="guest">Guest pays service fee</SelectItem>
                      <SelectItem value="host">Host pays service fee</SelectItem>
                      <SelectItem value="split">Split 50/50 between guest & host</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
                  <div>
                    <p className="font-bold text-foreground text-[15px]">Instant Book</p>
                    <p className="text-sm text-muted-foreground">Guests book without waiting for approval</p>
                  </div>
                  <Switch checked={instantBook} onCheckedChange={setInstantBook} />
                </div>

                <p className="text-sm text-center text-green-600 dark:text-green-400 flex items-center justify-center gap-1 font-medium">
                  ✓ Data pre-filled — review & edit each step
                </p>
              </div>
            )}

            {/* ════════════ STEP 8: House Rules ════════════ */}
            {currentStep === 8 && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-[26px] font-extrabold text-foreground leading-tight mb-1">House rules</h3>
                  <p className="text-muted-foreground text-[15px]">Set expectations for your guests. Select all that apply.</p>
                </div>

                {/* Check-in / Check-out Times */}
                <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                  <p className="text-sm font-bold text-foreground">⏰ Check-in & Check-out Times</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-foreground font-semibold text-sm">Check-in time</Label>
                      <Input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-foreground font-semibold text-sm">Check-out time</Label>
                      <Input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
                    </div>
                  </div>
                </div>

                {/* Standard rules with Yes/No toggles */}
                <div className="space-y-2">
                  {Object.entries(standardRules).map(([label, checked]) => {
                    const icons: Record<string, React.ReactNode> = {
                      'No smoking': <Cigarette className="w-4 h-4" />,
                      'No parties or events': <Music className="w-4 h-4" />,
                      'No pets': <Dog className="w-4 h-4" />,
                      'Pets allowed — ask host': <Dog className="w-4 h-4" />,
                      'Quiet hours': <Bell className="w-4 h-4" />,
                      'No shoes in the house': <DoorOpen className="w-4 h-4" />,
                      'No unregistered guests': <Users className="w-4 h-4" />,
                      'No loud music after quiet hours': <Music className="w-4 h-4" />,
                      'Self check-in with lockbox': <Lock className="w-4 h-4" />,
                    };
                    const hasTimeSetting = label === 'Quiet hours' || label === 'No loud music after quiet hours';
                    return (
                      <div key={label}>
                        <div
                          className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                            checked ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'
                          } ${hasTimeSetting && checked ? 'rounded-b-none' : ''}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">{icons[label] || <ShieldCheck className="w-4 h-4" />}</span>
                            <span className="text-sm font-medium text-foreground">{label}</span>
                          </div>
                          <div className="flex rounded-lg border border-border overflow-hidden">
                            <button
                              type="button"
                              onClick={() => { if (!checked) toggleStandardRule(label); }}
                              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                                checked ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'
                              }`}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => { if (checked) toggleStandardRule(label); }}
                              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                                !checked ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'
                              }`}
                            >
                              No
                            </button>
                          </div>
                        </div>
                        {/* Time picker for quiet hours */}
                        {hasTimeSetting && checked && (
                          <div className="border border-t-0 border-primary/30 bg-primary/5 rounded-b-xl px-4 py-3">
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-xs font-semibold text-muted-foreground">From</span>
                              <Input
                                type="time"
                                value={quietHoursStart}
                                onChange={(e) => setQuietHoursStart(e.target.value)}
                                className="w-[120px] h-8 text-xs"
                              />
                              <span className="text-xs font-semibold text-muted-foreground">to</span>
                              <Input
                                type="time"
                                value={quietHoursEnd}
                                onChange={(e) => setQuietHoursEnd(e.target.value)}
                                className="w-[120px] h-8 text-xs"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Custom rules */}
                <div>
                  <p className="text-sm font-semibold text-foreground mb-2">Other rules</p>
                  {houseRules.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {houseRules.map((rule, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-card">
                          <span className="text-foreground text-sm">{rule}</span>
                          <button type="button" onClick={() => setHouseRules(prev => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={newCustomRule}
                      onChange={(e) => setNewCustomRule(e.target.value)}
                      placeholder="e.g. No candles or incense"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newCustomRule.trim()) {
                          e.preventDefault();
                          setHouseRules(prev => [...prev, newCustomRule.trim()]);
                          setNewCustomRule('');
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (newCustomRule.trim()) {
                          setHouseRules(prev => [...prev, newCustomRule.trim()]);
                          setNewCustomRule('');
                        }
                      }}
                    >
                      <Plus className="w-4 h-4 mr-1" /> Add
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ════════════ STEP 9: Review & Publish ════════════ */}
            {currentStep === 9 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-[26px] font-extrabold text-foreground leading-tight mb-1">Ready to publish? 🚀</h3>
                  <p className="text-muted-foreground text-[15px]">Review your listing before submitting for approval.</p>
                </div>

                {/* Preview Card */}
                <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
                  {photos.length > 0 ? (
                    <div className="relative">
                      <img
                        src={photos[0].isUrl
                          ? `https://images.weserv.nl/?url=${encodeURIComponent(photos[0].preview)}&w=800&output=jpg&q=80`
                          : photos[0].preview
                        }
                        alt="Cover"
                        className="w-full h-52 object-cover"
                        onError={(e) => { if (e.currentTarget.src.includes('weserv.nl')) e.currentTarget.src = photos[0].preview; }}
                      />
                      {photos.length > 1 && (
                        <div className="absolute bottom-2 right-2 flex gap-1">
                          {photos.slice(1, 4).map((p, i) => (
                            <img key={i} src={p.preview} alt="" className="w-12 h-12 rounded-md object-cover border-2 border-card shadow-sm" />
                          ))}
                          {photos.length > 4 && (
                            <div className="w-12 h-12 rounded-md bg-foreground/60 text-background flex items-center justify-center text-xs font-bold border-2 border-card">
                              +{photos.length - 4}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-52 bg-muted flex items-center justify-center text-muted-foreground">No cover photo</div>
                  )}
                  <div className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-extrabold text-foreground text-lg leading-tight">{title || 'Untitled'}</h4>
                      <span className="shrink-0 text-[11px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-2.5 py-1 rounded-full font-bold">
                        Pending Review
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{city}{state ? `, ${state}` : ''}, {country}</p>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {guests} guests</span>
                      <span className="flex items-center gap-1"><BedDouble className="w-4 h-4" /> {bedrooms} bed · {beds} beds</span>
                      <span className="flex items-center gap-1"><Bath className="w-4 h-4" /> {bathrooms} bath</span>
                    </div>
                    <p className="text-3xl font-extrabold text-rating">${nightlyRate} <span className="text-sm font-normal text-rating/80">/night</span></p>
                  </div>
                </div>

                {/* Amenities Review */}
                {selectedAmenities.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                    <p className="font-bold text-foreground text-sm flex items-center gap-2">✨ Amenities ({selectedAmenities.length})</p>
                    <div className="space-y-4">
                      {selectedAmenities.map((aId) => {
                        const amenity = allAmenities.find(am => am.id === aId);
                        if (!amenity) return null;
                        const pricing = amenityPricing[aId] || 'free';
                        const aPhotos = amenityPhotos[aId] || [];
                        const extras = amenityExtras[aId];
                        return (
                          <div key={aId} className="flex flex-col gap-2 pb-3 border-b border-border/50 last:border-b-0 last:pb-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <amenity.icon className="w-4 h-4 text-primary" />
                              <span className="font-semibold text-foreground text-sm">{amenity.label}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                pricing === 'free' 
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              }`}>
                                {pricing === 'free' ? 'FREE' : 'PAID'}
                              </span>
                              {aId === 'parking' && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                  {extras?.location || 'Onsite'}
                                </span>
                              )}
                              {aId === 'pool' && (
                                <>
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    {extras?.location || 'Ground'}
                                  </span>
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    {(extras?.heated || 'No') === 'Yes' ? 'Heated' : 'Not heated'}
                                  </span>
                                </>
                              )}
                            </div>
                            {aPhotos.length > 0 && (
                              <div className="flex gap-1.5">
                                {aPhotos.map((p, i) => (
                                  <img key={i} src={p.preview} alt="" className="w-14 h-14 rounded-md object-cover border border-border" />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* What happens next */}
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
                  <p className="font-bold text-foreground mb-1">📋 What happens next?</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Your listing will be reviewed within 24 hours. You'll get a notification once it's approved and live.
                  </p>
                </div>

                {/* Insurance Acknowledgement (required to publish) */}
                <div className={`rounded-xl border-2 p-5 transition-colors ${
                  insuranceAck
                    ? 'border-green-300 bg-green-50 dark:bg-green-900/10 dark:border-green-800'
                    : 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700'
                }`}>
                  <div className="flex items-start gap-3 mb-3">
                    <ShieldCheck className={`w-5 h-5 shrink-0 mt-0.5 ${insuranceAck ? 'text-green-600' : 'text-amber-600'}`} />
                    <div>
                      <p className="font-bold text-foreground text-sm mb-1">
                        Host insurance acknowledgement {previouslyAcknowledged && <span className="text-xs font-normal text-muted-foreground">(previously confirmed)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Hostiva is a marketplace and does <strong>not</strong> provide any damage protection, liability coverage, or insurance guarantee. As an independent host, you are responsible for protecting your property — please carry your own short-term rental insurance.
                      </p>
                    </div>
                  </div>
                  <label className="flex items-start gap-3 cursor-pointer select-none p-3 rounded-lg bg-background/60 border border-border hover:bg-background transition-colors">
                    <input
                      type="checkbox"
                      checked={insuranceAck}
                      onChange={(e) => setInsuranceAck(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-border accent-primary cursor-pointer"
                      aria-required="true"
                    />
                    <span className="text-sm text-foreground leading-relaxed">
                      I understand and acknowledge that <strong>Hostiva does not provide damage or liability insurance</strong>, and I am solely responsible for insuring my property.
                    </span>
                  </label>
                </div>

                <p className="text-sm text-center text-green-600 dark:text-green-400 flex items-center justify-center gap-1 font-medium">
                  ✓ Data pre-filled — review & edit each step
                </p>
              </div>
            )}
          </div>

          {/* ── Navigation ── */}
          <div className="flex justify-between items-center">
            <Button
              variant="outline"
              onClick={() => {
                if (currentStep === 1) navigate('/host/dashboard');
                else setCurrentStep(s => s - 1);
              }}
              className="gap-2 font-semibold"
            >
              <ArrowLeft className="w-4 h-4" />
              {currentStep === 1 ? 'Exit' : 'Back'}
            </Button>

            {currentStep < steps.length ? (
              <Button
                onClick={() => setCurrentStep(s => s + 1)}
                disabled={!canProceed()}
                className="gap-2 px-7 font-bold text-[15px] h-11 shadow-sm"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !canProceed()}
                className="gap-2 px-7 font-bold text-[15px] h-11 shadow-sm"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Publishing...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Publish Listing</>
                )}
              </Button>
            )}
          </div>
          </>
          )}
        </div>
      </div>
      {user && (
        <BulkPhotoImporter
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          bucket="property-images"
          pathPrefix={`properties/${user.id}`}
          onComplete={(urls) => {
            if (urls.length === 0) return;
            setPhotos((prev) => [
              ...prev,
              ...urls.map((u) => ({
                id: `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                preview: u,
                isUrl: true as const,
              })),
            ]);
            toast({ title: 'Photos added', description: `${urls.length} photo${urls.length === 1 ? '' : 's'} ready in your listing.` });
          }}
        />
      )}
    </Layout>
  );
}