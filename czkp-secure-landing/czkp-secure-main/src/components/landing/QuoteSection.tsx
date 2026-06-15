import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import MoneyTransferAnimation from "./MoneyTransferAnimation";

const quoteSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(100, "Company name must be less than 100 characters"),
  email: z.string().trim().email("Invalid email address").max(255, "Email must be less than 255 characters"),
  companySize: z.string().min(1, "Please select company size"),
  message: z.string().trim().max(1000, "Message must be less than 1000 characters").optional(),
});

const RATE_LIMIT_KEY = 'quote_submission_timestamps';
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_SUBMISSIONS_PER_WINDOW = 3;

const checkRateLimit = (): boolean => {
  try {
    const stored = localStorage.getItem(RATE_LIMIT_KEY);
    const timestamps: number[] = stored ? JSON.parse(stored) : [];
    const now = Date.now();
    const recentSubmissions = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
    return recentSubmissions.length < MAX_SUBMISSIONS_PER_WINDOW;
  } catch {
    return true;
  }
};

const recordSubmission = (): void => {
  try {
    const stored = localStorage.getItem(RATE_LIMIT_KEY);
    const timestamps: number[] = stored ? JSON.parse(stored) : [];
    const now = Date.now();
    const recentSubmissions = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
    recentSubmissions.push(now);
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(recentSubmissions));
  } catch {}
};

const QuoteSection = () => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    companyName: "",
    email: "",
    companySize: "",
    message: "",
  });
  const containerRef = useRef<HTMLElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: "-20%" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!checkRateLimit()) {
      toast({ title: "Too Many Requests", description: "Please wait before submitting another request.", variant: "destructive" });
      return;
    }
    
    const result = quoteSchema.safeParse(formData);
    if (!result.success) {
      toast({ title: "Validation Error", description: result.error.errors[0]?.message || "Please check your input", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);

    try {
      const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000/api';
      const res = await fetch(`${API_BASE}/quotes/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: formData.companyName.trim(),
          email: formData.email.trim(),
          companySize: formData.companySize,
          message: formData.message.trim() || null,
        }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          toast({ title: "Too Many Requests", description: "Please wait before submitting another request.", variant: "destructive" });
        } else {
          const errData = await res.json().catch(() => ({}));
          toast({ title: "Error", description: errData.error || 'Submission failed', variant: "destructive" });
        }
        return;
      }

      recordSubmission();
      toast({ title: "Request Received", description: "We'll be in touch within 24 hours." });
      setFormData({ companyName: "", email: "", companySize: "", message: "" });
    } catch (error) {
      toast({ title: "Something went wrong", description: "Please try again later.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section 
      ref={containerRef}
      id="quote" 
      className="snap-section min-h-screen flex items-center justify-center relative overflow-hidden crypto-pattern"
    >
      {/* Corner decorations */}
      <div className="absolute top-10 left-10 w-24 h-24 border-l border-t border-accent/20" />
      <div className="absolute bottom-10 right-10 w-24 h-24 border-r border-b border-accent/20" />
      
      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-xl mx-auto">
          {/* Section Header */}
          <motion.div 
            className="text-center mb-12"
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8 }}
          >
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="w-16 h-px bg-accent/30" />
              <span className="text-accent text-xs tracking-[0.3em] uppercase">Get Started</span>
              <div className="w-16 h-px bg-accent/30" />
            </div>
            <h2 className="font-display text-4xl md:text-5xl text-foreground mb-4">
              Get a <span className="text-gradient-accent">Quote</span>
            </h2>
            <p className="text-muted-foreground">
              Tell us about your company and we'll get back to you within 24 hours.
            </p>
          </motion.div>

          {/* Money Animation */}
          <MoneyTransferAnimation />

          {/* Form */}
          <motion.div 
            className="relative"
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="absolute inset-0 border border-accent/20" />
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-accent -translate-x-px -translate-y-px" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-accent translate-x-px -translate-y-px" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-accent -translate-x-px translate-y-px" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-accent translate-x-px translate-y-px" />
            
            <form onSubmit={handleSubmit} className="p-8 md:p-12 space-y-6 bg-card/50 relative z-10">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs tracking-widest uppercase text-muted-foreground mb-3">
                    Organization
                  </label>
                  <Input
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    placeholder="Company name"
                    className="bg-transparent border-border/50 focus:border-accent rounded-none h-12"
                    maxLength={100}
                  />
                </div>
                <div>
                  <label className="block text-xs tracking-widest uppercase text-muted-foreground mb-3">
                    Contact
                  </label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="your@email.com"
                    className="bg-transparent border-border/50 focus:border-accent rounded-none h-12"
                    maxLength={255}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs tracking-widest uppercase text-muted-foreground mb-3">
                  Scale
                </label>
                <Select
                  value={formData.companySize}
                  onValueChange={(value) => setFormData({ ...formData, companySize: value })}
                >
                  <SelectTrigger className="bg-transparent border-border/50 focus:border-accent rounded-none h-12">
                    <SelectValue placeholder="Select size" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1-10">1-10 employees</SelectItem>
                    <SelectItem value="11-50">11-50 employees</SelectItem>
                    <SelectItem value="51-200">51-200 employees</SelectItem>
                    <SelectItem value="201-500">201-500 employees</SelectItem>
                    <SelectItem value="500+">500+ employees</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-xs tracking-widest uppercase text-muted-foreground mb-3">
                  Message (Optional)
                </label>
                <Textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Tell us about your requirements..."
                  className="bg-transparent border-border/50 focus:border-accent rounded-none min-h-[100px] resize-none"
                  maxLength={1000}
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-gradient-accent text-accent-foreground hover:opacity-90 rounded-none h-14 text-sm tracking-widest uppercase font-semibold"
              >
                {isSubmitting ? "Sending..." : "Request Quote"}
              </Button>

              <p className="text-center text-xs text-muted-foreground tracking-wider">
                Your data is encrypted end-to-end
              </p>
            </form>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default QuoteSection;
