import { useState, useMemo } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Shield, ArrowLeft, Eye, EyeOff, User, Building2, Check, X as XIcon, Loader2 } from "lucide-react";
import { sanitizeAuthError } from "@/lib/authErrors";
import { z } from "zod";
import type { EntityType } from "@/lib/cz-payroll-types";
import { ENTITY_TYPE_LABELS } from "@/lib/cz-payroll-types";

const passwordSchema = z.string()
  .min(12, "Heslo musí mít alespoň 12 znaků")
  .max(72, "Heslo nesmí přesáhnout 72 znaků")
  .regex(/[a-z]/, "Heslo musí obsahovat malé písmeno")
  .regex(/[A-Z]/, "Heslo musí obsahovat velké písmeno")
  .regex(/[0-9]/, "Heslo musí obsahovat číslici")
  .regex(/[^A-Za-z0-9\s]/, "Heslo musí obsahovat speciální znak");

const signupSchema = z.object({
  email: z.string().trim().email("Neplatná e-mailová adresa"),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Hesla se neshodují",
  path: ["confirmPassword"],
});

const PASSWORD_RULES = [
  { label: "Alespoň 12 znaků", test: (p: string) => p.length >= 12 },
  { label: "Velké písmeno", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Malé písmeno", test: (p: string) => /[a-z]/.test(p) },
  { label: "Číslice", test: (p: string) => /[0-9]/.test(p) },
  { label: "Speciální znak (!@#...)", test: (p: string) => /[^A-Za-z0-9\s]/.test(p) },
];

const ENTITY_DESCRIPTIONS: Record<EntityType, string> = {
  osvc: "Fyzická osoba",
  sro: "Společnost s r.o.",
  as: "Akciová společnost",
  komanditni: "Komand. spol.",
  vos: "Veřejná obch. spol.",
};

const Signup = () => {
  const { signUp, user, loading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [entityType, setEntityType] = useState<EntityType>("sro");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
  });

  const passwordStrength = useMemo(() => {
    return PASSWORD_RULES.map(r => ({ ...r, passed: r.test(formData.password) }));
  }, [formData.password]);
  const allPasswordRulesPassed = passwordStrength.every(r => r.passed);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/cz/company" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = signupSchema.safeParse(formData);
    if (!result.success) {
      toast({
        title: "Chyba validace",
        description: result.error.errors[0]?.message,
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    const { error } = await signUp(formData.email.trim(), formData.password);

    if (error) {
      toast({
        title: "Registrace se nezdařila",
        description: sanitizeAuthError(error),
        variant: "destructive",
      });
    } else {
      toast({
        title: "Účet vytvořen",
        description: "Nyní nastavte svou firmu.",
      });
      // Navigate to company setup with the selected entity type
      navigate(`/cz/company?entity_type=${entityType}`);
    }

    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Panel - Visual */}
      <div className="hidden lg:flex flex-1 bg-card items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/10 to-secondary/10" />
        <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 left-1/4 w-64 h-64 bg-accent/10 rounded-full blur-3xl" />
        
        <div className="relative z-10 text-center max-w-md">
          <Shield className="w-20 h-20 text-accent mx-auto mb-6" />
          <h2 className="font-display text-3xl font-bold text-foreground mb-4">
            Zabezpečený payroll
          </h2>
          <p className="text-muted-foreground text-lg">
            Mzdový systém s šifrováním, zero-knowledge proofs a českým právním rámcem.
          </p>
        </div>
      </div>

      {/* Right Panel - Form */}
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
            Vytvořte si účet
          </h1>
          <p className="text-muted-foreground mb-8">
            Začněte používat zabezpečený mzdový systém
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Entity Type Selection */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Typ podnikání
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {(Object.keys(ENTITY_TYPE_LABELS) as EntityType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setEntityType(type)}
                    className={`p-2.5 rounded-lg border-2 text-center transition-all ${
                      entityType === type
                        ? "border-accent bg-accent/10 text-accent font-semibold shadow-sm"
                        : "border-border hover:border-accent/50 hover:bg-muted/50"
                    }`}
                  >
                    {type === "osvc" ? <User className="h-4 w-4 mx-auto mb-0.5" /> : <Building2 className="h-4 w-4 mx-auto mb-0.5" />}
                    <div className="text-xs font-medium">{ENTITY_TYPE_LABELS[type]}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight mt-0.5 hidden sm:block">{ENTITY_DESCRIPTIONS[type]}</div>
                  </button>
                ))}
              </div>
            </div>

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
              {formData.password.length > 0 && (
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
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-2">
                Potvrzení hesla
              </label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                placeholder="••••••••••••"
                className={`bg-muted/50 border-border ${
                  formData.confirmPassword && formData.confirmPassword !== formData.password
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }`}
                autoComplete="new-password"
              />
              {formData.confirmPassword && formData.confirmPassword !== formData.password && (
                <p className="text-xs text-destructive mt-1">Hesla se neshodují</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !allPasswordRulesPassed || formData.password !== formData.confirmPassword || !formData.email}
              className="w-full bg-gradient-gold text-accent-foreground hover:opacity-90 font-semibold py-5"
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Vytvářím účet...</>
              ) : (
                "Vytvořit účet"
              )}
            </Button>
          </form>

          {/* Login link */}
          <p className="text-center text-muted-foreground mt-8">
            Už máte účet?{" "}
            <Link to="/login" className="text-accent hover:underline font-medium">
              Přihlásit se
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Signup;
