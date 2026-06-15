import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.error("404 Error: User attempted to access non-existent route:", location.pathname);
    }
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
          <Shield className="w-8 h-8 text-muted-foreground" />
        </div>
        <h1 className="font-display text-6xl font-bold text-foreground mb-2">404</h1>
        <p className="text-lg text-muted-foreground mb-6">
          Str\u00e1nka nebyla nalezena
        </p>
        <p className="text-sm text-muted-foreground mb-8">
          Cesta <code className="bg-muted px-2 py-0.5 rounded text-xs">{location.pathname}</code> neexistuje.
        </p>
        <div className="flex gap-3 justify-center">
          <Link to="/dashboard">
            <Button className="bg-gradient-gold text-accent-foreground hover:opacity-90 gap-2">
              <ArrowLeft className="w-4 h-4" /> Zp\u011bt na p\u0159ehled
            </Button>
          </Link>
          <Link to="/login">
            <Button variant="outline">P\u0159ihl\u00e1\u0161en\u00ed</Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
