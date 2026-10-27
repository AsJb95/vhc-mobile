-- =============================================================================
-- Migration: 20261020000100_atomic_stock_transfers.sql
-- Purpose: Production-grade atomic stock transfers and returns for VHC
-- Status: PREPARED, AUDITED & HARDENED (Stage 4) - DO NOT EXECUTE until approval
-- Compatible with: VHC Mobile, VHC Warehouse Management, VHC Pharmacy POS
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Schema Self-Healing: Ensure transfer_orders audit columns exist
-- -----------------------------------------------------------------------------
alter table public.transfer_orders
  add column if not exists created_by   uuid references auth.users(id),
  add column if not exists approved_by  uuid references auth.users(id),
  add column if not exists approved_at  timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancelled_at timestamptz;

-- -----------------------------------------------------------------------------
-- 1. Atomic Accept Stock Transfer RPC (Warehouse <-> Pharmacy)
-- -----------------------------------------------------------------------------
create or replace function public.accept_stock_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to              public.transfer_orders%rowtype;
  v_item            record;
  v_src             public.stock_batches%rowtype;
  v_dst             public.stock_batches%rowtype;
  v_from_loc_type   text;
  v_to_loc_type     text;
  v_is_return       boolean := false;
  v_is_legacy       boolean;
  v_src_qty         numeric;
  v_dst_qty         numeric;
  v_units_per_pk    numeric;
  v_src_opening     numeric;
  v_dst_opening     numeric;
  v_items_count     int := 0;
  v_out_mov_key     text;
  v_in_mov_key      text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;

  -- 1. Lock the transfer order to serialize concurrent requests
  select * into v_to from public.transfer_orders where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer request % not found', p_transfer_id using errcode = 'no_data_found';
  end if;

  -- Idempotency check: if already completed, safely return success
  if v_to.status = 'Completed' then
    return jsonb_build_object(
      'ok', true,
      'already_completed', true,
      'transfer_id', p_transfer_id,
      'transfer_number', v_to.transfer_number,
      'status', 'Completed'
    );
  end if;

  if v_to.status <> 'Pending' then
    raise exception 'Transfer request is already % (must be Pending)', v_to.status using errcode = 'check_violation';
  end if;

  -- 2. Determine transfer direction from actual location types
  select type into v_from_loc_type from public.locations where id = v_to.from_location_id;
  select type into v_to_loc_type from public.locations where id = v_to.to_location_id;

  v_is_return := (v_from_loc_type = 'pharmacy_counter' and v_to_loc_type in ('warehouse_main', 'warehouse_sub'));

  -- 3. Role authorization check
  if v_is_return then
    -- Return to Warehouse: Warehouse manager or Admin must approve
    if not coalesce(public.is_warehouse_writer(), false) then
      raise exception 'Only warehouse managers or admins can accept stock returns' using errcode = 'insufficient_privilege';
    end if;
  else
    -- Transfer to Pharmacy: Pharmacy staff, Warehouse manager, or Admin can approve
    if not (coalesce(public.is_pharmacy_writer(), false) or coalesce(public.is_warehouse_writer(), false)) then
      raise exception 'Not authorized to accept pharmacy transfer requests' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- 4. Process each line item in single atomic transaction
  for v_item in
    select toi.*, i.name as catalog_name, i.units_per_pack as catalog_upp
    from public.transfer_order_items toi
    left join public.items i on i.id = toi.item_id
    where toi.transfer_order_id = p_transfer_id
    order by toi.id
  loop
    v_items_count := v_items_count + 1;
    v_units_per_pk := coalesce(v_item.units_per_pack, v_item.catalog_upp, 1);

    -- Check if this is a legacy line without unit metadata
    v_is_legacy := (v_item.transfer_unit is null and v_item.units_per_pack is null);

    if v_is_legacy then
      -- Historical 1:1 passthrough
      v_src_qty := coalesce(v_item.qty, 0);
      v_dst_qty := v_src_qty;
    else
      -- Validation against malformed records
      if v_item.transfer_unit not in ('strips', 'units') then
        raise exception 'Transfer line for "%" has invalid transfer_unit "%"',
          coalesce(v_item.name, v_item.catalog_name, 'Unknown'), v_item.transfer_unit;
      end if;
      if v_units_per_pk <= 0 then
        raise exception 'Transfer line for "%" has invalid units_per_pack %',
          coalesce(v_item.name, v_item.catalog_name, 'Unknown'), v_units_per_pk;
      end if;

      if v_is_return then
        -- Pharmacy (units) -> Warehouse (strips)
        -- v_item.qty is already recorded in native Pharmacy units
        v_src_qty := coalesce(v_item.qty, 0);
        v_dst_qty := case when v_units_per_pk > 1 then (v_src_qty::numeric / v_units_per_pk::numeric) else v_src_qty end;
      else
        -- Warehouse (strips) -> Pharmacy (units)
        -- v_item.qty is already recorded in native Warehouse strips
        v_src_qty := coalesce(v_item.qty, 0);
        v_dst_qty := case when v_units_per_pk > 1 then (v_src_qty::numeric * v_units_per_pk::numeric) else v_src_qty end;
      end if;
    end if;

    if v_src_qty <= 0 or v_dst_qty <= 0 then
      continue;
    end if;

    -- Lock and verify source batch
    select * into v_src
    from public.stock_batches
    where item_id = v_item.item_id
      and location_id = v_to.from_location_id
      and batch_no is not distinct from v_item.batch_no
    order by id
    limit 1
    for update;

    if not found then
      raise exception 'Source stock batch not found for item "%" (batch %)',
        coalesce(v_item.name, v_item.catalog_name, 'Unknown'), coalesce(v_item.batch_no, '—');
    end if;

    if coalesce(v_src.qty, 0) < v_src_qty then
      raise exception 'Insufficient stock for "%": requested %, available %',
        coalesce(v_item.name, v_item.catalog_name, 'Unknown'), v_src_qty, coalesce(v_src.qty, 0);
    end if;

    -- Conditional stock deduction guaranteeing non-negative inventory
    v_src_opening := coalesce(v_src.qty, 0);
    update public.stock_batches
    set qty = qty - v_src_qty
    where id = v_src.id and qty >= v_src_qty;

    if not found then
      raise exception 'Concurrent stock modification detected for "%": insufficient available stock',
        coalesce(v_item.name, v_item.catalog_name, 'Unknown');
    end if;

    -- Deterministic movement keys for idempotency
    v_out_mov_key := 'TRANSFER:OUT:' || p_transfer_id::text || ':' || v_item.id::text;
    v_in_mov_key  := 'TRANSFER:IN:'  || p_transfer_id::text || ':' || v_item.id::text;

    -- Outward stock movement ledger
    insert into public.stock_movements (
      item_id, location_id, batch_no, type, qty, opening, closing, reason, created_by, movement_key
    ) values (
      v_item.item_id, v_to.from_location_id, v_src.batch_no, 'TRANSFER',
      -v_src_qty, v_src_opening, v_src_opening - v_src_qty,
      'Transfer ' || v_to.transfer_number || ' accepted (outward)', auth.uid(), v_out_mov_key
    )
    on conflict (movement_key) do nothing;

    -- Advisory transaction lock on destination batch to serialize find-or-create under concurrency
    perform pg_advisory_xact_lock(hashtext('batch_dest:' || v_item.item_id::text || ':' || v_to.to_location_id::text || ':' || coalesce(v_src.batch_no, '')));

    -- Lock destination batch
    select * into v_dst
    from public.stock_batches
    where item_id = v_item.item_id
      and location_id = v_to.to_location_id
      and batch_no is not distinct from v_src.batch_no
    order by id
    limit 1
    for update;

    if found then
      v_dst_opening := coalesce(v_dst.qty, 0);
      update public.stock_batches
      set qty = qty + v_dst_qty
      where id = v_dst.id;
    else
      v_dst_opening := 0;
      insert into public.stock_batches (
        item_id, location_id, batch_no, expiry_date, mrp, net_rate, gst, stockist, qty
      ) values (
        v_item.item_id, v_to.to_location_id, v_src.batch_no, v_src.expiry_date,
        v_src.mrp, v_src.net_rate, v_src.gst, v_src.stockist, v_dst_qty
      )
      returning * into v_dst;
    end if;

    -- Inward stock movement ledger
    insert into public.stock_movements (
      item_id, location_id, batch_no, type, qty, opening, closing, reason, created_by, movement_key
    ) values (
      v_item.item_id, v_to.to_location_id, v_src.batch_no, 'TRANSFER',
      v_dst_qty, v_dst_opening, v_dst_opening + v_dst_qty,
      'Transfer ' || v_to.transfer_number || ' accepted (inward)', auth.uid(), v_in_mov_key
    )
    on conflict (movement_key) do nothing;
  end loop;

  if v_items_count = 0 then
    raise exception 'Transfer request % has no line items to transfer', p_transfer_id;
  end if;

  -- 5. Mark transfer order completed
  update public.transfer_orders
  set status = 'Completed',
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_transfer_id;

  return jsonb_build_object(
    'ok', true,
    'transfer_id', p_transfer_id,
    'transfer_number', v_to.transfer_number,
    'status', 'Completed',
    'items_transferred', v_items_count
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Atomic Reject Stock Transfer RPC
-- -----------------------------------------------------------------------------
create or replace function public.reject_stock_transfer(
  p_transfer_id uuid,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to            public.transfer_orders%rowtype;
  v_from_loc_type text;
  v_to_loc_type   text;
  v_is_return     boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_to from public.transfer_orders where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer request % not found', p_transfer_id using errcode = 'no_data_found';
  end if;

  -- Idempotency check: if already rejected, safely return status
  if v_to.status = 'Rejected' then
    return jsonb_build_object(
      'ok', true,
      'already_rejected', true,
      'transfer_id', p_transfer_id,
      'transfer_number', v_to.transfer_number,
      'status', 'Rejected'
    );
  end if;

  if v_to.status <> 'Pending' then
    raise exception 'Transfer request is already % (must be Pending)', v_to.status using errcode = 'check_violation';
  end if;

  select type into v_from_loc_type from public.locations where id = v_to.from_location_id;
  select type into v_to_loc_type from public.locations where id = v_to.to_location_id;

  v_is_return := (v_from_loc_type = 'pharmacy_counter' and v_to_loc_type in ('warehouse_main', 'warehouse_sub'));

  if v_is_return then
    if not coalesce(public.is_warehouse_writer(), false) then
      raise exception 'Only warehouse managers or admins can reject returns' using errcode = 'insufficient_privilege';
    end if;
  else
    if not (coalesce(public.is_pharmacy_writer(), false) or coalesce(public.is_warehouse_writer(), false)) then
      raise exception 'Not authorized to reject pharmacy transfer requests' using errcode = 'insufficient_privilege';
    end if;
  end if;

  update public.transfer_orders
  set status = 'Rejected',
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      notes = case
        when p_reason is not null and length(trim(p_reason)) > 0 then
          coalesce(notes || ' | Rejection: ' || trim(p_reason), 'Rejection: ' || trim(p_reason))
        else notes
      end
  where id = p_transfer_id;

  return jsonb_build_object(
    'ok', true,
    'transfer_id', p_transfer_id,
    'transfer_number', v_to.transfer_number,
    'status', 'Rejected'
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Grants and Permissions
-- -----------------------------------------------------------------------------
revoke all on function public.accept_stock_transfer(uuid) from public, anon;
grant execute on function public.accept_stock_transfer(uuid) to authenticated;

revoke all on function public.reject_stock_transfer(uuid, text) from public, anon;
grant execute on function public.reject_stock_transfer(uuid, text) to authenticated;

-- Allow pharmacy staff to update transfer orders when they are the destination
drop policy if exists "to_write_pharmacy_destination" on public.transfer_orders;
create policy "to_write_pharmacy_destination" on public.transfer_orders
  for update to authenticated
  using (
    public.is_pharmacy_writer()
    and to_location_id in (select id from public.locations where type = 'pharmacy_counter')
  )
  with check (
    public.is_pharmacy_writer()
    and to_location_id in (select id from public.locations where type = 'pharmacy_counter')
  );

commit;
