-- Fix 1: PUBLIC_DATA_EXPOSURE - Restrict quote access to admins only
-- First, create the role infrastructure

-- Create app_role enum if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
  END IF;
END $$;

-- Create user_roles table for role management
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Create security definer function to check roles (prevents recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Drop the overly permissive SELECT policy on quotes
DROP POLICY IF EXISTS "Authenticated users can view quotes" ON public.quotes;

-- Create admin-only policy for viewing quotes
CREATE POLICY "Admins can view all quotes"
ON public.quotes
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Fix 2: INPUT_VALIDATION - Add database constraints for server-side validation
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_company_name_length_check CHECK (length(company_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT quotes_email_format_check CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  ADD CONSTRAINT quotes_email_length_check CHECK (length(email) <= 255),
  ADD CONSTRAINT quotes_company_size_valid_check CHECK (company_size IN ('1-10', '11-50', '51-200', '201-500', '500+')),
  ADD CONSTRAINT quotes_message_length_check CHECK (message IS NULL OR length(message) <= 1000);