-- =============================================================================
-- VHC Mobile v1.4.5: Atomic Stock Transfer Integration Test Suite
-- Status: PREPARED FOR ISOLATED TESTING — DO NOT RUN ON PRODUCTION
-- Target Database: Local PostgreSQL (v15+) or Staging/Branching Supabase
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- -----------------------------------------------------------------------------
-- Setup Synthetic Test Fixtures
-- -----------------------------------------------------------------------------
do $$
declare
  v_wh_id   uuid;
  v_ph_id   uuid;
  v_item_id uuid;
  v_to_id   uuid;
  v_batch_id uuid;
  v_res     jsonb;
begin
  raise notice 'Starting VHC Atomic Transfer Integration Tests...';

  -- 1. Create synthetic locations
  insert into public.locations (name, type)
  values ('Test Main Warehouse', 'warehouse_main')
  returning id into v_wh_id;

  insert into public.locations (name, type)
  values ('Test Pharmacy Counter', 'pharmacy_counter')
  returning id into v_ph_id;

  -- 2. Create synthetic catalog item (Paracetamol 10-pack)
  insert into public.items (name, units_per_pack)
  values ('Synthetic Paracetamol 650', 10)
  returning id into v_item_id;

  -- 3. Stock the Warehouse with 100 strips
  insert into public.stock_batches (item_id, location_id, batch_no, expiry_date, mrp, net_rate, gst, qty)
  values (v_item_id, v_wh_id, 'BATCH-TEST-001', '2028-12-31', 30.00, 18.00, 12.00, 100)
  returning id into v_batch_id;

  -- ---------------------------------------------------------------------------
  -- TEST SCENARIO 1: Normal Forward Transfer (Strips to Units)
  -- ---------------------------------------------------------------------------
  raise notice '--- TEST 1: Forward Transfer Acceptance (5 strips -> 50 units) ---';

  insert into public.transfer_orders (transfer_number, from_location_id, to_location_id, status)
  values ('TR-TEST-001', v_wh_id, v_ph_id, 'Pending')
  returning id into v_to_id;

  insert into public.transfer_order_items (transfer_order_id, item_id, name, batch_no, qty, units_per_pack, transfer_unit)
  values (v_to_id, v_item_id, 'Synthetic Paracetamol 650', 'BATCH-TEST-001', 5, 10, 'strips');

  -- Execute RPC
  v_res := public.accept_stock_transfer(v_to_id);
  assert (v_res->>'ok')::boolean = true, 'Test 1 Failed: accept_stock_transfer did not return ok=true';
  assert (v_res->>'status') = 'Completed', 'Test 1 Failed: status is not Completed';

  -- Verify warehouse stock deducted (100 - 5 = 95 strips)
  perform 1 from public.stock_batches where id = v_batch_id and qty = 95;
  assert found, 'Test 1 Failed: Warehouse batch qty is not 95';

  -- Verify pharmacy stock created (0 + 50 = 50 units)
  perform 1 from public.stock_batches
  where item_id = v_item_id and location_id = v_ph_id and batch_no = 'BATCH-TEST-001' and qty = 50;
  assert found, 'Test 1 Failed: Pharmacy batch was not created with 50 units';

  -- Verify ledger movements
  perform 1 from public.stock_movements where movement_key = 'TRANSFER:OUT:' || v_to_id::text;
  assert found, 'Test 1 Failed: Outward movement ledger row not found';

  perform 1 from public.stock_movements where movement_key = 'TRANSFER:IN:' || v_to_id::text;
  assert found, 'Test 1 Failed: Inward movement ledger row not found';

  raise notice 'TEST 1 PASSED: Forward transfer converted strips to units and recorded ledger accurately.';

  -- ---------------------------------------------------------------------------
  -- TEST SCENARIO 2: Idempotent Retry of Completed Transfer
  -- ---------------------------------------------------------------------------
  raise notice '--- TEST 2: Idempotent Retry of Completed Transfer ---';
  v_res := public.accept_stock_transfer(v_to_id);
  assert (v_res->>'ok')::boolean = true, 'Test 2 Failed: retry did not return ok=true';
  assert (v_res->>'already_completed')::boolean = true, 'Test 2 Failed: already_completed flag missing';

  -- Re-verify stock was NOT double deducted
  perform 1 from public.stock_batches where id = v_batch_id and qty = 95;
  assert found, 'Test 2 Failed: Stock was double-deducted on retry!';

  raise notice 'TEST 2 PASSED: Retry returned idempotently without double-deducting stock.';

  -- ---------------------------------------------------------------------------
  -- TEST SCENARIO 3: Insufficient Stock Handling
  -- ---------------------------------------------------------------------------
  raise notice '--- TEST 3: Insufficient Stock Rejection & Rollback ---';

  insert into public.transfer_orders (transfer_number, from_location_id, to_location_id, status)
  values ('TR-TEST-002', v_wh_id, v_ph_id, 'Pending')
  returning id into v_to_id;

  -- Request 500 strips when only 95 are available
  insert into public.transfer_order_items (transfer_order_id, item_id, name, batch_no, qty, units_per_pack, transfer_unit)
  values (v_to_id, v_item_id, 'Synthetic Paracetamol 650', 'BATCH-TEST-001', 500, 10, 'strips');

  begin
    perform public.accept_stock_transfer(v_to_id);
    raise exception 'Test 3 Failed: Overdraft transfer should have raised exception!';
  exception
    when others then
      if sqlerrm not like '%Insufficient stock%' then
        raise exception 'Test 3 Failed: Unexpected error message %', sqlerrm;
      end if;
      raise notice 'Test 3 expected exception caught: %', sqlerrm;
  end;

  -- Verify warehouse stock remains 95
  perform 1 from public.stock_batches where id = v_batch_id and qty = 95;
  assert found, 'Test 3 Failed: Warehouse stock changed after aborted transaction!';

  raise notice 'TEST 3 PASSED: Insufficient stock correctly blocked and rolled back.';

  -- ---------------------------------------------------------------------------
  -- TEST SCENARIO 4: Transfer Rejection Safety
  -- ---------------------------------------------------------------------------
  raise notice '--- TEST 4: Transfer Rejection ---';
  v_res := public.reject_stock_transfer(v_to_id, 'Damaged batch during dispatch');
  assert (v_res->>'ok')::boolean = true, 'Test 4 Failed: reject_stock_transfer did not return ok=true';
  assert (v_res->>'status') = 'Rejected', 'Test 4 Failed: status is not Rejected';

  -- Verify transfer order status in DB
  perform 1 from public.transfer_orders
  where id = v_to_id and status = 'Rejected' and notes like '%Damaged batch%';
  assert found, 'Test 4 Failed: Transfer order status or rejection notes not saved';

  -- Verify stock untouched
  perform 1 from public.stock_batches where id = v_batch_id and qty = 95;
  assert found, 'Test 4 Failed: Stock changed on rejection!';

  raise notice 'TEST 4 PASSED: Transfer rejected cleanly without altering inventory.';

  -- ---------------------------------------------------------------------------
  -- TEST SCENARIO 5: Reverse Direction Return (Units to Strips)
  -- ---------------------------------------------------------------------------
  raise notice '--- TEST 5: Stock Return (Pharmacy 35 units -> Warehouse 3.5 strips) ---';

  insert into public.transfer_orders (transfer_number, from_location_id, to_location_id, status)
  values ('TR-TEST-003', v_ph_id, v_wh_id, 'Pending')
  returning id into v_to_id;

  -- Pharmacy returns 35 units
  insert into public.transfer_order_items (transfer_order_id, item_id, name, batch_no, qty, units_per_pack, transfer_unit)
  values (v_to_id, v_item_id, 'Synthetic Paracetamol 650', 'BATCH-TEST-001', 35, 10, 'units');

  v_res := public.accept_stock_transfer(v_to_id);
  assert (v_res->>'ok')::boolean = true, 'Test 5 Failed: return accept did not return ok=true';

  -- Pharmacy stock: was 50, deducted 35 -> 15 units remaining
  perform 1 from public.stock_batches
  where item_id = v_item_id and location_id = v_ph_id and batch_no = 'BATCH-TEST-001' and qty = 15;
  assert found, 'Test 5 Failed: Pharmacy stock is not 15 units!';

  -- Warehouse stock: was 95, added 35/10 = 3.5 strips -> 98.5 strips
  perform 1 from public.stock_batches
  where id = v_batch_id and qty = 98.5;
  assert found, 'Test 5 Failed: Warehouse stock is not 98.5 strips (fractional preservation failed)!';

  raise notice 'TEST 5 PASSED: Reverse return preserved fractional 3.5 strips accurately.';

  raise notice 'ALL INTEGRATION TEST SCENARIOS PASSED SUCCESSFULLY.';
end;
$$;

-- Always rollback in test harness so test records are completely cleaned up
rollback;
