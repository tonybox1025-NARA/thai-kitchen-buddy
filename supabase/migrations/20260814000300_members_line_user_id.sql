-- LINE identity for a member (from LIFF login). Lets a customer's wallet follow
-- them across devices and enables OA-based birthday/promo messaging later.
alter table members add column if not exists line_user_id text;

-- One member per LINE user (multiple NULLs allowed via the partial index).
create unique index if not exists members_line_user_id_key
  on members (line_user_id) where line_user_id is not null;
