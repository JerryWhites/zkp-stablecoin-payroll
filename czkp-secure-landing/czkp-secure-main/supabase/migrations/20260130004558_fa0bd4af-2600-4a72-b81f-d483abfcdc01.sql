-- Fix RLS policy misconfiguration on quotes table
-- The issue: All policies are RESTRICTIVE, but RESTRICTIVE policies only act as additional filters
-- on top of PERMISSIVE policies. Without PERMISSIVE policies, access behavior is undefined.

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can delete quotes" ON public.quotes;
DROP POLICY IF EXISTS "Admins can update quotes" ON public.quotes;
DROP POLICY IF EXISTS "Admins can view all quotes" ON public.quotes;
DROP POLICY IF EXISTS "Anyone can submit a quote request" ON public.quotes;

-- Recreate as PERMISSIVE policies (default type)
-- SELECT: Only admins can view quotes
CREATE POLICY "Admins can view all quotes"
ON public.quotes
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- INSERT: Anyone can submit (protected by edge function rate limiting)
CREATE POLICY "Anyone can submit a quote request"
ON public.quotes
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- UPDATE: Only admins can update
CREATE POLICY "Admins can update quotes"
ON public.quotes
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- DELETE: Only admins can delete
CREATE POLICY "Admins can delete quotes"
ON public.quotes
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));