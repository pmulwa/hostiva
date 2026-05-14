import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, MapPin, Maximize2, Minimize2, Crosshair, Check, RotateCcw } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface LocationMapProps {
  lat: number | null;
  lng: number | null;
  onLocationSelect: (lat: number, lng: number, reverseData?: { address?: string; city?: string; state?: string; country?: string; postalCode?: string }) => void;
  country: string;
  city: string;
  address: string;
}

async function geocode(query: string): Promise<{ lat: number; lng: number; zoom: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    if (data?.[0]) {
      const { lat, lon, boundingbox } = data[0];
      const latDiff = Math.abs(parseFloat(boundingbox[1]) - parseFloat(boundingbox[0]));
      let zoom = 13;
      if (latDiff > 50) zoom = 3;
      else if (latDiff > 10) zoom = 5;
      else if (latDiff > 5) zoom = 7;
      else if (latDiff > 1) zoom = 10;
      else if (latDiff > 0.1) zoom = 13;
      else zoom = 16;
      return { lat: parseFloat(lat), lng: parseFloat(lon), zoom };
    }
  } catch (e) {
    console.error('Geocode error:', e);
  }
  return null;
}

async function reverseGeocode(lat: number, lng: number) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    const a = data?.address || {};
    return {
      address: [a.house_number, a.road].filter(Boolean).join(' ') || undefined,
      city: a.city || a.town || a.village || a.municipality || undefined,
      state: a.state || a.region || a.county || undefined,
      country: a.country || undefined,
      postalCode: a.postcode || undefined,
    };
  } catch (e) {
    console.error('Reverse geocode error:', e);
    return {};
  }
}

export default function LocationMap({ lat, lng, onLocationSelect, country, city, address }: LocationMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const geocodeTimeout = useRef<NodeJS.Timeout | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string; boundingbox: string[] }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ lat: number; lng: number; reverseData: { address?: string; city?: string; state?: string; country?: string; postalCode?: string } } | null>(null);
  const pendingMarkerRef = useRef<L.Marker | null>(null);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  const showPending = (lat: number, lng: number, reverseData: Awaited<ReturnType<typeof reverseGeocode>>) => {
    setPendingPin({ lat, lng, reverseData });
    // Show a temporary marker for pending pin
    if (pendingMarkerRef.current) { pendingMarkerRef.current.remove(); pendingMarkerRef.current = null; }
    if (mapRef.current) {
      pendingMarkerRef.current = L.marker([lat, lng], { icon: defaultIcon, draggable: true }).addTo(mapRef.current);
      pendingMarkerRef.current.on('dragend', async () => {
        const pos = pendingMarkerRef.current!.getLatLng();
        const rd = await reverseGeocode(pos.lat, pos.lng);
        setPendingPin({ lat: pos.lat, lng: pos.lng, reverseData: rd });
      });
    }
  };

  const confirmPin = () => {
    if (!pendingPin) return;
    onLocationSelect(pendingPin.lat, pendingPin.lng, pendingPin.reverseData);
    // Move pending marker to confirmed
    if (pendingMarkerRef.current) { pendingMarkerRef.current.remove(); pendingMarkerRef.current = null; }
    setPendingPin(null);
  };

  const cancelPin = () => {
    if (pendingMarkerRef.current) { pendingMarkerRef.current.remove(); pendingMarkerRef.current = null; }
    setPendingPin(null);
  };

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [20, 0], zoom: 2, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    map.on('click', async (e: L.LeafletMouseEvent) => {
      const { lat: clickLat, lng: clickLng } = e.latlng;
      const reverseData = await reverseGeocode(clickLat, clickLng);
      showPending(clickLat, clickLng, reverseData);
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Update click handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.off('click');
    map.on('click', async (e: L.LeafletMouseEvent) => {
      const { lat: clickLat, lng: clickLng } = e.latlng;
      const reverseData = await reverseGeocode(clickLat, clickLng);
      showPending(clickLat, clickLng, reverseData);
    });
  }, [onLocationSelect]);

  // Update marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lat !== null && lng !== null) {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        const marker = L.marker([lat, lng], { icon: defaultIcon, draggable: true }).addTo(map);
        marker.on('dragend', async () => {
          const pos = marker.getLatLng();
          const reverseData = await reverseGeocode(pos.lat, pos.lng);
          onLocationSelect(pos.lat, pos.lng, reverseData);
        });
        markerRef.current = marker;
        // Auto-fill address fields when pin comes from import
        reverseGeocode(lat, lng).then(reverseData => {
          onLocationSelect(lat, lng, reverseData);
        });
      }
      // Fly to the imported/selected coordinates immediately
      map.flyTo([lat, lng], 15, { duration: 1.2 });
    } else if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, [lat, lng, onLocationSelect]);

  // Geocode on field changes — skip if coordinates already pinned from import
  useEffect(() => {
    if (lat !== null && lng !== null) return; // Already pinned — don't override with geocode
    if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
    geocodeTimeout.current = setTimeout(async () => {
      let query = '';
      if (address && city && country) query = `${address}, ${city}, ${country}`;
      else if (city && country) query = `${city}, ${country}`;
      else if (country) query = country;
      if (!query) return;
      const result = await geocode(query);
      if (result && mapRef.current) {
        mapRef.current.flyTo([result.lat, result.lng], result.zoom, { duration: 1.5 });
      }
    }, 600);
    return () => { if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current); };
  }, [country, city, address, lat, lng]);

  // Invalidate map size on fullscreen toggle
  useEffect(() => {
    setTimeout(() => mapRef.current?.invalidateSize(), 300);
  }, [isFullscreen]);

  // Close fullscreen on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!value.trim()) { setSearchResults([]); setShowResults(false); return; }
    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&limit=5&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        setSearchResults(data || []);
        setShowResults(true);
      } catch { setSearchResults([]); }
      setIsSearching(false);
    }, 400);
  };

  const handleResultClick = async (result: { lat: string; lon: string; boundingbox: string[] }) => {
    const rLat = parseFloat(result.lat);
    const rLng = parseFloat(result.lon);
    const latDiff = Math.abs(parseFloat(result.boundingbox[1]) - parseFloat(result.boundingbox[0]));
    let zoom = 13;
    if (latDiff > 50) zoom = 3;
    else if (latDiff > 10) zoom = 5;
    else if (latDiff > 5) zoom = 7;
    else if (latDiff > 1) zoom = 10;
    else if (latDiff > 0.1) zoom = 13;
    else zoom = 16;
    mapRef.current?.flyTo([rLat, rLng], zoom, { duration: 1.5 });
    const reverseData = await reverseGeocode(rLat, rLng);
    showPending(rLat, rLng, reverseData);
    setShowResults(false);
    setSearchQuery('');
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        mapRef.current?.flyTo([latitude, longitude], 16, { duration: 1.5 });
        const reverseData = await reverseGeocode(latitude, longitude);
        showPending(latitude, longitude, reverseData);
        setIsLocating(false);
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true }
    );
  };

  return (
    <>
      {/* Fullscreen overlay backdrop */}
      {isFullscreen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[9998]" onClick={() => setIsFullscreen(false)} />
      )}

      <div
        ref={wrapperRef}
        className={`rounded-xl overflow-hidden border border-border relative transition-all duration-300 ${
          isFullscreen
            ? 'fixed inset-4 z-[9999] shadow-2xl'
            : 'w-full h-[400px]'
        }`}
      >
        {/* Search box */}
        <div className="absolute top-3 left-3 right-14 z-[1000]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 200)}
              placeholder="Search location..."
              className="w-full h-9 pl-9 pr-8 text-sm rounded-lg border border-border bg-background/95 backdrop-blur-sm shadow-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />}
          </div>
          {showResults && searchResults.length > 0 && (
            <div className="mt-1 bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg overflow-hidden max-h-[180px] overflow-y-auto">
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onMouseDown={() => handleResultClick(r)}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors text-xs text-foreground"
                >
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                  <span className="line-clamp-2">{r.display_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fullscreen toggle */}
        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          className="absolute top-3 right-3 z-[1000] h-9 w-9 flex items-center justify-center rounded-lg border border-border bg-background/95 backdrop-blur-sm shadow-md hover:bg-accent transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4 text-foreground" /> : <Maximize2 className="w-4 h-4 text-foreground" />}
        </button>

        {/* Use my location button */}
        <button
          type="button"
          onClick={handleUseMyLocation}
          disabled={isLocating}
          className="absolute bottom-3 right-3 z-[1000] h-9 gap-2 px-3 flex items-center justify-center rounded-lg border border-border bg-background/95 backdrop-blur-sm shadow-md hover:bg-accent transition-colors text-sm font-medium text-foreground disabled:opacity-50"
          title="Use my current location"
        >
          {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
          <span className="hidden sm:inline">My location</span>
        </button>

        <div ref={containerRef} style={{ height: '100%', width: '100%' }} />

        {lat === null && !pendingPin && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[999]">
            <div className="bg-background/90 backdrop-blur-sm rounded-lg px-4 py-2 border border-border shadow-lg mt-12">
              <p className="text-sm font-semibold text-foreground">👆 Click on the map to pin your property</p>
            </div>
          </div>
        )}

        {/* Pending pin confirmation card */}
        {pendingPin && (
          <div className="absolute bottom-3 left-3 right-3 z-[1000] bg-background/95 backdrop-blur-sm border border-border rounded-xl shadow-xl p-4 animate-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground mb-1">Confirm this location?</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {[
                    pendingPin.reverseData.address,
                    pendingPin.reverseData.city,
                    pendingPin.reverseData.state,
                    pendingPin.reverseData.country,
                    pendingPin.reverseData.postalCode,
                  ].filter(Boolean).join(', ') || `${pendingPin.lat.toFixed(5)}, ${pendingPin.lng.toFixed(5)}`}
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {pendingPin.lat.toFixed(6)}, {pendingPin.lng.toFixed(6)}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={confirmPin}
                className="flex-1 h-9 flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Check className="w-4 h-4" /> Confirm Pin
              </button>
              <button
                type="button"
                onClick={cancelPin}
                className="h-9 px-4 flex items-center justify-center gap-2 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-accent transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Re-pin
              </button>
            </div>
          </div>
        )}

        {/* Pin confirmed indicator */}
        {lat !== null && lng !== null && !pendingPin && (
          <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 shadow-md text-xs font-semibold">
            <MapPin className="w-3.5 h-3.5" />
            Location pinned ({lat.toFixed(5)}, {lng.toFixed(5)})
          </div>
        )}
      </div>
    </>
  );
}