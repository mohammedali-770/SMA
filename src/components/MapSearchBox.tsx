import React, { useRef, useState } from 'react';
import { Search, Loader2, MapPin, X } from 'lucide-react';

import { Text } from '../design-system/ui/Text';
import { useDsFontClass } from '../design-system/ui/useDsLang';
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
  const family = useDsFontClass();

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
      <div className="flex items-center gap-1.5 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-2 py-1.5">
        <Search className="size-3.5 shrink-0 text-con-text-3" aria-hidden="true" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); if (!e.target.value) clear(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }}
          placeholder={isRTL ? 'ابحث عن عنوان أو مكان…' : 'Search address or place…'}
          aria-label={isRTL ? 'ابحث عن عنوان أو مكان' : 'Search address or place'}
          dir={isRTL ? 'rtl' : 'ltr'}
          className={`ds-motion min-w-0 flex-1 bg-transparent text-[13px] text-con-text outline-none placeholder:text-con-text-3 ${family}`}
        />
        {loading && <Loader2 className="size-3.5 shrink-0 animate-spin text-ember" aria-hidden="true" />}
        {!loading && q && (
          <button
            type="button"
            onClick={clear}
            aria-label={isRTL ? 'مسح' : 'Clear'}
            className="ds-motion shrink-0 rounded-[var(--radius-ds-sm)] focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <X className="size-3.5 text-con-text-3" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={q.trim().length < 2}
          className="ds-motion shrink-0 rounded-[var(--radius-ds-sm)] px-1 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Text variant="caption" tone="ember" as="span">{isRTL ? 'بحث' : 'Go'}</Text>
        </button>
      </div>

      {open && (
        <div className="absolute z-[60] mt-1 max-h-52 w-full overflow-y-auto overflow-x-hidden rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface">
          {results.length === 0 ? (
            <div className="px-3 py-2">
              <Text variant="caption" tone="tertiary" as="span">
                {searched ? (isRTL ? 'لا توجد نتائج' : 'No results') : ''}
              </Text>
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => pick(r)}
                className="ds-motion flex w-full items-start gap-2 border-b border-con-line px-3 py-2 text-start transition-colors duration-150 last:border-b-0 hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-ember" aria-hidden="true" />
                <Text variant="caption" tone="secondary" as="span">{r.label}</Text>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
