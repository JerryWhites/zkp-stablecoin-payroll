import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="py-16 border-t border-border/30 relative bg-background">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 md:gap-8">
          {/* Logo & Contact */}
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 border border-accent/40 flex items-center justify-center">
                <span className="font-display text-sm text-accent">C</span>
              </div>
              <span className="font-display text-lg tracking-[0.2em] text-foreground">CZKP</span>
            </Link>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground tracking-wider uppercase mb-3">Get in touch</p>
              <a 
                href="mailto:hello@czkp.io" 
                className="text-sm text-foreground/80 hover:text-accent transition-colors"
              >
                hello@czkp.io
              </a>
            </div>
          </div>

          {/* Navigation */}
          <div className="md:col-span-1">
            <p className="text-xs text-muted-foreground tracking-wider uppercase mb-4">Navigation</p>
            <div className="flex flex-col gap-3 text-sm">
              <Link to="/login" className="text-foreground/70 hover:text-accent transition-colors">
                Log In
              </Link>
              <Link to="/signup" className="text-foreground/70 hover:text-accent transition-colors">
                Sign Up
              </Link>
            </div>
          </div>

          {/* Legal */}
          <div className="md:col-span-1">
            <p className="text-xs text-muted-foreground tracking-wider uppercase mb-4">Legal</p>
            <div className="flex flex-col gap-3 text-sm">
              <Link to="/privacy" className="text-foreground/70 hover:text-accent transition-colors">
                Privacy Policy
              </Link>
              <Link to="/terms" className="text-foreground/70 hover:text-accent transition-colors">
                Terms of Service
              </Link>
            </div>
          </div>

          {/* Copyright */}
          <div className="md:col-span-1 md:text-right">
            <p className="text-xs text-muted-foreground tracking-wider">
              © {new Date().getFullYear()} CZKP
            </p>
            <p className="text-xs text-muted-foreground/60 mt-2">
              Privacy-first payroll
            </p>
          </div>
        </div>

        {/* Decorative element */}
        <div className="flex justify-center mt-12">
          <div className="text-accent/20 text-lg">◆</div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
