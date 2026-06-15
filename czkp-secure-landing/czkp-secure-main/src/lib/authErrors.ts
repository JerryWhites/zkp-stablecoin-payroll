/**
 * Sanitizes authentication error messages to prevent information disclosure.
 * Maps specific Supabase error messages to generic user-friendly messages.
 */
export const sanitizeAuthError = (error: Error): string => {
  const msg = error.message.toLowerCase();
  
  // Generic message for credential issues - prevents user enumeration
  if (msg.includes('invalid') || msg.includes('credentials') || 
      msg.includes('not found') || msg.includes('incorrect') ||
      msg.includes('user not found')) {
    return 'Invalid email or password. Please try again.';
  }
  
  // Email confirmation
  if (msg.includes('email not confirmed')) {
    return 'Please check your email and confirm your account to continue.';
  }
  
  // Already registered - generic to prevent enumeration
  if (msg.includes('already registered') || msg.includes('already exists')) {
    return 'Unable to create account. Please try logging in or use a different email.';
  }
  
  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Too many attempts. Please try again in a few minutes.';
  }

  // Password validation - show the actual requirement that failed
  if (msg.includes('password must be') || msg.includes('at least 12') || 
      msg.includes('uppercase') || msg.includes('lowercase') || 
      msg.includes('special character') || msg.includes('number')) {
    return error.message; // Show the specific password validation error
  }

  // Password too weak (generic)
  if (msg.includes('weak') || msg.includes('password')) {
    return 'Please choose a stronger password.';
  }

  // Network issues
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
    return 'Connection error. Please check your internet and try again.';
  }
  
  // Generic fallback - never expose raw error
  return 'Authentication failed. Please try again or contact support.';
};
