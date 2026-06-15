// ====================================
// ⚙️ Settings Page — Profile, Password, 2FA
// ====================================

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Shield, Key, Smartphone, Eye, EyeOff, Loader2, CheckCircle } from "lucide-react";

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [companyName, setCompanyName] = useState("—");

  // Password change
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // 2FA
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [totpSecret, setTotpSecret] = useState("");
  const [totpQR, setTotpQR] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [verifying2FA, setVerifying2FA] = useState(false);
  const [disabling2FA, setDisabling2FA] = useState(false);

  useEffect(() => {
    if (user?.is_2fa_enabled) {
      setIs2FAEnabled(true);
    }
  }, [user]);

  useEffect(() => {
    let active = true;

    const loadCompanyName = async () => {
      if (!user) {
        if (active) setCompanyName("—");
        return;
      }

      try {
        const res = await apiClient.authenticatedFetch("/companies/current");
        if (!res.ok) {
          if (active) setCompanyName("—");
          return;
        }

        const data = await res.json();
        if (active) {
          setCompanyName(data?.company?.name || "—");
        }
      } catch {
        if (active) setCompanyName("—");
      }
    };

    loadCompanyName();

    return () => {
      active = false;
    };
  }, [user?.id, user?.company_id]);

  // --- Password Change ---
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({ title: "Chyba", description: "Hesla se neshodují", variant: "destructive" });
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      toast({ title: "Chyba", description: "Nové heslo musí mít alespoň 8 znaků", variant: "destructive" });
      return;
    }

    setChangingPassword(true);
    try {
      const res = await apiClient.authenticatedFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: passwordForm.currentPassword,
          new_password: passwordForm.newPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Heslo změněno", description: "Vaše heslo bylo úspěšně aktualizováno." });
        setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      } else {
        toast({ title: "Chyba", description: data.error || "Nepodařilo se změnit heslo", variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Chyba při komunikaci se serverem", variant: "destructive" });
    } finally {
      setChangingPassword(false);
    }
  };

  // --- 2FA Setup ---
  const start2FASetup = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/auth/2fa/setup", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.secret) {
        setTotpSecret(data.secret);
        setTotpQR(data.qr_url || "");
        setShow2FASetup(true);
      } else {
        toast({ title: "Chyba", description: data.error || "Nepodařilo se nastavit 2FA", variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Chyba při komunikaci se serverem", variant: "destructive" });
    }
  };

  const verify2FASetup = async () => {
    if (totpCode.length !== 6) return;
    setVerifying2FA(true);
    try {
      const res = await apiClient.authenticatedFetch("/auth/2fa/verify", {
        method: "POST",
        body: JSON.stringify({ totp_code: totpCode }),
      });
      const data = await res.json();
      if (res.ok) {
        setIs2FAEnabled(true);
        setShow2FASetup(false);
        setTotpCode("");
        toast({ title: "2FA aktivováno", description: "Dvoufaktorové ověření bylo úspěšně nastaveno." });
      } else {
        toast({ title: "Neplatný kód", description: data.error || "Zkuste to znovu", variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Chyba při ověřování kódu", variant: "destructive" });
    } finally {
      setVerifying2FA(false);
    }
  };

  const disable2FA = async () => {
    setDisabling2FA(true);
    try {
      const res = await apiClient.authenticatedFetch("/auth/2fa/disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setIs2FAEnabled(false);
        toast({ title: "2FA deaktivováno", description: "Dvoufaktorové ověření bylo vypnuto." });
      } else {
        toast({ title: "Chyba", description: data.error || "Nepodařilo se deaktivovat 2FA", variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", description: "Chyba při deaktivaci 2FA", variant: "destructive" });
    } finally {
      setDisabling2FA(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nastavení</h1>
        <p className="text-muted-foreground">Správa účtu a zabezpečení</p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Profil
          </CardTitle>
          <CardDescription>Informace o vašem účtu</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">E-mail</span>
            <span className="text-sm font-medium">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Role</span>
            <Badge variant="outline">{user?.role || "user"}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Firma</span>
            <span className="text-sm font-medium">{companyName}</span>
          </div>
        </CardContent>
      </Card>

      {/* Password Change */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" /> Změna hesla
          </CardTitle>
          <CardDescription>Aktualizujte své přihlašovací heslo</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <Label htmlFor="current">Aktuální heslo</Label>
              <div className="relative">
                <Input
                  id="current"
                  type={showPasswords ? "text" : "password"}
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  required
                />
              </div>
            </div>
            <div>
              <Label htmlFor="new">Nové heslo</Label>
              <Input
                id="new"
                type={showPasswords ? "text" : "password"}
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                required
                minLength={8}
              />
            </div>
            <div>
              <Label htmlFor="confirm">Potvrzení nového hesla</Label>
              <Input
                id="confirm"
                type={showPasswords ? "text" : "password"}
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPasswords(!showPasswords)}
                className="text-muted-foreground hover:text-foreground"
              >
                {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <span className="text-xs text-muted-foreground">
                {showPasswords ? "Skrýt hesla" : "Zobrazit hesla"}
              </span>
            </div>
            <Button type="submit" disabled={changingPassword}>
              {changingPassword ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Změnit heslo
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 2FA Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" /> Dvoufaktorové ověření (2FA)
          </CardTitle>
          <CardDescription>
            Zvyšte zabezpečení účtu pomocí TOTP autentikátoru (Google Authenticator, Authy, apod.)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {is2FAEnabled ? (
                <Badge className="bg-green-600">Aktivní</Badge>
              ) : (
                <Badge variant="outline">Neaktivní</Badge>
              )}
              <span className="text-sm">
                {is2FAEnabled
                  ? "2FA je zapnuté — při přihlášení budete potřebovat kód z autentikátoru"
                  : "2FA je vypnuté — doporučujeme ho zapnout pro vyšší bezpečnost"}
              </span>
            </div>
            {is2FAEnabled ? (
              <Button variant="destructive" size="sm" onClick={disable2FA} disabled={disabling2FA}>
                {disabling2FA ? <Loader2 className="h-4 w-4 animate-spin" /> : "Vypnout"}
              </Button>
            ) : (
              <Button size="sm" onClick={start2FASetup}>
                Nastavit 2FA
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 2FA Setup Dialog */}
      <Dialog open={show2FASetup} onOpenChange={setShow2FASetup}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nastavení 2FA</DialogTitle>
            <DialogDescription>
              Naskenujte QR kód ve vaší TOTP aplikaci a poté zadejte 6místný kód pro ověření.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* QR Code (if backend provides URL, render as image; otherwise show secret manually) */}
            {totpQR ? (
              <div className="flex justify-center">
                <img src={totpQR} alt="TOTP QR Code" className="w-48 h-48" />
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">Ruční zadání klíče:</p>
                <code className="bg-muted p-2 rounded text-sm font-mono select-all break-all">{totpSecret}</code>
              </div>
            )}

            <Separator />

            <div className="space-y-2">
              <Label>Zadejte 6místný kód z autentikátoru</Label>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={totpCode} onChange={setTotpCode}>
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

            <Button
              className="w-full"
              onClick={verify2FASetup}
              disabled={totpCode.length !== 6 || verifying2FA}
            >
              {verifying2FA ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Ověřit a aktivovat
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
