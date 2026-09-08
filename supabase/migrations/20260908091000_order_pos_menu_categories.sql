UPDATE public.categories
SET sort = CASE
  WHEN id = 'd786c70f-e3eb-4b88-a82f-ad6c12028f54' THEN 10  -- Set menu
  WHEN id = '24fb69e4-1b9d-41ea-b609-26f49fb921e9' THEN 20  -- Stir-fry
  WHEN id = '10439056-6450-4276-8393-c91909d6bc42' THEN 30  -- Rice dishes
  WHEN id = '747ba159-f4e6-4f25-9c07-10664ca340d6' THEN 40  -- Soup
  WHEN id = '306e9fe3-c781-425d-b402-dadcc67f0c8f' THEN 50  -- Fried
  WHEN id = 'ef231309-e3f6-4574-a07f-43c5767403fe' THEN 60  -- Salad / somtum
  WHEN id = '59e6e451-994a-4293-a313-e59e8e107d01' THEN 70  -- Meat & Seafood
  WHEN id = 'f2b475d5-78f5-4bc0-940f-0b2bcb9df43a' THEN 80  -- Mookata
  WHEN id = 'fdb7fca2-b2c2-44a9-82ac-74448575c9b6' THEN 90  -- Rice / porridge
  WHEN id = 'b177544e-db6a-4ed2-86b4-78674e4e40e2' THEN 100 -- Snacks
  WHEN id = '7a73b072-789e-49b4-a061-e42a92ae5b3a' THEN 110 -- Drinks / ice cream
  WHEN id = 'ec4b9304-7672-4d83-8e4a-d8fd6240345e' THEN 120 -- Alcohol
  WHEN id = '59fdba25-1e80-4c80-b1fb-24cd5b9b20e5' THEN 130 -- Promotions
  WHEN id = 'e1c6f3c1-0c1c-4bb0-ad5d-034ca0d0cf98' THEN 140 -- General
  WHEN id = 'd95561e7-c21b-4413-a81c-6053f1982cfe' THEN 150 -- Add-on
  ELSE sort
END
WHERE id IN (
  'd786c70f-e3eb-4b88-a82f-ad6c12028f54',
  '24fb69e4-1b9d-41ea-b609-26f49fb921e9',
  '10439056-6450-4276-8393-c91909d6bc42',
  '747ba159-f4e6-4f25-9c07-10664ca340d6',
  '306e9fe3-c781-425d-b402-dadcc67f0c8f',
  'ef231309-e3f6-4574-a07f-43c5767403fe',
  '59e6e451-994a-4293-a313-e59e8e107d01',
  'f2b475d5-78f5-4bc0-940f-0b2bcb9df43a',
  'fdb7fca2-b2c2-44a9-82ac-74448575c9b6',
  'b177544e-db6a-4ed2-86b4-78674e4e40e2',
  '7a73b072-789e-49b4-a061-e42a92ae5b3a',
  'ec4b9304-7672-4d83-8e4a-d8fd6240345e',
  '59fdba25-1e80-4c80-b1fb-24cd5b9b20e5',
  'e1c6f3c1-0c1c-4bb0-ad5d-034ca0d0cf98',
  'd95561e7-c21b-4413-a81c-6053f1982cfe'
);
