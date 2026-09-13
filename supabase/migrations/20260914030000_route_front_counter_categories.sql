DO $$
DECLARE
  front_zone_id uuid;
BEGIN
  SELECT id INTO front_zone_id
  FROM public.kitchen_zones
  WHERE active = true AND print_to_kitchen = false
  ORDER BY CASE WHEN lower(trim(name_en)) IN ('front', 'drinks') THEN 0 ELSE 1 END, sort, id
  LIMIT 1;

  IF front_zone_id IS NULL THEN
    RAISE EXCEPTION 'Active front counter zone not found';
  END IF;

  UPDATE public.categories
  SET kitchen_zone_id = front_zone_id
  WHERE lower(trim(name_en)) IN (
      'alcohol', 'alcoholic drinks',
      'cooked rice / porridge', 'cooked rice/porridge',
      'drink / ice cream', 'drink/ice cream', 'drinks',
      'drinks / ice cream', 'drinks/ice cream',
      'snack', 'snacks'
    )
    OR trim(name_th) IN (
      'ข้าวสวย/ข้าวต้ม', 'ของทานเล่น',
      'เครื่องดื่ม / ไอศกรีม', 'เครื่องดื่ม/ไอศกรีม', 'แอลกอฮอล์'
    );
END $$;
