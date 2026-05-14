-- 1) Auto-post completed bookings into the double-entry ledger.
drop trigger if exists trg_acct_autopost_hostly_booking on public.bookings;
create trigger trg_acct_autopost_hostly_booking
after insert or update of status on public.bookings
for each row
execute function public.acct_autopost_hostly_booking();

-- 2) Keep accounting entry_date in sync if the booking's stay dates change.
drop trigger if exists trg_acct_resync_booking_entry_date on public.bookings;
create trigger trg_acct_resync_booking_entry_date
after update of check_in_date, check_out_date on public.bookings
for each row
execute function public.acct_resync_booking_entry_date();

-- 3) Enforce debits = credits for every journal entry.
--    Use a CONSTRAINT trigger that fires AFTER the statement and is
--    DEFERRABLE INITIALLY DEFERRED, so a transaction may insert several
--    lines for the same entry and only the final balanced state is checked.
drop trigger if exists trg_acct_check_entry_balance on public.acct_journal_lines;
create constraint trigger trg_acct_check_entry_balance
after insert or update or delete on public.acct_journal_lines
deferrable initially deferred
for each row
execute function public.acct_check_entry_balance();
