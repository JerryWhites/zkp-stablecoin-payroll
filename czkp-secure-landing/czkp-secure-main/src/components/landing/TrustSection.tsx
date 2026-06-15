import { motion, useInView } from "framer-motion";
import { useRef, useEffect, useState } from "react";

const auditItems = [
  { item: "Encryption Level", value: "256", unit: "-bit", status: "VERIFIED" },
  { item: "Data Exposed", value: "0", unit: " bytes", status: "SECURE" },
  { item: "Privacy Coverage", value: "100", unit: "%", status: "COMPLETE" },
];

const AnimatedValue = ({ value, inView }: { value: number; inView: boolean }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (inView) {
      const duration = 2500;
      const steps = 60;
      const increment = value / steps;
      let current = 0;
      
      const timer = setInterval(() => {
        current += increment;
        if (current >= value) {
          setCount(value);
          clearInterval(timer);
        } else {
          setCount(Math.floor(current));
        }
      }, duration / steps);

      return () => clearInterval(timer);
    }
  }, [inView, value]);

  return <span>{count}</span>;
};

const TrustSection = () => {
  const containerRef = useRef<HTMLElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: "-20%" });

  return (
    <section 
      ref={containerRef}
      id="trust" 
      className="snap-section min-h-screen flex items-center justify-center relative overflow-hidden py-24"
    >
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent/5 rounded-full blur-[150px]" />
      
      <div className="container mx-auto px-6 relative z-10">
        {/* Ledger Document */}
        <motion.div 
          className="max-w-2xl mx-auto"
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
        >
          {/* Document container */}
          <div className="relative bg-card border border-border">
            {/* Top perforated edge */}
            <div className="absolute -top-2 left-4 right-4 flex justify-center gap-3">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-background border border-border" />
              ))}
            </div>

            {/* Document header */}
            <div className="px-8 pt-8 pb-6 border-b border-border text-center relative">
              <div className="absolute top-4 left-4 text-[9px] font-mono text-muted-foreground">
                REF: AUD-{new Date().getFullYear()}-001
              </div>
              <div className="absolute top-4 right-4 text-[9px] font-mono text-muted-foreground">
                PAGE 1 OF 1
              </div>
              
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={isInView ? { opacity: 1, scale: 1 } : {}}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <h2 className="font-display text-2xl md:text-3xl tracking-[0.1em] text-foreground mb-2">
                  SECURITY AUDIT REPORT
                </h2>
                <div className="flex items-center justify-center gap-4">
                  <div className="w-16 h-px bg-accent/30" />
                  <span className="text-accent text-[10px] tracking-[0.3em] font-mono">CERTIFIED</span>
                  <div className="w-16 h-px bg-accent/30" />
                </div>
              </motion.div>
            </div>

            {/* Ledger table */}
            <div className="px-8 py-6">
              {/* Table header */}
              <div className="grid grid-cols-3 gap-4 pb-3 border-b border-dashed border-border mb-4">
                <span className="text-[10px] font-mono text-muted-foreground tracking-widest">ITEM</span>
                <span className="text-[10px] font-mono text-muted-foreground tracking-widest text-center">VALUE</span>
                <span className="text-[10px] font-mono text-muted-foreground tracking-widest text-right">STATUS</span>
              </div>

              {/* Table rows */}
              {auditItems.map((row, index) => (
                <motion.div
                  key={row.item}
                  className="grid grid-cols-3 gap-4 py-4 border-b border-dotted border-border/50"
                  initial={{ opacity: 0, x: -20 }}
                  animate={isInView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.5, delay: 0.4 + index * 0.15 }}
                >
                  <span className="text-sm font-mono text-foreground">
                    {row.item}
                  </span>
                  <span className="text-center">
                    <span className="font-display text-3xl md:text-4xl text-gradient-accent">
                      <AnimatedValue value={parseInt(row.value)} inView={isInView} />
                    </span>
                    <span className="text-sm text-muted-foreground font-mono">{row.unit}</span>
                  </span>
                  <span className="text-right">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-accent tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                      {row.status}
                    </span>
                  </span>
                </motion.div>
              ))}
            </div>

            {/* Document footer */}
            <div className="px-8 py-6 border-t border-border bg-muted/10">
              <div className="flex items-center justify-between">
                <div className="text-[9px] font-mono text-muted-foreground space-y-1">
                  <div>GENERATED: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase()}</div>
                  <div>AUDITOR: ████████ ██████</div>
                </div>
                
                {/* Verified stamp */}
                <motion.div
                  className="relative"
                  initial={{ opacity: 0, scale: 1.5, rotate: -20 }}
                  animate={isInView ? { opacity: 1, scale: 1, rotate: -12 } : {}}
                  transition={{ duration: 0.5, delay: 1 }}
                >
                  <div className="border-2 border-accent text-accent font-display text-lg tracking-[0.15em] px-4 py-1.5 rotate-[-12deg]">
                    VERIFIED
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Corner fold */}
            <div className="absolute bottom-0 right-0 w-10 h-10 overflow-hidden">
              <div className="absolute bottom-0 right-0 w-14 h-14 bg-gradient-to-tl from-muted to-transparent transform rotate-45 translate-x-7 translate-y-7" />
            </div>
          </div>

          {/* Paper shadow layers */}
          <div className="absolute inset-0 -z-10 translate-x-1 translate-y-1 bg-border/30 border border-border/20" />
          <div className="absolute inset-0 -z-20 translate-x-2 translate-y-2 bg-border/20 border border-border/10" />
        </motion.div>
      </div>
    </section>
  );
};

export default TrustSection;
