import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    element?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
      scrolled ? "vault-glass border-b border-gold-subtle" : "bg-transparent"
    }`}>
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 border border-accent/40 flex items-center justify-center relative overflow-hidden group-hover:border-accent/60 transition-colors">
            <span className="font-display text-lg text-accent">C</span>
            {/* Corner accents */}
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-accent/60" />
            <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-accent/60" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-accent/60" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-accent/60" />
          </div>
          <span className="font-display text-xl tracking-[0.2em] text-foreground">CZKP</span>
        </Link>

        {/* Navigation Links */}
        <div className="hidden md:flex items-center gap-12">
          <button
            onClick={() => scrollToSection("features")}
            className="text-muted-foreground hover:text-accent transition-colors text-sm tracking-widest uppercase"
          >
            Features
          </button>
          <button
            onClick={() => scrollToSection("process")}
            className="text-muted-foreground hover:text-accent transition-colors text-sm tracking-widest uppercase"
          >
            Process
          </button>
          <button
            onClick={() => scrollToSection("trust")}
            className="text-muted-foreground hover:text-accent transition-colors text-sm tracking-widest uppercase"
          >
            Trust
          </button>
        </div>

        {/* Auth Buttons */}
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            asChild 
            className="text-foreground hover:text-accent hover:bg-transparent text-sm tracking-widest uppercase"
          >
            <Link to="/login">Log In</Link>
          </Button>
          <Button 
            asChild 
            className="bg-transparent border border-accent/50 text-accent hover:bg-accent hover:text-accent-foreground text-sm tracking-widest uppercase px-6 transition-all duration-300"
          >
            <Link to="/signup">Sign Up</Link>
          </Button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
