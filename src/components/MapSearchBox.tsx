import React, { useRef, useState } from 'react';
import { Search, Loader2, MapPin, X } from 'lucide-react';
import { mapConfig } from '../lib/map';

interface GeoResult {
  id: string;
  label: string;
  lng: number;
  lat: number;
}

interface MapSearchBoxProps {
  isRTL: boolean;
  /** Called with the picked place's coordinates + display label. */
  onSelect: (lng: number, lat: number, label: string) => void;
}

/**
 * Lightweight address/place search for the admin maps. Provider-switched:
 * Google Places Text Search or the Mapbox Geocoding API, both called directly
 * via fetch (no extra dependency; both hosts are allowed by the CSP), biased
 * toward Saudi Arabia. Lets an admin type their branch's
 * address and jump the map there instead of hunting for it — so a pin that ended
 * up in the wrong place (or an unset branch) is easy to correct.
 */
export const MapSearchBox: React.FC<MapSearchBoxProps> = ({ isRTL, onSelect }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = async () => {
    const query = q.trim();
    if (query.length < 2 || !mapConfig.isConfigured) { setResults([]); setOpen(false); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setSearched(true);
    try {
      if (mapConfig.provider === 'google') {
        // Places API (New) Text Search — key + field mask travel as headers, so
        // only places.googleapis.com needs allowing in connect-src. Region/
        // location bias mirror the Mapbox branch (KSA-biased, not restricted).
        const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': mapConfig.googleKey,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
          },
          body: JSON.stringify({
            textQuery: query,
            languageCode: isRTL ? 'ar' : 'en',
            regionCode: 'SA',
            pageSize: 5,
            locationBias: { circle: { center: { latitude: mapConfig.defaultCenter.lat, longitude: mapConfig.defaultCenter.lng }, radius: 50000 } },
          }),
        });
        const data = await res.json();
        const places: GeoResult[] = (Array.isArray(data?.places) ? data.places : [])
          .map((p: Record<string, unknown>) => {
            const loc = (p.location ?? {}) as { latitude?: number; longitude?: number };
            const name = (p.displayName as { text?: string } | undefined)?.text ?? '';
            const label = [name, typeof p.formattedAddress === 'string' ? p.formattedAddress : '']
              .filter(Boolean).join(' — ');
            return {
              id: (typeof p.id === 'string' && p.id) || `${loc.longitude},${loc.latitude}`,
              label,
              lng: Number(loc.longitude),
              lat: Number(loc.latitude),
            };
          })
          .filter((r: GeoResult) => Number.isFinite(r.lng) && Number.isFinite(r.lat) && r.label);
        setResults(places);
        setOpen(true);
        return;
      }
      const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
      url.searchParams.set('q', query);
      url.searchParams.set('access_token', mapConfig.publicToken);
      url.searchParams.set('limit', '5');
      url.searchParams.set('language', isRTL ? 'ar' : 'en');
      // Bias toward Saudi Arabia and the default centre without hard-restricting,
      // so branches outside KSA still resolve.
      url.searchParams.set('country', 'sa');
      url.searchParams.set('proximity', `${mapConfig.defaultCenter.lng},${mapConfig.defaultCenter.lat}`);
      const res = await fetch(url.toString(), { signal: ctrl.signal });
      const data = await res.json();
      const feats: GeoResult[] = (Array.isArray(data?.features) ? data.features : [])
        .map((f: Record<string, unknown>) => {
          const props = (f.properties ?? {}) as Record<string, unknown>;
          const geom = (f.geometry ?? {}) as { coordinates?: number[] };
          const coords = geom.coordinates ?? [];
          const label =
            (typeof props.full_address === 'string' && props.full_address) ||
            (typeof props.place_formatted === 'string' && props.place_formatted) ||
            (typeof props.name === 'string' && props.name) ||
            '';
          return {
            id: (typeof props.mapbox_id === 'string' && props.mapbox_id) || `${coords[0]},${coords[1]}`,
            label: String(label),
            lng: Number(coords[0]),
            lat: Number(coords[1]),
          };
        })
        .filter((r: GeoResult) => Number.isFinite(r.lng) && Number.isFinite(r.lat) && r.label);
      setResults(feats);
      setOpen(true);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { setResults([]); setOpen(true); }
    } finally {
      setLoading(false);
    }
  };

  const pick = (r: GeoResult) => {
    onSelect(r.lng, r.lat, r.label);
    setQ(r.label);
    setOpen(false);
  };

  const clear = () => { setQ(''); setResults([]); setOpen(false); setSearched(false); };

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1.5 shadow-sm">
        <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); if (!e.target.value) clear(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }}
          placeholder={isRTL ? 'ابحث عن عنوان أو مكان…' : 'Search address or place…'}
          dir={isRTL ? 'rtl' : 'ltr'}
          className="flex-1 bg-transparent text-[11px] font-bold text-slate-800 placeholder:text-slate-400 outline-none min-w-0"
        />
        {loading && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin flex-shrink-0" />}
        {!loading && q && (
          <button type="button" onClick={clear} aria-label={isRTL ? 'مسح' : 'Clear'} className="text-slate-600 hover:text-slate-600 flex-shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={q.trim().length < 2}
          className="text-[10px] font-black text-primary disabled:opacity-40 flex-shrink-0 px-1"
        >
          {isRTL ? 'بحث' : 'Go'}
        </button>
      </div>

      {open && (
        <div className="absolute z-[60] mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-[10px] font-bold text-slate-600">
              {searched ? (isRTL ? 'لا توجد نتائج' : 'No results') : ''}
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => pick(r)}
                className="w-full text-start flex items-start gap-2 px-3 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-b-0"
              >
                <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-[11px] font-semibold text-slate-700 leading-snug">{r.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
