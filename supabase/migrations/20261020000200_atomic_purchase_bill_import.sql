-- =============================================================================
-- Migration: 20261020000200_atomic_purchase_bill_import.sql
-- Purpose: Production-grade atomic purchase bill import for VHC Mobile & Warehouse
-- Status: HARDENED & SELF-HEALING (Stage 6)
-- Compatible with: VHC Mobile, VHC Warehouse Management, VHC Pharmacy POS
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Schema Self-Healing: Ensure purchase_orders & purchase_order_items exist
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null,
  supplier text not null,
  status text not null default 'Pending' check (status in ('Pending', 'Received', 'Cancelled')),
  po_date date,
  expected_delivery date,
  received_at timestamptz,
  notes text,
  subtotal numeric default 0,
  gst_total numeric default 0,
  total_amount numeric default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- Ensure audit & financial columns exist on existing installations
alter table public.purchase_orders
  add column if not exists po_date date,
  add column if not exists expected_delivery date,
  add column if not exists notes text,
  add column if not exists subtotal numeric default 0,
  add column if not exists gst_total numeric default 0,
  add column if not exists total_amount numeric default 0,
  add column if not exists received_at timestamptz,
  add column if not exists created_by uuid references auth.users(id);

create index if not exists idx_purchase_orders_supplier_po
  on public.purchase_orders (lower(supplier), lower(po_number));

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid references public.items(id),
  name text not null,
  batch_no text,
  expiry_date date,
  net_rate numeric default 0,
  mrp numeric default 0,
  gst numeric default 12,
  qty numeric not null default 0,
  units_per_pack numeric default 10,
  category text,
  hsn_code text,
  created_at timestamptz not null default now()
);

-- Ensure RLS is enabled and policies exist for authenticated users
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'purchase_orders' and policyname = 'Authenticated users can manage purchase orders'
  ) then
    create policy "Authenticated users can manage purchase orders"
      on public.purchase_orders
      for all
      to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'purchase_order_items' and policyname = 'Authenticated users can manage purchase order items'
  ) then
    create policy "Authenticated users can manage purchase order items"
      on public.purchase_order_items
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Atomic Purchase Bill Import RPC
-- -----------------------------------------------------------------------------
create or replace function public.atomic_import_purchase_bill(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier          text;
  v_invoice_number    text;
  v_invoice_date      date;
  v_notes             text;
  v_items             jsonb;
  v_item_elem         jsonb;
  v_main_loc_id       uuid;
  v_po_id             uuid;
  v_subtotal          numeric := 0;
  v_gst_total         numeric := 0;
  v_grand_total       numeric := 0;
  v_total_strips      numeric := 0;
  v_items_count       int := 0;
  
  -- Per-item variables
  v_name              text;
  v_batch_no          text;
  v_expiry_date       date;
  v_qty               numeric;
  v_free_qty          numeric;
  v_total_item_strips numeric;
  v_upp               numeric;
  v_mrp               numeric;
  v_net_rate          numeric;
  v_gst_pct           numeric;
  v_line_taxable      numeric;
  v_line_gst          numeric;
  v_line_total        numeric;
  v_item_id           uuid;
  v_batch_id          uuid;
  v_batch_opening     numeric;
  v_batch_closing     numeric;
  v_mov_key           text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;

  v_supplier       := trim(coalesce(p_payload->>'supplier', ''));
  v_invoice_number := trim(coalesce(p_payload->>'invoice_number', ''));
  v_notes          := coalesce(p_payload->>'notes', 'Imported via VHC Mobile Bill Scanner');
  v_items          := p_payload->'items';

  if v_supplier = '' then
    raise exception 'Supplier name is required' using errcode = 'check_violation';
  end if;
  if v_invoice_number = '' then
    raise exception 'Invoice number is required' using errcode = 'check_violation';
  end if;
  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception 'At least one item is required in the purchase bill' using errcode = 'check_violation';
  end if;

  -- Parse invoice date
  begin
    v_invoice_date := (p_payload->>'invoice_date')::date;
  exception when others then
    v_invoice_date := current_date;
  end;

  -- 1. Transaction Advisory Lock on Supplier + Invoice Number to serialize concurrent submissions
  perform pg_advisory_xact_lock(hashtext('purchase_bill:' || lower(v_supplier) || ':' || lower(v_invoice_number)));

  -- 2. Duplicate invoice check: reject if already received
  perform 1 from public.purchase_orders
   where lower(supplier) = lower(v_supplier)
     and lower(po_number) = lower(v_invoice_number)
     and status = 'Received';
  if found then
    raise exception 'Invoice % from % has already been imported and received', v_invoice_number, v_supplier
      using errcode = 'unique_violation';
  end if;

  -- 3. Resolve Warehouse Main location
  select id into v_main_loc_id
    from public.locations
   where type = 'warehouse_main'
   limit 1;

  if v_main_loc_id is null then
    raise exception 'Warehouse main location not found' using errcode = 'no_data_found';
  end if;

  -- 4. Create the Purchase Order header
  insert into public.purchase_orders (
    po_number,
    supplier,
    status,
    po_date,
    received_at,
    notes,
    created_at,
    created_by
  ) values (
    v_invoice_number,
    v_supplier,
    'Received',
    v_invoice_date,
    now(),
    v_notes,
    now(),
    auth.uid()
  ) returning id into v_po_id;

  -- 5. Process each medicine line
  for v_item_elem in select * from jsonb_array_elements(v_items)
  loop
    v_name              := trim(coalesce(v_item_elem->>'name', ''));
    v_batch_no          := nullif(trim(coalesce(v_item_elem->>'batch', '')), '');
    v_qty               := coalesce((v_item_elem->>'qty')::numeric, 0);
    v_free_qty          := coalesce((v_item_elem->>'free_qty')::numeric, 0);
    v_upp               := coalesce((v_item_elem->>'units_per_pack')::numeric, 10);
    v_mrp               := coalesce((v_item_elem->>'mrp')::numeric, 0);
    v_net_rate          := coalesce((v_item_elem->>'net_rate')::numeric, 0);
    v_gst_pct           := coalesce((v_item_elem->>'gst')::numeric, 12);

    if v_name = '' then
      raise exception 'Medicine name cannot be blank in item row %', v_items_count + 1
        using errcode = 'check_violation';
    end if;

    if v_qty <= 0 and v_free_qty <= 0 then
      raise exception 'Item % must have quantity greater than zero', v_name
        using errcode = 'check_violation';
    end if;

    if v_upp <= 0 then
      v_upp := 10;
    end if;

    v_total_item_strips := round(v_qty + v_free_qty, 3);

    begin
      v_expiry_date := (v_item_elem->>'expiry')::date;
    exception when others then
      v_expiry_date := null;
    end;

    -- Financial line totals
    v_line_taxable := round(v_qty * v_net_rate, 2);
    v_line_gst     := round(v_line_taxable * (v_gst_pct / 100), 2);
    v_line_total   := v_line_taxable + v_line_gst;

    v_subtotal     := v_subtotal + v_line_taxable;
    v_gst_total    := v_gst_total + v_line_gst;
    v_grand_total  := v_grand_total + v_line_total;
    v_total_strips := v_total_strips + v_total_item_strips;

    -- A. Resolve or create item in `items` table
    select id into v_item_id
      from public.items
     where lower(trim(name)) = lower(v_name)
     limit 1;

    if v_item_id is null then
      insert into public.items (
        name,
        units_per_pack,
        category,
        created_at
      ) values (
        v_name,
        v_upp,
        coalesce(v_item_elem->>'category', 'Medicines'),
        now()
      ) returning id into v_item_id;
    end if;

    -- B. Record Purchase Order Item line
    insert into public.purchase_order_items (
      purchase_order_id,
      item_id,
      name,
      batch_no,
      expiry_date,
      qty,
      mrp,
      net_rate,
      gst,
      units_per_pack
    ) values (
      v_po_id,
      v_item_id,
      v_name,
      v_batch_no,
      v_expiry_date,
      v_total_item_strips,
      v_mrp,
      v_net_rate,
      v_gst_pct,
      v_upp
    );

    -- C. Serialize access to this specific medicine batch in warehouse
    perform pg_advisory_xact_lock(hashtext('batch_dest:' || v_item_id::text || ':' || v_main_loc_id::text || ':' || coalesce(v_batch_no, '')));

    -- Lookup existing batch
    if v_batch_no is not null then
      select id, qty into v_batch_id, v_batch_opening
        from public.stock_batches
       where item_id = v_item_id
         and location_id = v_main_loc_id
         and batch_no = v_batch_no
       for update;
    else
      select id, qty into v_batch_id, v_batch_opening
        from public.stock_batches
       where item_id = v_item_id
         and location_id = v_main_loc_id
         and batch_no is null
       for update;
    end if;

    if v_batch_id is not null then
      v_batch_closing := v_batch_opening + v_total_item_strips;
      update public.stock_batches
         set qty = v_batch_closing,
             mrp = case when v_mrp > 0 then v_mrp else mrp end,
             net_rate = case when v_net_rate > 0 then v_net_rate else net_rate end,
             expiry_date = coalesce(v_expiry_date, expiry_date),
             stockist = v_supplier
       where id = v_batch_id;
    else
      v_batch_opening := 0;
      v_batch_closing := v_total_item_strips;
      insert into public.stock_batches (
        item_id,
        location_id,
        batch_no,
        expiry_date,
        mrp,
        net_rate,
        gst,
        stockist,
        qty
      ) values (
        v_item_id,
        v_main_loc_id,
        v_batch_no,
        v_expiry_date,
        v_mrp,
        v_net_rate,
        v_gst_pct,
        v_supplier,
        v_total_item_strips
      ) returning id into v_batch_id;
    end if;

    -- D. Log stock movement for full audit trail
    v_mov_key := 'po_import:' || v_po_id::text || ':' || v_item_id::text || ':' || coalesce(v_batch_no, 'null');
    insert into public.stock_movements (
      item_id,
      location_id,
      batch_no,
      type,
      qty,
      opening,
      closing,
      reason,
      created_by,
      movement_key,
      created_at
    ) values (
      v_item_id,
      v_main_loc_id,
      v_batch_no,
      'PURCHASE_RECEIPT',
      v_total_item_strips,
      v_batch_opening,
      v_batch_closing,
      'Bill Import: ' || v_invoice_number || ' (' || v_supplier || ')',
      auth.uid(),
      v_mov_key,
      now()
    );

    v_items_count := v_items_count + 1;
  end loop;

  -- 6. Update Purchase Order financial totals
  update public.purchase_orders
     set subtotal = round(v_subtotal, 2),
         gst_total = round(v_gst_total, 2),
         total_amount = round(v_grand_total, 2)
   where id = v_po_id;

  return jsonb_build_object(
    'ok', true,
    'purchase_order_id', v_po_id,
    'invoice_number', v_invoice_number,
    'supplier', v_supplier,
    'items_count', v_items_count,
    'total_strips_added', v_total_strips,
    'grand_total', round(v_grand_total, 2)
  );
end;
$$;

-- Revoke execute from public/anon and grant to authenticated
revoke all on function public.atomic_import_purchase_bill(jsonb) from public, anon;
grant execute on function public.atomic_import_purchase_bill(jsonb) to authenticated;

commit;
