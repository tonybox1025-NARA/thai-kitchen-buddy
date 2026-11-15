-- Optional per-item "QR special price" for featured sections.
--
-- Purely additive: one nullable column on qr_featured_items. NULL = use the
-- menu's normal price (unchanged behaviour). A number = that price is shown and
-- charged on the PUBLIC QR menu only, while the menu is pinned in an ENABLED
-- featured section. It never touches menus.price, Manager-app prices, or staff
-- POS orders. Dropping the column restores the previous behaviour exactly.

alter table public.qr_featured_items
  add column if not exists price_override numeric;

comment on column public.qr_featured_items.price_override is
  'QR-only special price for this featured item; NULL means use menus.price. Never alters the base menu price or staff/POS pricing.';
