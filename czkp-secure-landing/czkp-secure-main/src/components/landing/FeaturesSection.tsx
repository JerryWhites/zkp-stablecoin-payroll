import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const features = [
  {
    docNumber: "SEC-2847",
    classification: "CONFIDENTIAL",
    subject: "ENCRYPTED TRANSFERS",
    content: "All salary payments are encrypted end-to-end using zero-knowledge proofs.",
    redacted: "CLASSIFICATION: ████████",
    authorized: "J. REDACTED",
    date: "██/██/2024",
  },
  {
    docNumber: "ACC-1923",
    classification: "RESTRICTED",
    subject: "ROLE-BASED ACCESS",
    content: "HR, finance, and auditors see only the data they need to do their job.",
    redacted: "CLEARANCE: LEVEL ██",
    authorized: "M. REDACTED",
    date: "██/██/2024",
  },
  {
    docNumber: "ENT-4521",
    classification: "INTERNAL",
    subject: "ENTERPRISE READY",
    content: "Built for companies handling sensitive compensation data at scale.",
    redacted: "CAPACITY: ██████ TXN/S",
    authorized: "REDACTED",
    date: "██/██/2024",
  },
  {
    docNumber: "AUD-3847",
    classification: "VERIFIED",
    subject: "AUDIT-FRIENDLY",
    content: "Provide proof of payment to auditors without revealing exact amounts.",
    redacted: "COMPLIANCE: ██████",
    authorized: "REDACTED",
    date: "██/██/2024",
  },
];

const DocumentCard = ({ feature, index, isInView }: { 
  feature: typeof features[0]; 
  index: number; 
  isInView: boolean;
}) => {
  return (
    <motion.div
      className="relative group"
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: 0.2 + index * 0.15 }}
    >
      {/* Paper texture background */}
      <div className="relative bg-card border border-border overflow-hidden">
        {/* Top perforated edge */}
        <div className="absolute top-0 left-0 right-0 h-3 bg-gradient-to-b from-background to-transparent flex items-start justify-center">
          <div className="flex gap-2 mt-1">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="w-1 h-1 rounded-full bg-border" />
            ))}
          </div>
        </div>

        {/* Document header */}
        <div className="px-5 pt-6 pb-3 border-b border-dashed border-border">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono text-accent tracking-widest border border-accent/30 px-2 py-0.5">
                {feature.classification}
              </span>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground">
              DOC #{feature.docNumber}
            </span>
          </div>
        </div>

        {/* Document content */}
        <div className="px-5 py-5">
          <div className="mb-4">
            <span className="text-[10px] font-mono text-muted-foreground tracking-wider">RE:</span>
            <h3 className="font-display text-base tracking-wide text-foreground mt-1">
              {feature.subject}
            </h3>
            <div className="w-full h-px bg-border mt-2" />
          </div>
          
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            {feature.content}
          </p>

          {/* Redacted line */}
          <div className="font-mono text-[11px] text-muted-foreground/50">
            {feature.redacted}
          </div>
        </div>

        {/* Document footer */}
        <div className="px-5 py-3 border-t border-dashed border-border bg-muted/20">
          <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground">
            <span>AUTHORIZED: {feature.authorized}</span>
            <span>DATE: {feature.date}</span>
          </div>
        </div>

        {/* Hover stamp effect */}
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          initial={{ opacity: 0, scale: 1.5, rotate: -15 }}
          whileHover={{ opacity: 0.1, scale: 1, rotate: -12 }}
          transition={{ duration: 0.3 }}
        >
          <div className="border-4 border-accent text-accent font-display text-2xl tracking-widest px-6 py-2 rotate-[-12deg]">
            APPROVED
          </div>
        </motion.div>

        {/* Corner fold effect */}
        <div className="absolute bottom-0 right-0 w-8 h-8 overflow-hidden">
          <div className="absolute bottom-0 right-0 w-12 h-12 bg-gradient-to-tl from-muted to-transparent transform rotate-45 translate-x-6 translate-y-6" />
        </div>
      </div>

      {/* Paper shadow */}
      <div className="absolute inset-0 -z-10 translate-x-1 translate-y-1 bg-border/20" />
    </motion.div>
  );
};

const FeaturesSection = () => {
  const containerRef = useRef<HTMLElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: "-20%" });

  return (
    <section 
      ref={containerRef}
      id="features" 
      className="snap-section min-h-screen flex items-center justify-center relative overflow-hidden py-24"
    >
      {/* Background pattern */}
      <div className="absolute inset-0 crypto-pattern opacity-50" />
      
      <div className="container mx-auto px-6 relative z-10">
        {/* Section Header - Document style */}
        <motion.div 
          className="text-center mb-16"
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
        >
          <div className="inline-block border border-border px-6 py-4 mb-8 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 bg-background">
              <span className="text-[10px] font-mono text-muted-foreground tracking-[0.3em]">DOCUMENT ARCHIVE</span>
            </div>
            <div className="flex items-center justify-center gap-4 mb-4">
              <div className="w-12 h-px bg-accent/30" />
              <span className="text-accent text-xs tracking-[0.3em] uppercase font-mono">CLASSIFIED</span>
              <div className="w-12 h-px bg-accent/30" />
            </div>
            <h2 className="font-display text-4xl md:text-5xl text-foreground">
              Security <span className="text-gradient-accent">Protocols</span>
            </h2>
          </div>
        </motion.div>

        {/* Document Grid */}
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {features.map((feature, index) => (
            <DocumentCard 
              key={feature.docNumber} 
              feature={feature} 
              index={index}
              isInView={isInView}
            />
          ))}
        </div>

        {/* Bottom decoration */}
        <motion.div 
          className="flex justify-center mt-16"
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-8 h-px bg-border" />
            <span className="text-[10px] font-mono tracking-widest">END OF FILE</span>
            <div className="w-8 h-px bg-border" />
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default FeaturesSection;
