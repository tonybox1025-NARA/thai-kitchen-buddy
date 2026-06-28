ALTER TABLE public.kitchen_zones
  ADD COLUMN IF NOT EXISTS print_to_kitchen boolean NOT NULL DEFAULT true;

UPDATE public.kitchen_zones
SET print_to_kitchen = false
WHERE lower(name_en) IN ('drinks', 'drink', 'beverages', 'bar', 'alcohol')
  OR name_th ILIKE '%เครื่องดื่ม%'
  OR name_th ILIKE '%แอลกอฮอล์%';
