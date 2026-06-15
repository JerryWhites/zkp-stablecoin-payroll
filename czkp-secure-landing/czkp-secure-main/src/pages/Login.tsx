import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Shield, ArrowLeft, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { sanitizeAuthError } from "@/lib/authErrors";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().trim().email("Neplatná e-mailová adresa"),
  password: z.string().min(6, "Heslo musí mít alespoň 6 znaků"),
});

const Login = () => {
  const { signIn, user, loading } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = loginSchema.safeParse(formData);
    if (!result.success) {
      toast({
        title: "Chyba validace",
        description: result.error.errors[0]?.message,
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    const { error } = await signIn(
      formData.email.trim(),
      formData.password,
      needs2FA && totpCode.length === 6 ? totpCode : undefined
    );

    if (error) {
      if (error.message === '2FA_REQUIRED') {
        setNeeds2FA(true);
        setTotpCode("");
        toast({
          title: "Dvoufaktorové ověření",
          description: "Zadejte kód z autentizační aplikace.",
        });
      } else {
        toast({
          title: "Přihlášení se nezdařilo",
          description: sanitizeAuthError(error),
          variant: "destructive",
        });
      }
    } else {
      toast({
        title: "Vítejte zpět!",
        description: "Byli jste úspěšně přihlášeni.",
      });
    }

    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Panel - Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Back Link */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Zpět na úvod
          </Link>

          {/* Logo */}
          <div className="flex items-center gap-2 mb-8">
            <div className="w-10 h-10 bg-gradient-gold rounded-lg flex items-center justify-center">
              <Shield className="w-6 h-6 text-accent-foreground" />
            </div>
            <span className="font-display text-xl font-bold text-foreground">CZKP</span>
          </div>

          {/* Heading */}
          <h1 className="font-display text-3xl font-bold text-foreground mb-2">
            Vítejte zpět
          </h1>
          <p className="text-muted-foreground mb-8">
            Přihlaste se do svého mzdového systému
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                E-mail
              </label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="vas@email.cz"
                className="bg-muted/50 border-border"
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">
                Heslo
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  className="bg-muted/50 border-border pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* 2FA TOTP Input */}
            {needs2FA && (
              <div className="space-y-3 p-4 bg-muted/30 border border-border rounded-lg">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <KeyRound className="w-4 h-4 text-accent" />
                  Dvoufaktorové ověření
                </div>
                <p className="text-xs text-muted-foreground">
                  Zadejte 6místný kód z vaší autentizační aplikace (Google Authenticator, Authy apod.)
                </p>
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={totpCode}
                    onChange={(value) => setTotpCode(value)}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </div>
            )}

            <Button
              type="submit"
              disabled={isSubmitting || (needs2FA && totpCode.length !== 6)}
              className="w-full bg-gradient-gold text-accent-foreground hover:opacity-90 font-semibold py-5"
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Přihlašuji...</>
              ) : needs2FA ? "Ověřit a přihlásit" : "Přihlásit se"}
            </Button>
          </form>

          {/* Forgot Password */}
          <div className="text-center mt-4">
            <Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-accent transition-colors">
              Zapomněli jste heslo?
            </Link>
          </div>

          {/* Sign up link */}
          <p className="text-center text-muted-foreground mt-8">
            Nemáte účet?{" "}
            <Link to="/signup" className="text-accent hover:underline font-medium">
              Zaregistrovat se
            </Link>
          </p>
        </div>
      </div>

      {/* Right Panel - Visual */}
      <div className="hidden lg:flex flex-1 bg-card items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-primary/10 to-secondary/10" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
        
        <div className="relative z-10 text-center max-w-md">
          <Shield className="w-20 h-20 text-accent mx-auto mb-6" />
          <h2 className="font-display text-3xl font-bold text-foreground mb-4">
            Soukromí na prvním místě
          </h2>
          <p className="text-muted-foreground text-lg">
            Mzdový systém s zero-knowledge proofs. Vaše data zůstávají v bezpečí, vždy.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
