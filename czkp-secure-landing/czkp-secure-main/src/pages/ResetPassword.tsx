// ====================================
// 🔑 Reset Password Page — Set new password using token from URL
// ====================================

import { useState, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, ArrowLeft, Eye, EyeOff, CheckCircle, Loader2, Check, X as XIcon } from "lucide-react";
import { z } from "zod";
import { apiClient } from "@/lib/api-client";

const passwordSchema = z.string()
  .min(12, "Heslo musí mít alespoň 12 znaků")
  .max(72, "Heslo nesmí přesáhnout 72 znaků")
  .regex(/[a-z]/, "Heslo musí obsahovat malé písmeno")
  .regex(/[A-Z]/, "Heslo musí obsahovat velké písmeno")
  .regex(/[0-9]/, "Heslo musí obsahovat číslici")
  .regex(/[^A-Za-z0-9\s]/, "Heslo musí obsahovat speciální znak");

const PASSWORD_RULES = [
  { label: "Alespoň 12 znaků", test: (p: string) => p.length >= 12 },
  { label: "Velké písmeno", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Malé písmeno", test: (p: string) => /[a-z]/.test(p) },
  { label: "Číslice", test: (p: string) => /[0-9]/.test(p) },
  { label: "Speciální znak (!@#...)", test: (p: string) => /[^A-Za-z0-9\s]/.test(p) },
];

const ResetPassword = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);

  const passwordStrength = useMemo(() => {
    return PASSWORD_RULES.map(r => ({ ...r, passed: r.test(password) }));
  }, [password]);
  const allPasswordRulesPassed = passwordStrength.every(r => r.passed);

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="w-full max-w-md text-center">
          <div className="flex items-center gap-2 justify-center mb-8">
            <div className="w-10 h-10 bg-gradient-gold rounded-lg flex items-center justify-center">
              <Shield className="w-6 h-6 text-accent-foreground" />
            </div>
            <span className="font-display text-xl font-bold text-foreground">CZKP</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground mb-3">
            Neplatný odkaz
          </h1>
          <p className="text-muted-foreground mb-6">
            Odkaz pro obnovení hesla je neplatný nebo chybí token. Požádejte o nový odkaz.
          </p>
          <Link to="/forgot-password">
            <Button>Požádat o nový odkaz</Button>
          </Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      toast({
        title: "Chyba validace",
        description: result.error.errors[0]?.message,
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Chyba",
        description: "Hesla se neshodují",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await apiClient.authenticatedFetch('/auth/reset-password', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setResetComplete(true);
      } else {
        toast({
          title: "Chyba",
          description: data.error || "Nepodařilo se obnovit heslo",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Chyba",
        description: "Chyba při komunikaci se serverem",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="w-full max-w-md">
        {/* Back Link */}
        <Link
          to="/login"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Zpět na přihlášení
        </Link>

        {/* Logo */}
        <div className="flex items-center gap-2 mb-8">
          <div className="w-10 h-10 bg-gradient-gold rounded-lg flex items-center justify-center">
            <Shield className="w-6 h-6 text-accent-foreground" />
          </div>
          <span className="font-display text-xl font-bold text-foreground">CZKP</span>
        </div>

        {resetComplete ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h1 className="font-display text-2xl font-bold text-foreground mb-3">
              Heslo bylo změněno
            </h1>
            <p className="text-muted-foreground mb-8">
              Vaše heslo bylo úspěšně obnoveno. Nyní se můžete přihlásit s novým heslem.
            </p>
            <Link to="/login">
              <Button className="w-full">Přihlásit se</Button>
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-display text-3xl font-bold text-foreground mb-2">
              Nastavit nové heslo
            </h1>
            <p className="text-muted-foreground mb-8">
              Zadejte nové heslo pro váš účet
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">
                  Nové heslo
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="bg-muted/50 border-border pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {/* Password strength */}
                {password.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                    {passwordStrength.map((rule) => (
                      <div key={rule.label} className={`flex items-center gap-1.5 text-xs ${
                        rule.passed ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                      }`}>
                        {rule.passed
                          ? <Check className="w-3 h-3 flex-shrink-0" />
                          : <XIcon className="w-3 h-3 flex-shrink-0 opacity-40" />
                        }
                        {rule.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="confirm" className="block text-sm font-medium text-foreground mb-2">
                  Potvrdit nové heslo
                </label>
                <Input
                  id="confirm"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="bg-muted/50 border-border"
                  autoComplete="new-password"
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-gold text-accent-foreground hover:opacity-90 font-semibold"
                disabled={isSubmitting || !allPasswordRulesPassed || password !== confirmPassword}
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Nastavit nové heslo
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
