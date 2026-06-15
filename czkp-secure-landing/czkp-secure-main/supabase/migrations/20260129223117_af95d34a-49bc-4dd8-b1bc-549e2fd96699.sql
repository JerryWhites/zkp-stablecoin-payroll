-- Create quotes table for storing quote requests from landing page
CREATE TABLE public.quotes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company_size TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert quotes (public form)
CREATE POLICY "Anyone can submit a quote request"
ON public.quotes
FOR INSERT
WITH CHECK (true);

-- Only authenticated users can view quotes (for admin purposes later)
CREATE POLICY "Authenticated users can view quotes"
ON public.quotes
FOR SELECT
TO authenticated
USING (true);