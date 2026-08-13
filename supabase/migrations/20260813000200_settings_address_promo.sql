-- Shop address + a promo/marketing line for the customer receipt header.
alter table settings
  add column if not exists address text,
  add column if not exists receipt_promo text;
