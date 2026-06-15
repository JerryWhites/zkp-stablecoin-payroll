// ====================================
// 📜 Terms of Service Page
// ====================================

import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-6 py-20 max-w-3xl">
        <Link to="/" className="inline-flex items-center gap-2 text-accent hover:underline mb-8 text-sm">
          <ArrowLeft className="w-4 h-4" /> Zpět na hlavní stránku
        </Link>

        <h1 className="text-3xl font-display mb-2">Obchodní podmínky</h1>
        <p className="text-sm text-muted-foreground mb-10">Poslední aktualizace: 1. 1. 2026</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-6 text-foreground/80 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Úvodní ustanovení</h2>
            <p>
              Tyto obchodní podmínky upravují práva a povinnosti mezi poskytovatelem služby CZKP Payroll
              (dále jen „Poskytovatel") a uživatelem služby (dále jen „Uživatel").
              Služba je provozována společností CZKP s.r.o.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Popis služby</h2>
            <p>
              CZKP Payroll je cloudová platforma pro zpracování mezd v souladu s českou legislativou,
              zahrnující výpočet hrubé a čisté mzdy, sociálního a zdravotního pojištění, daně z příjmů,
              generování výplatních pásek, přehledů pro OSSZ a ZP, ELDP a dalších zákonných dokumentů.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. Registrace a uživatelský účet</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Uživatel se registruje s platným IČO a e-mailovou adresou</li>
              <li>Uživatel je povinen udržovat heslo v tajnosti a používat 2FA</li>
              <li>Jeden účet = jedna firma (IČO). Pro holding kontaktujte Enterprise plán.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Předplatné a platby</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Služba je poskytována v placených plánech: Start, Growth, Business, Enterprise</li>
              <li>Ceny jsou uvedeny bez DPH, není-li uvedeno jinak</li>
              <li>Předplatné se automaticky obnovuje, pokud není zrušeno 30 dní před koncem období</li>
              <li>Payroll runy jsou jednorázové nákupy bez automatického obnovení</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Odpovědnost</h2>
            <p>
              Poskytovatel odpovídá za správnost výpočtů v rozsahu implementované legislativy.
              Uživatel odpovídá za správnost vstupních dat (mzdové údaje zaměstnanců, odpracované hodiny).
              Poskytovatel nenese odpovědnost za škody způsobené nesprávnými vstupními daty.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Bezpečnost dat</h2>
            <p>
              Veškerá citlivá data jsou šifrována (AES-256-GCM). Přístup je chráněn JWT tokeny s 2FA.
              Poskytovatel se zavazuje dodržovat GDPR a zákon č. 110/2019 Sb. o zpracování osobních údajů.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. SLA (Service Level Agreement)</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Dostupnost služby: min. 99,5 % měsíčně (Business+)</li>
              <li>Doba odezvy na kritické problémy: do 4 hodin (Business), do 1 hodiny (Enterprise)</li>
              <li>Plánovaná údržba: oznámena min. 48 hodin předem</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Ukončení služby</h2>
            <p>
              Uživatel může kdykoli zrušit předplatné. Data budou dostupná ke stažení po dobu 30 dnů
              po ukončení. Zákonné archivační povinnosti zůstávají nedotčeny.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Rozhodné právo</h2>
            <p>
              Tyto podmínky se řídí právním řádem České republiky. Příslušným soudem je
              Městský soud v Praze.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
