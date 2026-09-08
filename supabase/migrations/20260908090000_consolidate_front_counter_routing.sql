DO $$
DECLARE
  main_kitchen_id uuid;
  front_zone_id uuid;
BEGIN
  SELECT id
  INTO main_kitchen_id
  FROM public.kitchen_zones
  WHERE active = true
    AND print_to_kitchen = true
    AND (lower(trim(name_en)) = 'main kitchen' OR name_th = 'อาหารหน้าร้าน')
  ORDER BY sort, id
  LIMIT 1;

  IF main_kitchen_id IS NULL THEN
    RAISE EXCEPTION 'Active Main Kitchen zone not found';
  END IF;

  SELECT id
  INTO front_zone_id
  FROM public.kitchen_zones
  WHERE active = true
    AND print_to_kitchen = false
  ORDER BY
    CASE WHEN lower(trim(name_en)) = 'drinks' THEN 0 ELSE 1 END,
    sort,
    id
  LIMIT 1;

  IF front_zone_id IS NULL THEN
    RAISE EXCEPTION 'Active front zone not found';
  END IF;

  UPDATE public.categories
  SET kitchen_zone_id = main_kitchen_id
  WHERE lower(trim(name_en)) = 'meat & seafood'
     OR lower(trim(name_th)) = 'meat & seafood';

  UPDATE public.categories
  SET kitchen_zone_id = front_zone_id
  WHERE trim(name_th) = 'ของทานเล่น'
     OR lower(trim(name_en)) IN ('snack', 'snacks');
END $$;
