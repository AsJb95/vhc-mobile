-- Shared with Pharmacy POS. Requires the existing VHC schema and common auth.
-- No changes to original sales/payment_mode: collections are separate cashflow.
begin;
create table public.credit_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_mode text not null check (payment_mode in ('Cash','UPI','Card')),
  request_id text not null unique check (length(request_id) between 16 and 100),
  collected_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index credit_payments_sale on public.credit_payments(sale_id);
-- A settled bill must not be reassigned or reduced underneath its receipts.
create function public.protect_collected_credit_bill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.credit_payments where sale_id = old.id) and
     (new.total_amount is distinct from old.total_amount or
      new.payment_mode is distinct from old.payment_mode or
      new.patient_id is distinct from old.patient_id) then
    raise exception 'A bill with credit receipts requires an audited reversal before editing';
  end if;
  return new;
end;
$$;
create trigger protect_collected_credit_bill before update on public.sales
  for each row execute function public.protect_collected_credit_bill();
alter table public.credit_payments enable row level security;
create policy credit_payments_read on public.credit_payments for select to authenticated
  using (public.is_platform_admin() or public.current_role_name() = 'admin');
revoke all on public.credit_payments from anon, authenticated;
grant select on public.credit_payments to authenticated;

create function public.collect_credit_payment(
  p_sale_id uuid, p_amount numeric, p_payment_mode text, p_request_id text
) returns public.credit_payments
language plpgsql security definer set search_path = public
as $$
declare
  bill public.sales;
  existing public.credit_payments;
  paid numeric;
begin
  if auth.uid() is null or not coalesce(public.is_platform_admin() or public.current_role_name() = 'admin', false) then
    raise exception 'Only clinic or platform admins can collect credit';
  end if;
  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity') or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Invalid payment amount';
  end if;
  if p_payment_mode is null or p_payment_mode not in ('Cash','UPI','Card') or p_request_id is null or length(p_request_id) not between 16 and 100 then
    raise exception 'Invalid payment method or request';
  end if;
  -- Serializes concurrent devices, and also coordinates with POS bill deletion.
  select * into bill from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Bill no longer exists'; end if;
  select * into existing from public.credit_payments where request_id = p_request_id;
  if found then
    if existing.sale_id <> p_sale_id or existing.amount <> p_amount or existing.payment_mode <> p_payment_mode or existing.collected_by <> auth.uid() then
      raise exception 'Payment request was already used with different details';
    end if;
    return existing;
  end if;
  if lower(trim(coalesce(bill.payment_mode,''))) not in ('credit','khata','due') then
    raise exception 'Only credit bills can be repaid';
  end if;
  select coalesce(sum(amount),0) into paid from public.credit_payments where sale_id = p_sale_id;
  if bill.total_amount is null or p_amount > round(bill.total_amount - paid, 2) then
    raise exception 'Payment exceeds current outstanding balance; refresh the bill';
  end if;
  insert into public.credit_payments(sale_id, amount, payment_mode, request_id, collected_by)
    values (p_sale_id, p_amount, p_payment_mode, p_request_id, auth.uid()) returning * into existing;
  return existing;
end;
$$;
revoke all on function public.collect_credit_payment(uuid,numeric,text,text) from public, anon;
grant execute on function public.collect_credit_payment(uuid,numeric,text,text) to authenticated;
alter publication supabase_realtime add table public.credit_payments;
commit;
