import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
const LocationMap = lazy(() => import('@/components/LocationMap'));
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { optimizeImage } from '@/lib/imageOptimizer';
import { BulkPhotoImporter } from '@/components/host/BulkPhotoImporter';
import {
  ArrowLeft, Loader2, Save, Upload, X, Plus, Minus,
  Home, MapPin, Bed, Bath, Users, DollarSign, FileText, Settings2, Image,
  Wifi, CookingPot, Car, Wind, Tv, Flame, Dumbbell, Waves,
  Droplets, WashingMachine, Zap, Check, AlertCircle, ImagePlus,
  ShieldCheck, Baby, Coffee, Utensils, Dog, Cigarette, Mountain, TreePine,
  Shirt, Thermometer, UtensilsCrossed, Microwave, Refrigerator, DoorOpen,
  Armchair, BookOpen, Music, Gamepad2, Camera, Bike, Anchor, Sailboat,
  Tent, FireExtinguisher, BriefcaseMedical, Lock, Eye, Bell, CircleDollarSign,
  Sparkles, FolderUp, GripVertical
} from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Property = Database['public']['Tables']['properties']['Row'];

// ─── Sortable existing-image tile ─────────────────────────────
function SortableImage({ id, src, index, isNewlyAdded, onRemove }: {
  id: string; src: string; index: number; isNewlyAdded: boolean; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative aspect-[4/3] rounded-lg overflow-hidden border group bg-card ${
        isNewlyAdded ? 'border-primary ring-2 ring-primary/40' : 'border-border'
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute top-1 left-1 z-10 bg-foreground/60 text-background rounded-md p-1 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        title="Drag to reorder"
      >
        <GripVertical className="w-3 h-3" />
      </div>
      <img src={src} alt="" className="w-full h-full object-cover" />
      {index === 0 && (
        <span className="absolute top-1 left-8 bg-primary text-primary-foreground text-[9px] font-bold px-2 py-0.5 rounded-full shadow-sm">
          Cover
        </span>
      )}
      <span className="absolute top-1 right-8 bg-foreground/70 text-background text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center">
        {index + 1}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" />
      </button>
      {isNewlyAdded && (
        <span className="absolute bottom-1 left-1 bg-primary/90 text-primary-foreground text-[9px] font-bold px-2 py-0.5 rounded-full shadow-sm">
          New
        </span>
      )}
    </div>
  );
}

// ─── Amenity groups (same as CreateProperty) ───
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

const allAmenities = amenityGroups.flatMap(g => g.items);

// Standard house rules with Yes/No toggles
const defaultStandardRules: Record<string, boolean> = {
  'No smoking': false,
  'No parties or events': false,
  'No pets': false,
  'Pets allowed — ask host': false,
  'Quiet hours (10 PM – 8 AM)': false,
  'No shoes in the house': false,
  'No unregistered guests': false,
  'No loud music after 10 PM': false,
  'Self check-in with lockbox': false,
};

const ruleIcons: Record<string, any> = {
  'No smoking': Cigarette,
  'No parties or events': Music,
  'No pets': Dog,
  'Pets allowed — ask host': Dog,
  'Quiet hours (10 PM – 8 AM)': Bell,
  'No shoes in the house': DoorOpen,
  'No unregistered guests': Users,
  'No loud music after 10 PM': Music,
  'Self check-in with lockbox': Lock,
};

function Counter({ label, value, onChange, min = 0 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="font-medium text-foreground text-sm">{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
          className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-accent disabled:opacity-30">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="font-bold w-6 text-center tabular-nums">{value}</span>
        <button type="button" onClick={() => onChange(value + 1)}
          className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-accent">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function EditProperty() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const amenityPhotoRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [property, setProperty] = useState<Property | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Editable fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLng, setPinLng] = useState<number | null>(null);
  const [bedrooms, setBedrooms] = useState(1);
  const [beds, setBeds] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  const [maxGuests, setMaxGuests] = useState(2);
  const [nightlyRate, setNightlyRate] = useState(100);
  const [cleaningFee, setCleaningFee] = useState(0);
  const [minNights, setMinNights] = useState(1);
  const [maxNights, setMaxNights] = useState(365);
  const [instantBook, setInstantBook] = useState(false);
  const [serviceFeeChargedTo, setServiceFeeChargedTo] = useState<'guest' | 'host' | 'split'>('guest');
  const [checkInTime, setCheckInTime] = useState('15:00');
  const [checkOutTime, setCheckOutTime] = useState('11:00');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [newPhotoPreviews, setNewPhotoPreviews] = useState<string[]>([]);
  // URLs newly added through the bulk importer in this session — used to
  // highlight them so the host can immediately drag-reorder.
  const [recentlyImportedUrls, setRecentlyImportedUrls] = useState<Set<string>>(new Set());

  // Per-property photo quality rules (applies to bulk import + new uploads)
  const [photoRules, setPhotoRules] = useState({
    min_long_edge: 1024,
    min_sharpness: 60,
    block_blurry: false,
    block_screenshots: true,
    block_dark: false,
  });

  const photoSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handlePhotoDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setImages((prev) => {
      const oldIdx = prev.indexOf(String(active.id));
      const newIdx = prev.indexOf(String(over.id));
      if (oldIdx === -1 || newIdx === -1) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  // Amenities
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [amenityPhotos, setAmenityPhotos] = useState<Record<string, { id: string; file: File; preview: string }[]>>({});
  const [existingAmenityDbIds, setExistingAmenityDbIds] = useState<string[]>([]);

  // House rules - standard (Yes/No) + custom
  const [standardRules, setStandardRules] = useState<Record<string, boolean>>({ ...defaultStandardRules });
  const [customRules, setCustomRules] = useState<string[]>([]);
  const [newCustomRule, setNewCustomRule] = useState('');

  const toggleStandardRule = (rule: string) => {
    setStandardRules(prev => {
      const next = { ...prev, [rule]: !prev[rule] };
      if (rule === 'No pets' && next['No pets']) next['Pets allowed — ask host'] = false;
      if (rule === 'Pets allowed — ask host' && next['Pets allowed — ask host']) next['No pets'] = false;
      return next;
    });
  };

  const toggleAmenity = (id: string) => {
    setSelectedAmenities(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    if (id) fetchProperty();
  }, [user, id]);

  const fetchProperty = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      toast({ title: 'Property not found', variant: 'destructive' });
      navigate('/host/dashboard');
      return;
    }

    if (data.host_id !== user?.id) {
      toast({ title: 'Unauthorized', description: 'You can only edit your own properties.', variant: 'destructive' });
      navigate('/host/dashboard');
      return;
    }

    setProperty(data);
    setTitle(data.title);
    setDescription(data.description || '');
    setAddress(data.address);
    setCity(data.city);
    setState(data.state || '');
    setCountry(data.country);
    setPostalCode(data.postal_code || '');
    setPinLat(data.latitude ? Number(data.latitude) : null);
    setPinLng(data.longitude ? Number(data.longitude) : null);
    setBedrooms(data.bedrooms);
    setBeds(data.beds);
    setBathrooms(Number(data.bathrooms));
    setMaxGuests(data.max_guests);
    setNightlyRate(Number(data.price_per_night));
    setCleaningFee(Number(data.cleaning_fee) || 0);
    setMinNights(data.min_nights || 1);
    setMaxNights(data.max_nights || 365);
    setInstantBook(data.instant_booking || false);
    setServiceFeeChargedTo((data.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split');
    setCheckInTime(data.check_in_time || '15:00');
    setCheckOutTime(data.check_out_time || '11:00');
    setCoverImage(data.cover_image);
    setImages(data.images || []);
    if ((data as any).photo_rules) {
      const r = (data as any).photo_rules;
      setPhotoRules({
        min_long_edge: Number(r.min_long_edge) || 1024,
        min_sharpness: Number(r.min_sharpness) || 60,
        block_blurry: !!r.block_blurry,
        block_screenshots: r.block_screenshots !== false,
        block_dark: !!r.block_dark,
      });
    }

    // Parse house rules into standard vs custom
    const existingRules: string[] = (data as any).house_rules || [];
    const standardKeys = Object.keys(defaultStandardRules);
    const newStandard = { ...defaultStandardRules };
    const customs: string[] = [];
    existingRules.forEach(rule => {
      if (standardKeys.includes(rule)) {
        newStandard[rule] = true;
      } else {
        customs.push(rule);
      }
    });
    setStandardRules(newStandard);
    setCustomRules(customs);

    // Fetch existing amenities for this property
    const { data: amenitiesData } = await supabase
      .from('property_amenities')
      .select('amenity_id, amenities(name)')
      .eq('property_id', id);

    if (amenitiesData) {
      setExistingAmenityDbIds(amenitiesData.map((a: any) => a.amenity_id));
      // Map DB amenity names back to local amenity IDs
      const matched: string[] = [];
      amenitiesData.forEach((a: any) => {
        const dbName = a.amenities?.name?.toLowerCase();
        if (dbName) {
          const local = allAmenities.find(am => am.label.toLowerCase() === dbName);
          if (local) matched.push(local.id);
        }
      });
      setSelectedAmenities(matched);
    }

    setIsLoading(false);
  };

  const handlePhotoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setNewPhotos(prev => [...prev, ...files]);
    setNewPhotoPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))]);
    if (e.target) e.target.value = '';
  }, []);

  const removeExistingImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    if (index === 0 && coverImage === images[0]) {
      setCoverImage(images[1] || null);
    }
  };

  const removeNewPhoto = (index: number) => {
    setNewPhotos(prev => prev.filter((_, i) => i !== index));
    setNewPhotoPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!user || !id) return;
    setIsSaving(true);

    // Upload new property photos
    const uploadedUrls: string[] = [];
    for (const file of newPhotos) {
      const optimized = await optimizeImage(file);
      if (!optimized) {
        toast({
          title: 'Photo skipped',
          description: `"${file.name}" is below the 1024px minimum. Use a higher-resolution image (2048px+ recommended).`,
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
        uploadedUrls.push(urlData.publicUrl);
      }
    }

    // Upload amenity photos and merge into property images
    const amenityUploadedUrls: string[] = [];
    for (const amenityId of selectedAmenities) {
      const aPhotos = amenityPhotos[amenityId] || [];
      for (const aPhoto of aPhotos) {
        const optimized = await optimizeImage(aPhoto.file);
        if (!optimized) {
          toast({
            title: 'Amenity photo skipped',
            description: `"${aPhoto.file.name}" is below the 1024px minimum.`,
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
          amenityUploadedUrls.push(urlData.publicUrl);
        }
      }
    }

    const allImages = [...images, ...uploadedUrls, ...amenityUploadedUrls];
    const finalCover = coverImage && allImages.includes(coverImage) ? coverImage : allImages[0] || null;

    // Combine house rules
    const houseRules = [
      ...Object.entries(standardRules).filter(([, v]) => v).map(([k]) => k),
      ...customRules,
    ];

    const { error } = await supabase
      .from('properties')
      .update({
        title,
        description: description || null,
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
        max_guests: maxGuests,
        price_per_night: nightlyRate,
        cleaning_fee: cleaningFee,
        min_nights: minNights,
        max_nights: maxNights,
        instant_booking: instantBook,
        service_fee_charged_to: serviceFeeChargedTo,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        cover_image: finalCover,
        images: allImages,
        house_rules: houseRules,
        photo_rules: photoRules,
      } as any)
      .eq('id', id);

    if (error) {
      toast({ title: 'Error saving', description: error.message, variant: 'destructive' });
      setIsSaving(false);
      return;
    }

    // Update property_amenities: delete old, insert new
    await supabase.from('property_amenities').delete().eq('property_id', id);
    
    if (selectedAmenities.length > 0) {
      const { data: dbAmenities } = await supabase.from('amenities').select('id, name');
      if (dbAmenities) {
        const nameToDbId: Record<string, string> = {};
        dbAmenities.forEach(a => { nameToDbId[a.name.toLowerCase()] = a.id; });
        
        const amenityRows = selectedAmenities
          .map(localId => {
            const localAmenity = allAmenities.find(a => a.id === localId);
            if (!localAmenity) return null;
            const dbId = nameToDbId[localAmenity.label.toLowerCase()];
            return dbId ? { property_id: id, amenity_id: dbId } : null;
          })
          .filter(Boolean);

        if (amenityRows.length > 0) {
          await supabase.from('property_amenities').insert(amenityRows as any);
        }
      }
    }

    toast({ title: '✅ Property updated!', description: 'Your changes have been saved.' });
    navigate('/host/dashboard');
    setIsSaving(false);
  };

  const handleLocationSelect = useCallback((lat: number, lng: number, reverseData?: any) => {
    setPinLat(lat);
    setPinLng(lng);
    if (reverseData) {
      if (reverseData.address) setAddress(reverseData.address);
      if (reverseData.city) setCity(reverseData.city);
      if (reverseData.state) setState(reverseData.state);
      if (reverseData.country) setCountry(reverseData.country);
      if (reverseData.postalCode) setPostalCode(reverseData.postalCode);
    }
  }, []);

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-muted rounded w-1/3" />
            <div className="h-64 bg-muted rounded-xl" />
            <div className="h-64 bg-muted rounded-xl" />
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate('/host/dashboard')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-bold">Edit Property</h1>
            <p className="text-sm text-muted-foreground">Update your listing details</p>
          </div>
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        </div>

        <div className="space-y-8">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="w-5 h-5 text-primary" /> Basic Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={60} />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={5} />
              </div>
            </CardContent>
          </Card>

          {/* Photos */}
          <Card data-photos-card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Image className="w-5 h-5 text-primary" /> Photos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentlyImportedUrls.size > 0 && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
                  <GripVertical className="w-3.5 h-3.5 text-primary" />
                  <span><strong>{recentlyImportedUrls.size} photo{recentlyImportedUrls.size === 1 ? '' : 's'}</strong> just added — drag any tile to reorder. The first photo becomes the cover.</span>
                </div>
              )}
              <DndContext sensors={photoSensors} collisionDetection={closestCenter} onDragEnd={handlePhotoDragEnd}>
                <SortableContext items={images} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-3 mb-4">
                    {images.map((img, i) => (
                      <SortableImage
                        key={img}
                        id={img}
                        src={img}
                        index={i}
                        isNewlyAdded={recentlyImportedUrls.has(img)}
                        onRemove={() => removeExistingImage(i)}
                      />
                    ))}
                    {newPhotoPreviews.map((preview, i) => (
                  <div key={`new-${i}`} className="relative aspect-[4/3] rounded-lg overflow-hidden border-2 border-dashed border-primary/40 group">
                    <img src={preview} alt="" className="w-full h-full object-cover" />
                    <span className="absolute top-1 left-1 bg-primary/80 text-primary-foreground text-[9px] font-bold px-2 py-0.5 rounded-full">New</span>
                    <button type="button" onClick={() => removeNewPhoto(i)}
                      className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="aspect-[4/3] rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary transition-colors">
                  <Upload className="w-5 h-5" />
                  <span className="text-xs font-medium">Add</span>
                </button>
                  </div>
                </SortableContext>
              </DndContext>
              <Separator className="my-4" />
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Photo quality rules</p>
                    <p className="text-xs text-muted-foreground">Applies to every photo added to this listing.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setBulkOpen(true)} className="gap-1.5">
                    <FolderUp className="w-4 h-4" />Bulk import…
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3">
                  <div>
                    <Label className="text-xs">Minimum long edge (px)</Label>
                    <Input
                      type="number"
                      min={400}
                      max={4096}
                      step={64}
                      value={photoRules.min_long_edge}
                      onChange={(e) => setPhotoRules({ ...photoRules, min_long_edge: Math.max(400, Number(e.target.value) || 0) })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Minimum sharpness score</Label>
                    <Input
                      type="number"
                      min={0}
                      max={500}
                      step={5}
                      value={photoRules.min_sharpness}
                      onChange={(e) => setPhotoRules({ ...photoRules, min_sharpness: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Block blurry photos</span>
                    <Switch checked={photoRules.block_blurry} onCheckedChange={(v) => setPhotoRules({ ...photoRules, block_blurry: v })} />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Block screenshots</span>
                    <Switch checked={photoRules.block_screenshots} onCheckedChange={(v) => setPhotoRules({ ...photoRules, block_screenshots: v })} />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
                    <span>Block very dark photos</span>
                    <Switch checked={photoRules.block_dark} onCheckedChange={(v) => setPhotoRules({ ...photoRules, block_dark: v })} />
                  </label>
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
            </CardContent>
          </Card>

          {/* Amenities */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="w-5 h-5 text-primary" /> Amenities
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {amenityGroups.map((group) => (
                <div key={group.label}>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{group.label}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {group.items.map((a) => {
                      const isSelected = selectedAmenities.includes(a.id);
                      const photos = amenityPhotos[a.id] || [];
                      return (
                        <div key={a.id}>
                          <button
                            type="button"
                            onClick={() => toggleAmenity(a.id)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 transition-all text-left ${
                              isSelected
                                ? 'border-primary bg-primary/5'
                                : 'border-border bg-card hover:border-muted-foreground/30'
                            }`}
                          >
                            <a.icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                            <span className="text-sm font-medium text-foreground flex-1">{a.label}</span>
                            {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                          </button>

                          {/* Photo upload for selected amenity */}
                          {isSelected && (
                            <div className="mt-2 ml-1">
                              <div className="flex items-center gap-2 mb-1.5">
                                <ImagePlus className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Photo (min 1)</span>
                                {photos.length >= 1 && <Check className="w-3 h-3 text-primary" />}
                              </div>
                              <div className="flex gap-1.5 flex-wrap">
                                {photos.map((photo, idx) => (
                                  <div key={photo.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border group">
                                    <img src={photo.preview} alt="" className="w-full h-full object-cover" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAmenityPhotos(prev => ({
                                          ...prev,
                                          [a.id]: prev[a.id].filter(p => p.id !== photo.id),
                                        }));
                                      }}
                                      className="absolute top-0.5 right-0.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                ))}
                                {photos.length < 5 && (
                                  <button
                                    type="button"
                                    onClick={() => amenityPhotoRefs.current[a.id]?.click()}
                                    className="w-16 h-16 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center transition-colors bg-muted/30"
                                  >
                                    <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                                  </button>
                                )}
                                <input
                                  ref={(el) => { amenityPhotoRefs.current[a.id] = el; }}
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  className="hidden"
                                  onChange={(e) => {
                                    const files = Array.from(e.target.files || []);
                                    const newAmenityPhotos = files.slice(0, 5 - photos.length).map(file => ({
                                      id: `${a.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                                      file,
                                      preview: URL.createObjectURL(file),
                                    }));
                                    setAmenityPhotos(prev => ({
                                      ...prev,
                                      [a.id]: [...(prev[a.id] || []), ...newAmenityPhotos],
                                    }));
                                    e.target.value = '';
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {selectedAmenities.length > 0 && (
                <p className="text-sm text-center text-muted-foreground">
                  {selectedAmenities.length} amenities selected
                </p>
              )}
            </CardContent>
          </Card>

          {/* Location */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="w-5 h-5 text-primary" /> Location
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Suspense fallback={<div className="h-[400px] bg-muted rounded-xl animate-pulse" />}>
                <LocationMap
                  lat={pinLat}
                  lng={pinLng}
                  onLocationSelect={handleLocationSelect}
                  country={country}
                  city={city}
                  address={address}
                />
              </Suspense>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Address</Label>
                  <Input value={address} disabled className="bg-muted" />
                </div>
                <div>
                  <Label>City</Label>
                  <Input value={city} disabled className="bg-muted" />
                </div>
                <div>
                  <Label>State</Label>
                  <Input value={state} disabled className="bg-muted" />
                </div>
                <div>
                  <Label>Country</Label>
                  <Input value={country} disabled className="bg-muted" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Size & Basics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Home className="w-5 h-5 text-primary" /> Size & Basics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Counter label="Max Guests" value={maxGuests} onChange={setMaxGuests} min={1} />
              <Counter label="Bedrooms" value={bedrooms} onChange={setBedrooms} min={0} />
              <Counter label="Beds" value={beds} onChange={setBeds} min={1} />
              <Counter label="Bathrooms" value={bathrooms} onChange={setBathrooms} min={1} />
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <DollarSign className="w-5 h-5 text-primary" /> Pricing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Nightly Rate ($)</Label>
                  <Input type="number" value={nightlyRate} onChange={e => setNightlyRate(Number(e.target.value))} min={1} />
                </div>
                <div>
                  <Label>Cleaning Fee ($)</Label>
                  <Input type="number" value={cleaningFee} onChange={e => setCleaningFee(Number(e.target.value))} min={0} />
                </div>
              </div>
              <div>
                <Label>Who pays the service fee?</Label>
                <Select value={serviceFeeChargedTo} onValueChange={(v: 'guest' | 'host' | 'split') => setServiceFeeChargedTo(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="guest">Guest pays service fee</SelectItem>
                    <SelectItem value="host">Host pays service fee</SelectItem>
                    <SelectItem value="split">Split 50/50 between guest & host</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Instant Booking</Label>
                  <p className="text-sm text-muted-foreground">Allow guests to book without approval</p>
                </div>
                <Switch checked={instantBook} onCheckedChange={setInstantBook} />
              </div>
            </CardContent>
          </Card>

          {/* Rules & Availability */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings2 className="w-5 h-5 text-primary" /> Rules & Availability
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Check-in Time</Label>
                  <Input type="time" value={checkInTime} onChange={e => setCheckInTime(e.target.value)} />
                </div>
                <div>
                  <Label>Check-out Time</Label>
                  <Input type="time" value={checkOutTime} onChange={e => setCheckOutTime(e.target.value)} />
                </div>
                <div>
                  <Label>Min Nights</Label>
                  <Input type="number" value={minNights} onChange={e => setMinNights(Number(e.target.value))} min={1} />
                </div>
                <div>
                  <Label>Max Nights</Label>
                  <Input type="number" value={maxNights} onChange={e => setMaxNights(Number(e.target.value))} min={1} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* House Rules - Yes/No toggles */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                📋 House Rules
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Standard rules with Yes/No toggles */}
              <div className="space-y-2">
                {Object.entries(standardRules).map(([label, checked]) => {
                  const IconComp = ruleIcons[label] || ShieldCheck;
                  return (
                    <div
                      key={label}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                        checked ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <IconComp className="w-4 h-4 text-muted-foreground" />
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
                  );
                })}
              </div>

              <Separator />

              {/* Custom rules */}
              <div>
                <p className="text-sm font-semibold text-foreground mb-2">Other rules</p>
                {customRules.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {customRules.map((rule, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-card">
                        <span className="text-foreground text-sm">{rule}</span>
                        <button type="button" onClick={() => setCustomRules(prev => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive transition-colors">
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
                        setCustomRules(prev => [...prev, newCustomRule.trim()]);
                        setNewCustomRule('');
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (newCustomRule.trim()) {
                        setCustomRules(prev => [...prev, newCustomRule.trim()]);
                        setNewCustomRule('');
                      }
                    }}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Save Footer */}
          <div className="flex justify-end gap-3 pb-8">
            <Button variant="outline" onClick={() => navigate('/host/dashboard')}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-2 px-8">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </Button>
          </div>
        </div>
      </div>
      {user && (
        <BulkPhotoImporter
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          bucket="property-images"
          pathPrefix={`properties/${user.id}`}
          qualityRules={photoRules}
          onComplete={(urls) => {
            if (urls.length === 0) return;
            setImages((prev) => [...prev, ...urls]);
            setRecentlyImportedUrls(new Set(urls));
            // Scroll the photos card into view so the user can immediately
            // drag-reorder the freshly added tiles.
            requestAnimationFrame(() => {
              const card = document.querySelector('[data-photos-card]');
              card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            // Fade the highlight after a few seconds
            window.setTimeout(() => setRecentlyImportedUrls(new Set()), 12000);
            toast({ title: 'Photos added', description: `${urls.length} photo${urls.length === 1 ? '' : 's'} added to listing. Don't forget to save.` });
          }}
        />
      )}
    </Layout>
  );
}
