// ====================================
// 📜 Privacy Policy Page
// ====================================

import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-6 py-20 max-w-3xl">
        <Link to="/" className="inline-flex items-center gap-2 text-accent hover:underline mb-8 text-sm">
          <ArrowLeft className="w-4 h-4" /> Zpět na hlavní stránku
        </Link>

        <h1 className="text-3xl font-display mb-2">Zásady ochrany osobních údajů</h1>
        <p className="text-sm text-muted-foreground mb-10">Poslední aktualizace: 1. 1. 2026</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-6 text-foreground/80 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Správce osobních údajů</h2>
            <p>
              Správcem osobních údajů je CZKP s.r.o., IČO: 12345678, se sídlem Praha, Česká republika
              (dále jen „Správce"). Kontaktní e-mail: <a href="mailto:privacy@czkp.io" className="text-accent hover:underline">privacy@czkp.io</a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Jaké údaje zpracováváme</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Identifikační údaje (jméno, příjmení, IČO, DIČ)</li>
              <li>Kontaktní údaje (e-mail, telefon, adresa)</li>
              <li>Mzdové údaje zaměstnanců (šifrované AES-256-GCM)</li>
              <li>Přihlašovací údaje (e-mail, heslo v hash formátu bcrypt)</li>
              <li>Technické údaje (IP adresa, cookies, audit log)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. Účel zpracování</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Poskytování služeb mzdového zpracování</li>
              <li>Plnění zákonných povinností (zákon č. 563/1991 Sb., zákoník práce)</li>
              <li>Zajištění bezpečnosti služby</li>
              <li>Komunikace s uživateli</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Právní základ zpracování</h2>
            <p>
              Údaje zpracováváme na základě: plnění smlouvy (čl. 6 odst. 1 písm. b) GDPR),
              plnění právní povinnosti (čl. 6 odst. 1 písm. c) GDPR), oprávněného zájmu
              (čl. 6 odst. 1 písm. f) GDPR) a souhlasu (čl. 6 odst. 1 písm. a) GDPR).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Zabezpečení údajů</h2>
            <p>
              Veškerá citlivá data jsou šifrována pomocí AES-256-GCM. Mzdové výpočty mohou být
              ověřovány pomocí Zero-Knowledge proofů na Aleo blockchain bez odhalení skutečných hodnot.
              Přístup k datům je chráněn 2FA (TOTP) a role-based access control (RBAC).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Doba uchování</h2>
            <p>
              Mzdové údaje uchováváme po dobu stanovenou zákonem (min. 30 let pro ELDP,
              10 let pro mzdové listy). Po ukončení smlouvy budou data smazána dle zákonných lhůt.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Vaše práva</h2>
            <p>
              Máte právo na přístup, opravu, výmaz, omezení zpracování, přenositelnost údajů
              a právo vznést námitku. Pro uplatnění práv kontaktujte{" "}
              <a href="mailto:privacy@czkp.io" className="text-accent hover:underline">privacy@czkp.io</a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Cookies</h2>
            <p>
              Používáme pouze nezbytné cookies pro funkci aplikace (session, CSRF token).
              Nepoužíváme marketingové ani analytické cookies třetích stran.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
