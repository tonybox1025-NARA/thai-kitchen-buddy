-- Formal customer receipts for paid POS bills.
-- ABOUT TIME CO., LTD. is not VAT registered as of this migration, so these
-- records are deliberately restricted to ordinary receipts (not tax invoices).

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS legal_name_th text,
  ADD COLUMN IF NOT EXISTS legal_name_en text,
  ADD COLUMN IF NOT EXISTS business_tax_id text,
  ADD COLUMN IF NOT EXISTS business_branch_label text,
  ADD COLUMN IF NOT EXISTS business_branch_number text,
  ADD COLUMN IF NOT EXISTS vat_registered boolean NOT NULL DEFAULT false;

UPDATE public.settings
SET legal_name_th = 'บริษัท อะเบ้าท์ ไทม์ จำกัด',
    legal_name_en = 'ABOUT TIME CO., LTD.',
    address = '224/1 ถนนอุดมสุข แขวงบางนาเหนือ เขตบางนา กรุงเทพมหานคร 10260 ประเทศไทย',
    business_tax_id = '0105568081262',
    business_branch_label = 'Head Office / สำนักงานใหญ่',
    business_branch_number = '00000',
    vat_registered = false,
    updated_at = now()
WHERE id = 1;

CREATE TABLE IF NOT EXISTS public.receipt_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL UNIQUE REFERENCES public.bills(id) ON DELETE RESTRICT,
  receipt_number text NOT NULL UNIQUE,
  document_kind text NOT NULL DEFAULT 'receipt' CHECK (document_kind = 'receipt'),
  customer_type text NOT NULL DEFAULT 'individual' CHECK (customer_type IN ('individual', 'company')),
  customer_name text NOT NULL CHECK (length(btrim(customer_name)) > 0),
  customer_address text NOT NULL CHECK (length(btrim(customer_address)) > 0),
  customer_tax_id text,
  customer_branch_label text,
  customer_branch_number text,
  customer_email text,
  customer_phone text,
  seller_legal_name_th text NOT NULL,
  seller_legal_name_en text NOT NULL,
  seller_address text NOT NULL,
  seller_tax_id text NOT NULL,
  seller_branch_label text NOT NULL,
  seller_branch_number text NOT NULL,
  seller_vat_registered boolean NOT NULL DEFAULT false CHECK (seller_vat_registered = false),
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receipt_documents_receipt_number_search_idx
  ON public.receipt_documents(receipt_number text_pattern_ops);

ALTER TABLE public.receipt_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated manage receipt documents" ON public.receipt_documents;
CREATE POLICY "authenticated manage receipt documents"
  ON public.receipt_documents
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.receipt_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.receipt_documents TO authenticated;
GRANT ALL ON TABLE public.receipt_documents TO service_role;

COMMENT ON TABLE public.receipt_documents IS
  'Customer details and seller snapshot for ordinary receipts. Tax invoices are blocked until VAT registration is separately implemented.';
COMMENT ON COLUMN public.receipt_documents.receipt_number IS
  'The existing paid-bill LM receipt number; no second document sequence is created.';
