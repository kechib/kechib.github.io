-- ==========================================================================
-- Ingressible — Public Reference Uniqueness
-- Add UNIQUE constraint on public_reference with collision handling
-- ==========================================================================

-- Check for existing duplicates first (this will fail if duplicates exist)
DO $$
DECLARE
  dup_count int;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT public_reference
    FROM public.consultation_submissions
    GROUP BY public_reference
    HAVING COUNT(*) > 1
  ) dup;
  
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot add UNIQUE constraint: % duplicate public_reference values exist', dup_count;
  END IF;
END $$;

-- Add UNIQUE constraint on public_reference
ALTER TABLE public.consultation_submissions
  ADD CONSTRAINT consultation_submissions_public_reference_key
  UNIQUE (public_reference);