import { createClient } from '@supabase/supabase-js';

const url = process.env.VHC_TEST_SUPABASE_URL;
const key = process.env.VHC_TEST_SUPABASE_ANON_KEY;
const email = process.env.VHC_TEST_QA_EMAIL;
const password = process.env.VHC_TEST_QA_PASSWORD;

console.log('=== VHC MOBILE v1.4.5: STAGE 7 APP-LEVEL STAGING VALIDATION ===');
console.log('Staging URL:', url);

// Strict safety check: Never run against production
if (!url || !url.includes('dvscemgqegmfmgrtytal') || url.includes('yrgtnhvnwkqudxdcrkhm')) {
  console.error('FATAL SAFETY VIOLATION: URL is not the staging project dvscemgqegmfmgrtytal! Aborting.');
  process.exit(1);
}

const supabase = createClient(url, key);

async function runStage7AppTests() {
  // 1. Authenticate with staging QA user
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr || !authData?.user) {
    console.error('Authentication to staging failed:', authErr);
    process.exit(1);
  }
  console.log('Authenticated as Staging User:', authData.user.email);

  // Capture pre-test counts
  const { count: prePO } = await supabase.from('purchase_orders').select('*', { count: 'exact', head: true });
  const { count: preBatches } = await supabase.from('stock_batches').select('*', { count: 'exact', head: true });
  const { count: preItems } = await supabase.from('items').select('*', { count: 'exact', head: true });
  const { count: preMovements } = await supabase.from('stock_movements').select('*', { count: 'exact', head: true });

  console.log('\n--- PRE-TEST BASELINE ---');
  console.log(`purchase_orders: ${prePO || 0}`);
  console.log(`stock_batches:   ${preBatches || 0}`);
  console.log(`items:           ${preItems || 0}`);
  console.log(`stock_movements: ${preMovements || 0}`);

  // Resolve warehouse main location
  const { data: mainLoc, error: locErr } = await supabase
    .from('locations')
    .select('id, name')
    .eq('type', 'warehouse_main')
    .limit(1)
    .single();

  if (locErr || !mainLoc) {
    console.error('Failed to resolve warehouse main location:', locErr);
    process.exit(1);
  }
  const mainId = mainLoc.id;
  console.log(`Resolved Warehouse Main Location: ${mainLoc.name} (${mainId})`);

  // App-level implementation mimicking WarehouseContext.jsx importPurchaseBill
  async function appImportPurchaseBill({ header, items, useRpc = false }) {
    if (!header?.supplierName || !header?.invoiceNumber) {
      throw new Error('Supplier name and invoice number are required.');
    }
    if (!items || items.length === 0) {
      throw new Error('No items to import in this bill.');
    }

    const supplier = header.supplierName.trim();
    const invoiceNumber = header.invoiceNumber.trim();
    const invoiceDate = header.invoiceDate || new Date().toISOString().split('T')[0];

    // Check for duplicate invoice
    const { data: existingPO, error: poCheckErr } = await supabase
      .from('purchase_orders')
      .select('id, po_number, status')
      .ilike('po_number', invoiceNumber)
      .ilike('supplier', supplier)
      .eq('status', 'Received')
      .limit(1)
      .maybeSingle();

    if (poCheckErr) throw poCheckErr;
    if (existingPO) {
      throw new Error(`Invoice "${invoiceNumber}" from "${supplier}" has already been imported.`);
    }

    if (useRpc) {
      const payload = {
        supplier,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        notes: 'Imported via VHC Mobile Bill Scanner (Stage 7 RPC)',
        items: items.map((i) => ({
          name: i.name,
          batch: i.batch,
          expiry: i.expiry,
          qty: i.qty,
          free_qty: i.freeQty || 0,
          units_per_pack: i.unitsPerPack || 10,
          mrp: i.mrp || 0,
          net_rate: i.ptr || 0,
          gst: i.gst || 12,
        })),
      };
      const { data, error } = await supabase.rpc('atomic_import_purchase_bill', { p_payload: payload });
      if (error) throw error;
      return {
        ok: data?.ok ?? true,
        purchaseOrderId: data?.purchase_order_id,
        invoiceNumber: data?.invoice_number || invoiceNumber,
        supplier: data?.supplier || supplier,
        itemsCount: data?.items_count ?? items.length,
        totalStripsAdded: data?.total_strips_added ?? 0,
        grandTotal: data?.grand_total ?? 0,
        ...data,
      };
    }

    // Sequential fallback implementation
    let subtotal = 0;
    let gstTotal = 0;
    let grandTotal = 0;
    let totalStripsAdded = 0;

    for (const line of items) {
      const billedQty = Math.max(0, Number(line.qty) || 0);
      const freeQty = Math.max(0, Number(line.freeQty) || 0);
      const totalItemStrips = billedQty + freeQty;
      const ptr = Math.max(0, Number(line.ptr) || 0);
      const gst = Math.max(0, Number(line.gst) || 12);
      const taxable = billedQty * ptr;
      const gstAmt = taxable * (gst / 100);

      subtotal += taxable;
      gstTotal += gstAmt;
      grandTotal += (taxable + gstAmt);
      totalStripsAdded += totalItemStrips;
    }

    // 1. Create Purchase Order header
    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .insert({
        po_number: invoiceNumber,
        supplier,
        status: 'Received',
        po_date: invoiceDate,
        received_at: new Date().toISOString(),
        subtotal: Math.round(subtotal * 100) / 100,
        gst_total: Math.round(gstTotal * 100) / 100,
        total_amount: Math.round(grandTotal * 100) / 100,
        notes: 'Imported via VHC Mobile Bill Scanner (Stage 7 Fallback)',
      })
      .select('id')
      .single();

    if (poErr) throw poErr;

    // 2. Process each item
    for (const line of items) {
      const trimmed = (line.name || '').trim();
      if (!trimmed) continue;

      // Find or create item
      let itemId;
      const { data: existingItem } = await supabase.from('items').select('id').ilike('name', trimmed).limit(1).maybeSingle();
      if (existingItem) {
        itemId = existingItem.id;
      } else {
        const { data: newItem, error: newErr } = await supabase.from('items').insert({
          name: trimmed,
          category: 'Medicines',
          units_per_pack: line.unitsPerPack || 10,
        }).select('id').single();
        if (newErr) throw newErr;
        itemId = newItem.id;
      }

      const billedQty = Math.max(0, Number(line.qty) || 0);
      const freeQty = Math.max(0, Number(line.freeQty) || 0);
      const totalItemStrips = billedQty + freeQty;
      const batchNo = line.batch ? line.batch.trim() : null;
      const expiry = line.expiry ? line.expiry.trim() : null;
      const mrp = Math.max(0, Number(line.mrp) || 0);
      const ptr = Math.max(0, Number(line.ptr) || 0);
      const gst = Math.max(0, Number(line.gst) || 12);

      // Record PO item line
      await supabase.from('purchase_order_items').insert({
        purchase_order_id: po.id,
        item_id: itemId,
        name: trimmed,
        batch_no: batchNo,
        expiry_date: expiry,
        qty: totalItemStrips,
        mrp,
        net_rate: ptr,
        gst,
        units_per_pack: line.unitsPerPack || 10,
      });

      // Find existing batch
      const { data: existingBatch } = await supabase
        .from('stock_batches')
        .select('id, qty')
        .eq('item_id', itemId)
        .eq('location_id', mainId)
        .eq('batch_no', batchNo)
        .maybeSingle();

      let opening = 0;
      let closing = totalItemStrips;

      if (existingBatch) {
        opening = existingBatch.qty || 0;
        closing = opening + totalItemStrips;
        await supabase.from('stock_batches').update({ qty: closing }).eq('id', existingBatch.id);
      } else {
        await supabase.from('stock_batches').insert({
          item_id: itemId,
          location_id: mainId,
          batch_no: batchNo,
          expiry_date: expiry,
          net_rate: ptr,
          mrp,
          gst,
          stockist: supplier,
          qty: totalItemStrips,
        });
      }

      await supabase.from('stock_movements').insert({
        item_id: itemId,
        location_id: mainId,
        batch_no: batchNo,
        type: 'PURCHASE',
        qty: totalItemStrips,
        opening,
        closing,
        reason: `Bill Import: ${invoiceNumber} (${supplier})`,
      });
    }

    return {
      ok: true,
      purchaseOrderId: po.id,
      invoiceNumber,
      supplier,
      itemsCount: items.length,
      totalStripsAdded,
      total_strips_added: totalStripsAdded,
      grandTotal: Math.round(grandTotal * 100) / 100,
    };
  }

  let allTestsPassed = true;

  // ---------------------------------------------------------------------------
  // TEST 1: Sequential Fallback Import (when RPC flag is disabled)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 1: Sequential Fallback Path (useRpc = false) ---');
  const header1 = {
    supplierName: 'TEST-SUPPLIER-FALLBACK-STAGE7',
    invoiceNumber: 'TEST-INV-FB-001',
    invoiceDate: '2026-10-21',
  };
  const items1 = [
    {
      name: 'TEST-APP-MED-AZITHRAL-500',
      batch: 'TEST-BT-AZ01',
      expiry: '2028-06-01',
      qty: 25,
      freeQty: 2, // 25 + 2 = 27 strips
      unitsPerPack: 5,
      ptr: 95.0,
      mrp: 132.0,
      gst: 12,
    },
    {
      name: 'TEST-APP-MED-METFORMIN-500',
      batch: 'TEST-BT-MF01',
      expiry: '2028-12-01',
      qty: 60,
      freeQty: 0, // 60 strips
      unitsPerPack: 20,
      ptr: 31.0,
      mrp: 45.0,
      gst: 12,
    },
  ];

  try {
    const res1 = await appImportPurchaseBill({ header: header1, items: items1, useRpc: false });
    console.log('Test 1 Result:', res1);

    if (res1.ok && res1.totalStripsAdded === 87 && res1.itemsCount === 2) {
      console.log('TEST 1 PASS: Sequential fallback imported 87 strips across 2 medicines.');
    } else {
      console.error('TEST 1 FAILED: Unexpected fallback response structure.', res1);
      allTestsPassed = false;
    }

    // Verify stock_batches in DB
    const { data: batches1 } = await supabase
      .from('stock_batches')
      .select('batch_no, qty')
      .in('batch_no', ['TEST-BT-AZ01', 'TEST-BT-MF01']);

    const azBatch = batches1?.find((b) => b.batch_no === 'TEST-BT-AZ01');
    const mfBatch = batches1?.find((b) => b.batch_no === 'TEST-BT-MF01');

    if (azBatch?.qty === 27 && mfBatch?.qty === 60) {
      console.log('TEST 1 PASS: Stock batches correctly created with 27 and 60 strips.');
    } else {
      console.error('TEST 1 FAILED: Stock batch quantities incorrect:', batches1);
      allTestsPassed = false;
    }
  } catch (err) {
    console.error('TEST 1 FAILED with exception:', err);
    allTestsPassed = false;
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Atomic RPC Path (useRpc = true) Normal Import with Free Schemes
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 2: Atomic RPC Path (useRpc = true) Normal Import ---');
  const header2 = {
    supplierName: 'TEST-SUPPLIER-RPC-STAGE7',
    invoiceNumber: 'TEST-INV-RPC-001',
    invoiceDate: '2026-10-21',
  };
  const items2 = [
    {
      name: 'TEST-APP-MED-TELMA-40',
      batch: 'TEST-BT-TM01',
      expiry: '2028-03-01',
      qty: 40,
      freeQty: 4, // 40 + 4 = 44 strips
      unitsPerPack: 15,
      ptr: 175.0,
      mrp: 240.0,
      gst: 12,
    },
    {
      name: 'TEST-APP-MED-CETIRIZINE-10',
      batch: 'TEST-BT-CT01',
      expiry: '2028-04-01',
      qty: 50,
      freeQty: 5, // 50 + 5 = 55 strips
      unitsPerPack: 10,
      ptr: 14.5,
      mrp: 22.0,
      gst: 12,
    },
  ];

  try {
    const res2 = await appImportPurchaseBill({ header: header2, items: items2, useRpc: true });
    console.log('Test 2 Result:', res2);

    if (res2.ok && res2.totalStripsAdded === 99 && res2.itemsCount === 2) {
      console.log('TEST 2 PASS: Atomic RPC imported 99 strips across 2 medicines.');
    } else {
      console.error('TEST 2 FAILED: Unexpected RPC response structure.', res2);
      allTestsPassed = false;
    }

    // Verify stock_batches in DB
    const { data: batches2 } = await supabase
      .from('stock_batches')
      .select('batch_no, qty')
      .in('batch_no', ['TEST-BT-TM01', 'TEST-BT-CT01']);

    const tmBatch = batches2?.find((b) => b.batch_no === 'TEST-BT-TM01');
    const ctBatch = batches2?.find((b) => b.batch_no === 'TEST-BT-CT01');

    if (tmBatch?.qty === 44 && ctBatch?.qty === 55) {
      console.log('TEST 2 PASS: Stock batches correctly created with 44 and 55 strips.');
    } else {
      console.error('TEST 2 FAILED: Stock batch quantities incorrect:', batches2);
      allTestsPassed = false;
    }
  } catch (err) {
    console.error('TEST 2 FAILED with exception:', err);
    allTestsPassed = false;
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Duplicate Supplier + Invoice Rejection
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 3: Duplicate Supplier/Invoice Rejection ---');
  try {
    await appImportPurchaseBill({ header: header2, items: items2, useRpc: true });
    console.error('TEST 3 FAILED: Duplicate submission did not throw an error!');
    allTestsPassed = false;
  } catch (dupErr) {
    if (dupErr.message.includes('already been imported')) {
      console.log('TEST 3 PASS: Duplicate rejected with expected message:', dupErr.message);
    } else {
      console.error('TEST 3 FAILED with unexpected error:', dupErr);
      allTestsPassed = false;
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Invalid Item Handling without Partial Writes (Atomic Rollback)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 4: Atomic Rollback on Malformed Item ---');
  const header4 = {
    supplierName: 'TEST-SUPPLIER-RPC-STAGE7',
    invoiceNumber: 'TEST-INV-ROLLBACK-001',
    invoiceDate: '2026-10-21',
  };
  const items4 = [
    {
      name: 'TEST-APP-MED-GOOD-LINE',
      batch: 'TEST-BT-GOOD-01',
      qty: 15,
      freeQty: 0,
      ptr: 50.0,
      mrp: 75.0,
    },
    {
      name: '', // INVALID: Blank name
      batch: 'TEST-BT-BAD-01',
      qty: 10,
    },
  ];

  try {
    await appImportPurchaseBill({ header: header4, items: items4, useRpc: true });
    console.error('TEST 4 FAILED: Malformed item was accepted!');
    allTestsPassed = false;
  } catch (err4) {
    console.log('TEST 4: Malformed item caused expected exception:', err4.message);

    // Verify 0 partial records in purchase_orders and stock_batches
    const { data: po4 } = await supabase.from('purchase_orders').select('id').eq('po_number', 'TEST-INV-ROLLBACK-001');
    const { data: batch4 } = await supabase.from('stock_batches').select('id').eq('batch_no', 'TEST-BT-GOOD-01');

    if ((!po4 || po4.length === 0) && (!batch4 || batch4.length === 0)) {
      console.log('TEST 4 PASS: Zero partial writes in DB. Rollback verified.');
    } else {
      console.error('TEST 4 FAILED: Partial writes leaked into database!', { po4, batch4 });
      allTestsPassed = false;
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Network Error & Unauthenticated Access Handling
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 5: Unauthenticated Access Rejection ---');
  const unauthClient = createClient(url, key); // No user sign-in
  const { error: unauthErr } = await unauthClient.rpc('atomic_import_purchase_bill', {
    p_payload: { supplier: 'X', invoice_number: 'Y', items: [{ name: 'A', qty: 1 }] },
  });

  if (unauthErr && (unauthErr.message.includes('Authentication required') || unauthErr.code === '42501' || unauthErr.message.includes('permission denied'))) {
    console.log('TEST 5 PASS: Unauthenticated caller rejected by RPC permission checks:', unauthErr.message);
  } else {
    console.error('TEST 5 FAILED: Unauthenticated call was not blocked:', unauthErr);
    allTestsPassed = false;
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Stock & Movement Records Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 6: Stock & Movement Records Reconciliation ---');
  const { data: testMovements } = await supabase
    .from('stock_movements')
    .select('id, batch_no, qty, type, reason')
    .in('batch_no', ['TEST-BT-AZ01', 'TEST-BT-MF01', 'TEST-BT-TM01', 'TEST-BT-CT01']);

  console.log(`Found ${testMovements?.length} movement ledger entries for test batches.`);
  if (testMovements?.length === 4) {
    const allValid = testMovements.every((m) => m.type === 'PURCHASE' || m.type === 'PURCHASE_RECEIPT');
    if (allValid) {
      console.log('TEST 6 PASS: All 4 movement ledger entries properly record purchase receipts.');
    } else {
      console.error('TEST 6 FAILED: Movement entries have invalid types:', testMovements);
      allTestsPassed = false;
    }
  } else {
    console.error('TEST 6 FAILED: Expected 4 movement records, found:', testMovements?.length);
    allTestsPassed = false;
  }

  // ---------------------------------------------------------------------------
  // CLEANUP of all Stage 7 test data
  // ---------------------------------------------------------------------------
  console.log('\n--- CLEANING UP STAGE 7 TEST DATA ---');
  await supabase.from('stock_movements').delete().in('batch_no', [
    'TEST-BT-AZ01', 'TEST-BT-MF01', 'TEST-BT-TM01', 'TEST-BT-CT01',
  ]);

  await supabase.from('stock_batches').delete().in('batch_no', [
    'TEST-BT-AZ01', 'TEST-BT-MF01', 'TEST-BT-TM01', 'TEST-BT-CT01',
  ]);

  await supabase.from('purchase_orders').delete().in('po_number', [
    'TEST-INV-FB-001', 'TEST-INV-RPC-001',
  ]);

  await supabase.from('items').delete().in('name', [
    'TEST-APP-MED-AZITHRAL-500', 'TEST-APP-MED-METFORMIN-500', 'TEST-APP-MED-TELMA-40', 'TEST-APP-MED-CETIRIZINE-10',
  ]);

  // Capture post-cleanup counts
  const { count: postPO } = await supabase.from('purchase_orders').select('*', { count: 'exact', head: true });
  const { count: postBatches } = await supabase.from('stock_batches').select('*', { count: 'exact', head: true });
  const { count: postItems } = await supabase.from('items').select('*', { count: 'exact', head: true });

  console.log(`Post-cleanup counts: purchase_orders=${postPO}, stock_batches=${postBatches}, items=${postItems}`);
  if (postBatches === preBatches && postItems === preItems && postPO === prePO) {
    console.log('CLEANUP SUCCESS: Staging database returned exactly to baseline!');
  } else {
    console.warn('CLEANUP NOTICE: Database counts differ slightly from baseline:', { postBatches, preBatches });
  }

  console.log('\n=============================================================');
  console.log(allTestsPassed ? '>>> FINAL VERDICT: ALL STAGE 7 APP-LEVEL TESTS PASSED! <<<' : '>>> FINAL VERDICT: STAGE 7 APP-LEVEL TESTS FAILED! <<<');
  console.log('=============================================================');
}

runStage7AppTests().catch((e) => {
  console.error('Fatal test runner error:', e);
  process.exit(1);
});
