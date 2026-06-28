CREATE TABLE IF NOT EXISTS public.kitchen_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_th text NOT NULL,
  name_en text NOT NULL,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS kitchen_zone_id uuid REFERENCES public.kitchen_zones(id) ON DELETE SET NULL;

ALTER TABLE public.kitchen_zones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kitchen_zones'
      AND policyname = 'authenticated can manage kitchen_zones'
  ) THEN
    CREATE POLICY "authenticated can manage kitchen_zones"
      ON public.kitchen_zones
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

INSERT INTO public.kitchen_zones (name_th, name_en, sort)
VALUES
  ('เครื่องดื่มหน้าร้าน', 'Drinks', 10),
  ('อาหารหน้าร้าน', 'Main Kitchen', 20),
  ('Soup', 'Soup', 30),
  ('Salad/Somtum', 'Salad/Somtum', 40)
ON CONFLICT DO NOTHING;
