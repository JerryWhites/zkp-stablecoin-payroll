import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// Simple in-memory rate limiter (resets on function cold start)
// For production, use Redis/Upstash for persistent rate limiting
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 3;

function checkRateLimit(identifier: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);
  
  if (!record || now > record.resetTime) {
    // Create new window
    rateLimitStore.set(identifier, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1, resetIn: RATE_LIMIT_WINDOW_MS };
  }
  
  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0, resetIn: record.resetTime - now };
  }
  
  record.count++;
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - record.count, resetIn: record.resetTime - now };
}

// Input validation
function validateInput(data: unknown): { valid: true; data: { companyName: string; email: string; companySize: string; message: string | null } } | { valid: false; error: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  
  const { companyName, email, companySize, message } = data as Record<string, unknown>;
  
  // Company name validation
  if (typeof companyName !== 'string' || companyName.trim().length === 0) {
    return { valid: false, error: 'Company name is required' };
  }
  if (companyName.trim().length > 100) {
    return { valid: false, error: 'Company name must be less than 100 characters' };
  }
  
  // Email validation
  if (typeof email !== 'string' || email.trim().length === 0) {
    return { valid: false, error: 'Email is required' };
  }
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(email.trim())) {
    return { valid: false, error: 'Invalid email address' };
  }
  if (email.trim().length > 255) {
    return { valid: false, error: 'Email must be less than 255 characters' };
  }
  
  // Company size validation
  const validSizes = ['1-10', '11-50', '51-200', '201-500', '500+'];
  if (typeof companySize !== 'string' || !validSizes.includes(companySize)) {
    return { valid: false, error: 'Invalid company size' };
  }
  
  // Message validation (optional)
  let sanitizedMessage: string | null = null;
  if (message !== undefined && message !== null && message !== '') {
    if (typeof message !== 'string') {
      return { valid: false, error: 'Message must be a string' };
    }
    if (message.trim().length > 1000) {
      return { valid: false, error: 'Message must be less than 1000 characters' };
    }
    sanitizedMessage = message.trim();
  }
  
  return {
    valid: true,
    data: {
      companyName: companyName.trim(),
      email: email.trim().toLowerCase(),
      companySize,
      message: sanitizedMessage
    }
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Get client identifier for rate limiting (IP or fallback)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || req.headers.get('x-real-ip') 
      || 'unknown';
    
    // Check rate limit
    const rateLimitResult = checkRateLimit(clientIp);
    
    if (!rateLimitResult.allowed) {
      const resetMinutes = Math.ceil(rateLimitResult.resetIn / 60000);
      return new Response(
        JSON.stringify({ 
          error: `Rate limit exceeded. Please try again in ${resetMinutes} minutes.` 
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(rateLimitResult.resetIn / 1000))
          } 
        }
      );
    }

    // Parse and validate input
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const validation = validateInput(body);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role key to bypass RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Insert quote
    const { error: insertError } = await supabase
      .from('quotes')
      .insert({
        company_name: validation.data.companyName,
        email: validation.data.email,
        company_size: validation.data.companySize,
        message: validation.data.message
      });

    if (insertError) {
      console.error('Database insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to submit quote. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Quote submitted successfully',
        remaining: rateLimitResult.remaining
      }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': String(rateLimitResult.remaining)
        } 
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
