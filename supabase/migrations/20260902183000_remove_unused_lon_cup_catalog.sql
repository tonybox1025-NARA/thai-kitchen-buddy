DO $$
DECLARE
  lon_cup_category_id uuid;
  lon_cup_menu_ids uuid[];
BEGIN
  SELECT id
    INTO lon_cup_category_id
  FROM public.categories
  WHERE name_th = 'LON-CUP';

  IF lon_cup_category_id IS NULL THEN
    RAISE NOTICE 'LON-CUP category is already absent';
    RETURN;
  END IF;

  SELECT array_agg(id ORDER BY id)
    INTO lon_cup_menu_ids
  FROM public.menus
  WHERE category_id = lon_cup_category_id;

  IF coalesce(array_length(lon_cup_menu_ids, 1), 0) <> 15 THEN
    RAISE EXCEPTION 'Expected exactly 15 LON-CUP menus, found %', coalesce(array_length(lon_cup_menu_ids, 1), 0);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.menus
    WHERE id = ANY(lon_cup_menu_ids)
      AND manager_menu_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Refusing to delete a Manager-linked LON-CUP menu';
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_items WHERE menu_id = ANY(lon_cup_menu_ids))
    OR EXISTS (SELECT 1 FROM public.menu_addons WHERE menu_id = ANY(lon_cup_menu_ids))
    OR EXISTS (SELECT 1 FROM public.menu_ingredients WHERE menu_id = ANY(lon_cup_menu_ids)) THEN
    RAISE EXCEPTION 'Refusing to delete LON-CUP menus with dependent records';
  END IF;

  DELETE FROM public.menus
  WHERE id = ANY(lon_cup_menu_ids);

  DELETE FROM public.categories
  WHERE id = lon_cup_category_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.menus
      WHERE category_id = lon_cup_category_id
    );
END
$$;
