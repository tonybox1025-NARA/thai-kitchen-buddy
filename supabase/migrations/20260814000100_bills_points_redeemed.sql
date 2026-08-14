-- Points a member spent on this bill (1 point = 1 THB discount). Deducted from
-- their balance at checkout and recorded in member_point_ledger.
alter table bills
  add column if not exists points_redeemed integer not null default 0;
