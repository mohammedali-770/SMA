-- Admin free text used to resolve account-deletion manual review is internal
-- audit data. The customer-readable request row must retain only its original
-- server-generated safe reason.
begin;

do $$
declare
  v_customer uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_customer), (v_admin)
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, phone_number, role)
  values
    (v_customer, 'Privacy Test Customer', '+966500008811', 'customer'),
    (v_admin, 'Privacy Test Admin', '+966500008812', 'admin')
  on conflict (id) do update set role=excluded.role;

  insert into public.account_deletion_requests (
    id, user_id, status, verification_method, identity_verified_at,
    manual_review_reason
  ) values (
    v_request, v_customer, 'manual_review', 'reauth', now(),
    'safe_server_reason'
  );

  perform set_config('test.note_customer', v_customer::text, true);
  perform set_config('test.note_admin', v_admin::text, true);
  perform set_config('test.note_request', v_request::text, true);
end $$;

do $$
declare
  v_request uuid := current_setting('test.note_request')::uuid;
  v_note text := repeat('internal-investigation-', 40);
  v_reason text;
  v_audit_note text;
begin
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform set_config('test.auth_uid', current_setting('test.note_admin'), true);
  set local role authenticated;
  perform public.resolve_account_deletion_request(v_request, 'fail', v_note);
  reset role;

  select manual_review_reason into v_reason
    from public.account_deletion_requests where id=v_request;
  if v_reason <> 'safe_server_reason' then
    raise exception 'PRIVACY FAILED: admin note leaked/replaced customer-visible reason: %', v_reason;
  end if;

  select resolution_note into v_audit_note
    from public.account_deletion_resolution_audit
   where request_id=v_request order by id desc limit 1;
  if v_audit_note is null or length(v_audit_note) <> 500
     or v_audit_note <> left(v_note, 500) then
    raise exception 'PRIVACY FAILED: bounded audit note not stored as expected';
  end if;

  -- The customer can read its request row but RLS must hide the admin audit row.
  perform set_config('test.is_admin', 'false', true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.auth_uid', current_setting('test.note_customer'), true);
  set local role authenticated;
  if (select count(*) from public.account_deletion_resolution_audit where request_id=v_request) <> 0 then
    raise exception 'PRIVACY FAILED: customer can read admin resolution audit';
  end if;
  reset role;

  raise notice 'PRIVACY OK: customer reason stays safe; bounded admin note is audit-only';
end $$;

rollback;
