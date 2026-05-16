ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS proof_of_delivery_image_data TEXT,
ADD COLUMN IF NOT EXISTS proof_of_delivery_uploaded_at TIMESTAMPTZ;
