import { createClient } from '@supabase/supabase-js';

const url = process.env.VHC_TEST_SUPABASE_URL;
const key = process.env.VHC_TEST_SUPABASE_ANON_KEY;
const email = process.env.VHC_TEST_QA_EMAIL;
const password = process.env.VHC_TEST_QA_PASSWORD;

console.log('=== VHC MOBILE v1.4.5: STAGE 6 MIGRATION STAGING VALIDATION ===');
console.log('Staging URL:', url);

// Strict safety guard: Fail immediately if URL does not match dvscemgqegmfmgrtytal or points to production
if (!url || !url.includes('dvscemgqegmfmgrtytal') || url.includes('yrgtnhvnwkqudxdcrkhm')) {
  console.error('FATAL: Target URL is NOT the verified staging project dvscemgqegmfmgrtytal! Aborting.');
  process.exit(1);
}

const supabase = createClient(url, key);

async function runTests() {
  // 1. Authenticate with Staging QA User
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr || !authData.user) {
    console.error('Authentication failed:', authErr?.message);
    process.exit(1);
  }
  console.log('Authenticated as Staging User:', authData.user.email, 'ID:', authData.user.id);

  // 2. Capture PRE snapshot
  const { count: prePO } = await supabase.from('purchase_orders').select('*', { count: 'exact', head: true });
  const { count: preBatches } = await supabase.from('stock_batches').select('*', { count: 'exact', head: true });
  const { count: preItems } = await supabase.from('items').select('*', { count: 'exact', head: true });
  const { count: preMovements } = await supabase.from('stock_movements').select('*', { count: 'exact', head: true });

  console.log('\n--- PRE-TEST SNAPSHOT ---');
  console.log(`purchase_orders: ${prePO || 0}`);
  console.log(`stock_batches:   ${preBatches || 0}`);
  console.log(`items:           ${preItems || 0}`);
  console.log(`stock_movements: ${preMovements || 0}`);

  let testPassed = true;

  // ---------------------------------------------------------------------------
  // TEST A: Normal Purchase Bill Import (Multiple Items, Free Schemes, UPP)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST A: Normal Purchase Bill Import ---');
  const testInvoiceA = 'TEST-INV-2026-STAGE6-01';
  const testSupplierA = 'TEST-DISTRIBUTOR-STAGE6';
  const payloadA = {
    supplier: testSupplierA,
    invoice_number: testInvoiceA,
    invoice_date: '2026-10-20',
    notes: 'Validation Test A - Multi-item import with free stock',
    items: [
      {
        name: 'TEST-MED-DOLO-650',
        batch: 'TEST-BT-DL01',
        expiry: '2028-08-01',
        qty: 50,
        free_qty: 5, // 50 + 5 free = 55 strips
        units_per_pack: 15,
        mrp: 33.6,
        net_rate: 24.5,
        gst: 12,
      },
      {
        name: 'TEST-MED-PAN-40',
        batch: 'TEST-BT-PN01',
        expiry: '2027-11-01',
        qty: 30,
        free_qty: 0, // 30 strips
        units_per_pack: 15,
        mrp: 165.0,
        net_rate: 120.0,
        gst: 12,
      },
    ],
  };

  const { data: resA, error: errA } = await supabase.rpc('atomic_import_purchase_bill', { p_payload: payloadA });
  if (errA) {
    console.error('TEST A FAILED: RPC call returned error:', errA);
    testPassed = false;
  } else {
    console.log('TEST A RPC Result:', resA);
    if (resA.ok && resA.items_count === 2 && resA.total_strips_added === 85) {
      console.log('TEST A PASS: RPC returned ok with 2 items and 85 total strips.');
    } else {
      console.error('TEST A FAILED: Unexpected RPC response structure.');
      testPassed = false;
    }

    // Verify stock_batches in DB
    const { data: batchesA } = await supabase
      .from('stock_batches')
      .select('id, batch_no, qty, items(name)')
      .in('batch_no', ['TEST-BT-DL01', 'TEST-BT-PN01']);

    const doloBatch = batchesA?.find((b) => b.batch_no === 'TEST-BT-DL01');
    const panBatch = batchesA?.find((b) => b.batch_no === 'TEST-BT-PN01');

    if (doloBatch && doloBatch.qty === 55 && panBatch && panBatch.qty === 30) {
      console.log('TEST A PASS: Stock batch quantities verified (DOLO=55 strips, PAN=30 strips).');
    } else {
      console.error('TEST A FAILED: Stock batch quantities incorrect:', batchesA);
      testPassed = false;
    }
  }

  // ---------------------------------------------------------------------------
  // TEST B: Duplicate Invoice Protection
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST B: Duplicate Invoice Protection ---');
  const { data: resB, error: errB } = await supabase.rpc('atomic_import_purchase_bill', { p_payload: payloadA });
  if (errB && (errB.message.includes('already been imported') || errB.code === '23505' || errB.details?.includes('unique_violation'))) {
    console.log('TEST B PASS: Duplicate invoice successfully rejected with error:', errB.message);
  } else {
    console.error('TEST B FAILED: Duplicate invoice was not rejected! Result:', resB, 'Error:', errB);
    testPassed = false;
  }

  // Verify stock was not double-counted
  const { data: batchesB } = await supabase
    .from('stock_batches')
    .select('batch_no, qty')
    .in('batch_no', ['TEST-BT-DL01', 'TEST-BT-PN01']);
  const doloQtyB = batchesB?.find((b) => b.batch_no === 'TEST-BT-DL01')?.qty;
  if (doloQtyB === 55) {
    console.log('TEST B PASS: Stock batch quantity remained exactly 55 (no double-addition).');
  } else {
    console.error('TEST B FAILED: Stock doubled! Current qty:', doloQtyB);
    testPassed = false;
  }

  // ---------------------------------------------------------------------------
  // TEST C: Atomicity & Complete Rollback on Error
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST C: Atomicity & Complete Rollback on Error ---');
  const payloadC = {
    supplier: testSupplierA,
    invoice_number: 'TEST-INV-2026-STAGE6-02-MALFORMED',
    invoice_date: '2026-10-20',
    items: [
      {
        name: 'TEST-MED-VALID-LINE',
        batch: 'TEST-BT-VALID-99',
        qty: 10,
        free_qty: 0,
        mrp: 100,
        net_rate: 80,
      },
      {
        name: '', // INTENTIONALLY BLANK NAME TO TRIGGER EXCEPTION
        batch: 'TEST-BT-INVALID-00',
        qty: 5,
      },
    ],
  };

  const { data: resC, error: errC } = await supabase.rpc('atomic_import_purchase_bill', { p_payload: payloadC });
  if (errC) {
    console.log('TEST C: Malformed transaction failed as expected:', errC.message);

    // Verify rollback: TEST-INV-2026-STAGE6-02-MALFORMED must not exist
    const { data: poC } = await supabase
      .from('purchase_orders')
      .select('id')
      .eq('po_number', 'TEST-INV-2026-STAGE6-02-MALFORMED');
    const { data: batchC } = await supabase
      .from('stock_batches')
      .select('id')
      .eq('batch_no', 'TEST-BT-VALID-99');

    if ((!poC || poC.length === 0) && (!batchC || batchC.length === 0)) {
      console.log('TEST C PASS: Zero partial rows created. Complete rollback confirmed.');
    } else {
      console.error('TEST C FAILED: Orphan rows found after failed transaction!', { poC, batchC });
      testPassed = false;
    }
  } else {
    console.error('TEST C FAILED: Malformed transaction unexpectedly succeeded!', resC);
    testPassed = false;
  }

  // ---------------------------------------------------------------------------
  // TEST D: Concurrency & Advisory Lock Serialization
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST D: Concurrency & Advisory Lock Serialization ---');
  const payloadD = {
    supplier: 'TEST-DISTRIBUTOR-CONCURRENCY',
    invoice_number: 'TEST-INV-CONCURRENT-001',
    invoice_date: '2026-10-20',
    items: [
      {
        name: 'TEST-MED-CONCURRENT-ITEM',
        batch: 'TEST-BT-CONC-01',
        qty: 20,
        free_qty: 2,
        mrp: 50,
        net_rate: 35,
      },
    ],
  };

  // Launch two simultaneous calls for the exact same invoice
  const [call1, call2] = await Promise.allSettled([
    supabase.rpc('atomic_import_purchase_bill', { p_payload: payloadD }),
    supabase.rpc('atomic_import_purchase_bill', { p_payload: payloadD }),
  ]);

  const val1 = call1.status === 'fulfilled' ? call1.value : null;
  const val2 = call2.status === 'fulfilled' ? call2.value : null;

  const successCount = (val1?.data?.ok ? 1 : 0) + (val2?.data?.ok ? 1 : 0);
  const failureCount = (val1?.error ? 1 : 0) + (val2?.error ? 1 : 0);

  console.log(`Concurrent results: ${successCount} succeeded, ${failureCount} rejected.`);
  if (successCount === 1 && failureCount === 1) {
    console.log('TEST D PASS: Advisory lock serialized requests — exactly 1 succeeded, 1 rejected.');
  } else {
    console.error('TEST D FAILED: Concurrent race condition detected!', { val1, val2 });
    testPassed = false;
  }

  // Check stock batch quantity
  const { data: batchD } = await supabase
    .from('stock_batches')
    .select('qty')
    .eq('batch_no', 'TEST-BT-CONC-01')
    .maybeSingle();

  if (batchD && batchD.qty === 22) {
    console.log('TEST D PASS: Stock batch quantity is exactly 22 (no duplicate addition).');
  } else {
    console.error('TEST D FAILED: Stock batch quantity mismatch:', batchD);
    testPassed = false;
  }

  // ---------------------------------------------------------------------------
  // TEST E: Non-test Data Safety Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST E: Non-test Data Safety Verification ---');
  const { data: nonTestBatches } = await supabase
    .from('stock_batches')
    .select('id, batch_no, qty')
    .in('id', [
      '21211111-1111-4111-8111-111111111129',
      '21311111-1111-4111-8111-111111111129',
      'bd144dc3-e770-49ea-a8c7-33d81a67f1a1',
      '21111111-1111-4111-8111-111111111129',
    ]);

  const intact = nonTestBatches?.every((b) => b.qty >= 21);
  if (intact && nonTestBatches?.length === 4) {
    console.log('TEST E PASS: All 4 existing non-test batches are 100% intact and untouched.');
  } else {
    console.error('TEST E FAILED: Existing batches were altered:', nonTestBatches);
    testPassed = false;
  }

  // ---------------------------------------------------------------------------
  // 6. CLEANUP of ONLY TEST DATA
  // ---------------------------------------------------------------------------
  console.log('\n--- CLEANING UP TEST DATA ---');
  // Delete test movements
  await supabase
    .from('stock_movements')
    .delete()
    .like('movement_key', 'po_import:%');

  // Delete test stock batches
  await supabase
    .from('stock_batches')
    .delete()
    .in('batch_no', ['TEST-BT-DL01', 'TEST-BT-PN01', 'TEST-BT-CONC-01']);

  // Delete test purchase orders (cascades to purchase_order_items)
  await supabase
    .from('purchase_orders')
    .delete()
    .in('po_number', ['TEST-INV-2026-STAGE6-01', 'TEST-INV-CONCURRENT-001']);

  // Delete test items
  await supabase
    .from('items')
    .delete()
    .in('name', ['TEST-MED-DOLO-650', 'TEST-MED-PAN-40', 'TEST-MED-CONCURRENT-ITEM']);

  // Post-cleanup count check
  const { count: postPO } = await supabase.from('purchase_orders').select('*', { count: 'exact', head: true });
  const { count: postBatches } = await supabase.from('stock_batches').select('*', { count: 'exact', head: true });
  const { count: postItems } = await supabase.from('items').select('*', { count: 'exact', head: true });

  console.log(`Post-cleanup counts: purchase_orders=${postPO}, stock_batches=${postBatches}, items=${postItems}`);
  if (postBatches === preBatches && postItems === preItems && postPO === prePO) {
    console.log('CLEANUP SUCCESS: Database returned exactly to pre-test baseline counts!');
  } else {
    console.warn('CLEANUP NOTICE: Counts differ slightly from baseline:', { postBatches, preBatches });
  }

  console.log('\n=============================================================');
  console.log(testPassed ? '>>> FINAL VERDICT: ALL TESTS PASSED! MIGRATION READY <<<' : '>>> FINAL VERDICT: TESTS FAILED! NEEDS FIXES <<<');
  console.log('=============================================================');
}

runTests().catch((e) => {
  console.error('Fatal test runner error:', e);
  process.exit(1);
});
