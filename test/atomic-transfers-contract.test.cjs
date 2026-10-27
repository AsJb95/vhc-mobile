#!/usr/bin/env node
/* global __dirname */
// =============================================================================
// Contract Verification Test for Atomic Stock Transfer Migration
// Migration: supabase/migrations/20261020000100_atomic_stock_transfers.sql
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log('  PASS  ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL  ' + name + ' — ' + e.message);
    failed++;
  }
}

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261020000100_atomic_stock_transfers.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

console.log('Running Atomic Stock Transfer Contract Tests...\n');

// 1. Transaction wrapping
check('migration is wrapped in an explicit transaction (begin ... commit)', () => {
  assert.match(sql, /^\s*begin;/m, 'must start with begin;');
  assert.match(sql, /commit;\s*$/m, 'must end with commit;');
});

// 2. Schema self-healing
check('schema self-healing: ensures transfer_orders audit columns exist', () => {
  assert.match(sql, /alter table public\.transfer_orders/i);
  assert.match(sql, /add column if not exists created_by\s+uuid/i);
  assert.match(sql, /add column if not exists approved_by\s+uuid/i);
  assert.match(sql, /add column if not exists approved_at\s+timestamptz/i);
  assert.match(sql, /add column if not exists cancelled_by\s+uuid/i);
  assert.match(sql, /add column if not exists cancelled_at\s+timestamptz/i);
});

// 3. Security Definer & search_path
check('security definer and fixed search_path = public are enforced on accept and reject', () => {
  const acceptFn = sql.slice(sql.indexOf('create or replace function public.accept_stock_transfer'), sql.indexOf('create or replace function public.reject_stock_transfer'));
  const rejectFn = sql.slice(sql.indexOf('create or replace function public.reject_stock_transfer'));

  assert.match(acceptFn, /security definer/i);
  assert.match(acceptFn, /set search_path = public/i);
  assert.match(rejectFn, /security definer/i);
  assert.match(rejectFn, /set search_path = public/i);
});

// 4. Role Authorization
check('strict authentication and role authorization checks exist inside functions', () => {
  assert.match(sql, /if auth\.uid\(\) is null then/i);
  assert.match(sql, /is_warehouse_writer\(\)/);
  assert.match(sql, /is_pharmacy_writer\(\)/);
});

// 5. Transfer Order Row Lock & Idempotency
check('transfer order is locked FOR UPDATE and checks idempotency before mutation', () => {
  assert.match(sql, /select \* into v_to from public\.transfer_orders where id = p_transfer_id for update;/i);
  assert.match(sql, /if v_to\.status = 'Completed' then/i);
  assert.match(sql, /'already_completed', true/);
  assert.match(sql, /if v_to\.status <> 'Pending' then/i);
});

// 6. Non-Negative Stock Deduction
check('source stock deduction uses conditional UPDATE (qty >= v_src_qty) preventing negative inventory', () => {
  assert.match(sql, /update public\.stock_batches\s+set qty = qty - v_src_qty\s+where id = v_src\.id and qty >= v_src_qty;/i);
  assert.match(sql, /if not found then\s+raise exception 'Concurrent stock modification/i);
});

// 7. Destination Batch Concurrency (Advisory Lock)
check('destination batch resolution uses pg_advisory_xact_lock to prevent duplicate batch creation', () => {
  assert.match(sql, /perform pg_advisory_xact_lock\(hashtext\('batch_dest:'/i);
});

// 8. Stock Movements Ledger & Idempotency Key
check('stock movements ledger records inward and outward rows with unique movement_key', () => {
  assert.match(sql, /v_out_mov_key := 'TRANSFER:OUT:'/);
  assert.match(sql, /v_in_mov_key\s*:= 'TRANSFER:IN:'/);
  assert.match(sql, /insert into public\.stock_movements/i);
  assert.match(sql, /on conflict \(movement_key\) do nothing;/i);
});

// 9. Grant & Revoke Safety
check('anonymous and public execute permissions are revoked; granted strictly to authenticated', () => {
  assert.match(sql, /revoke all on function public\.accept_stock_transfer\(uuid\) from public, anon;/i);
  assert.match(sql, /grant execute on function public\.accept_stock_transfer\(uuid\) to authenticated;/i);
  assert.match(sql, /revoke all on function public\.reject_stock_transfer\(uuid, text\) from public, anon;/i);
  assert.match(sql, /grant execute on function public\.reject_stock_transfer\(uuid, text\) to authenticated;/i);
});

// 10. RLS Policy Idempotency
check('destination pharmacy policy is dropped before create for idempotency', () => {
  assert.match(sql, /drop policy if exists "to_write_pharmacy_destination" on public\.transfer_orders;/i);
  assert.match(sql, /create policy "to_write_pharmacy_destination" on public\.transfer_orders/i);
});

console.log(`\nContract Verification Summary: ${passed} passed, ${failed} failed.`);

if (failed > 0) {
  process.exit(1);
}
