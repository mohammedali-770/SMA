-- ===========================================================================
-- admin_search_role_candidates — find a customer by the phone number a human
-- actually types
-- ===========================================================================
--
-- Found on 2026-08-27, from the Comped Customers panel: an admin searched
-- `+966555820667` and got "No matching customers".
--
-- The search matched `phone_number ilike '%' || query || '%'` — a raw substring
-- over whatever string happens to be stored. `profiles.phone_number` is NOT
-- stored in one shape. At the time of writing, live Production held five
-- profiles with a phone: FOUR as `9665…` and ONE as `+9665…`. That drift is
-- already documented in 20260806120000_erasure_phone_normalization.sql:168 —
-- "the source may or may not carry a '+' depending on which trigger wrote it"
-- — where it was solved for erasure by normalizing BOTH sides. The search was
-- never given the same treatment.
--
-- So, against live data:
--
--   typed `+966555820667`  matched 1 of 5   (only the one row carrying a '+')
--   typed `0555820667`     matched 0 of 5   (no stored row starts with a 0)
--   typed `555820667`      matched 5 of 5
--
-- The failure mode is what makes this worth a migration rather than a note. A
-- customer who exists and a customer who does not both render as "No matching
-- customers", and the admin cannot tell them apart. On this particular panel
-- the wrong conclusion is "that person has no account", when in fact they do
-- and the only thing wrong was a plus sign.
--
-- The same function backs the staff-role search (`admin_set_user_role`'s
-- candidate picker, 20260810141000), so the identical trap existed when
-- promoting a staff member. One fix, both call sites.
--
-- Storage itself is deliberately NOT rewritten. Normalizing existing
-- `profiles.phone_number` values would be a bulk write to live customer PII to
-- fix a read path, and it would leave every future writer free to reintroduce
-- the drift. Normalizing at the point of comparison is both the smaller change
-- and the durable one: it keeps working whatever shape the next trigger writes.
-- ===========================================================================

create or replace function public.admin_search_role_candidates(
  p_query text,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query  text    := btrim(coalesce(p_query, ''));
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_e164   text;
  v_digits text;
  v_rows   jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins may search role candidates' using errcode = '42501';
  end if;

  if length(v_query) < 2 then
    raise exception 'Search requires at least 2 characters' using errcode = '22023';
  end if;

  -- A COMPLETE Saudi mobile, in any of the shapes a person types it:
  -- +9665XXXXXXXX · 009665XXXXXXXX · 9665XXXXXXXX · 05XXXXXXXX · 5XXXXXXXX.
  -- normalize_ksa_e164 returns null for anything that is not one, which is what
  -- keeps the exact-match arm below from firing on a partial or a name.
  v_e164 := public.normalize_ksa_e164(v_query);

  -- A PARTIAL number — someone typing the first digits, or the last four to
  -- confirm a match. Reduce it to the national fragment so a partial typed with
  -- a country code or a trunk zero still lines up with the stored digits. Each
  -- strip is length-guarded so a short query cannot be reduced to the empty
  -- string, which would otherwise make `like '%%'` match every customer.
  v_digits := regexp_replace(v_query, '[^0-9]', '', 'g');
  if length(v_digits) > 5 and v_digits like '00966%' then
    v_digits := substr(v_digits, 6);
  elsif length(v_digits) > 3 and v_digits like '966%' then
    v_digits := substr(v_digits, 4);
  end if;
  if length(v_digits) > 1 and v_digits like '0%' then
    v_digits := substr(v_digits, 2);
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.full_name nulls last, t.id), '[]'::jsonb)
    into v_rows
    from (
      select p.id, p.full_name, p.email, p.phone_number, p.role, p.created_at, p.updated_at
        from public.profiles p
        -- The stored number reduced to ONE comparable shape. Fall back to the
        -- bare digits when the row is not a Saudi mobile (a landline, an
        -- imported oddity, a test fixture) so those stay findable rather than
        -- dropping out of the search entirely.
        cross join lateral (
          select coalesce(
                   public.normalize_ksa_e164(p.phone_number),
                   regexp_replace(coalesce(p.phone_number, ''), '[^0-9]', '', 'g')
                 ) as hay
        ) ph
       where coalesce(p.full_name, '') ilike '%' || v_query || '%'
          or coalesce(p.email, '')     ilike '%' || v_query || '%'
          -- Exact, when a whole number was typed: no false positives at all.
          or (v_e164 is not null and ph.hay = v_e164)
          -- Forgiving, when it was not. Guarded on a non-empty fragment.
          or (v_digits <> '' and ph.hay like '%' || v_digits || '%')
       order by p.full_name nulls last, p.id
       limit v_limit
    ) t;

  return v_rows;
end $$;

-- Unchanged from 20260810141000: admins only, and never anon.
revoke all on function public.admin_search_role_candidates(text, integer)
  from public, anon;
grant execute on function public.admin_search_role_candidates(text, integer)
  to authenticated;

comment on function public.admin_search_role_candidates(text, integer) is
  'Admin customer search by name, email or phone. Phone matching normalizes BOTH '
  'sides through normalize_ksa_e164, so +9665…, 009665…, 9665…, 05… and 5… all '
  'find the same person regardless of the shape stored in profiles.phone_number.';
