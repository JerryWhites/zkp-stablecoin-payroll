import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, ArrowLeft, Mail, Loader2 } from "lucide-react";
import { z } from "zod";
import { apiClient } from "@/lib/api-client";

const emailSchema = z.string().trim().email("Neplatná e-mailová adresa");

const ForgotPassword = () => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [email, setEmail] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = emailSchema.safeParse(email);
    if (!result.success) {
      toast({
        title: "Chyba validace",
        description: "Zadejte platnou e-mailovou adresu",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    // Password reset - submit to backend (uses apiClient for CSRF protection)
    try {
      await apiClient.authenticatedFetch('/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Always show success to prevent email enumeration
      setEmailSent(true);
    } catch {
      // Still show success to prevent enumeration
      setEmailSent(true);
    }

    setIsSubmitting(false);
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

        {emailSent ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <Mail className="w-8 h-8 text-accent" />
            </div>
            <h1 className="font-display text-2xl font-bold text-foreground mb-3">
              Zkontrolujte svůj e-mail
            </h1>
            <p className="text-muted-foreground mb-6">
              Odeslali jsme odkaz pro obnovení hesla na <strong className="text-foreground">{email}</strong>. 
              Zkontrolujte svůj e-mail a postupujte podle pokynů.
            </p>
            <p className="text-sm text-muted-foreground mb-8">
              E-mail nepřišel? Zkontrolujte složku spam nebo{" "}
              <button
                onClick={() => setEmailSent(false)}
                className="text-accent hover:underline"
              >
                zkuste to znovu
              </button>
            </p>
            <Link to="/login">
              <Button
                variant="outline"
                className="border-border"
              >
                Zpět na přihlášení
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-display text-3xl font-bold text-foreground mb-2">
              Obnovení hesla
            </h1>
            <p className="text-muted-foreground mb-8">
              Zadejte svůj e-mail a my vám pošleme odkaz pro obnovení
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                  E-mail
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vas@email.cz"
                  className="bg-muted/50 border-border"
                  autoFocus
                  autoComplete="email"
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-gradient-gold text-accent-foreground hover:opacity-90 font-semibold py-5"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Odesílám...</>
                ) : (
                  "Odeslat odkaz pro obnovení"
                )}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
