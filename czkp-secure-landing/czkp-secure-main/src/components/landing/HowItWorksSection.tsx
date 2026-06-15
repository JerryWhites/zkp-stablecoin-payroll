import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const steps = [
  {
    number: "I",
    title: "Connect",
    description: "Connect your payroll system in minutes. We integrate with major providers.",
  },
  {
    number: "II",
    title: "Configure",
    description: "Set up who gets paid, how much, and when. Just like normal payroll.",
  },
  {
    number: "III",
    title: "Execute",
    description: "Run payroll with one click. Payments go out, privacy stays in.",
  },
  {
    number: "IV",
    title: "Verify",
    description: "Employees see their pay. Auditors see compliance. No one sees what they shouldn't.",
  },
];

const HowItWorksSection = () => {
  const containerRef = useRef<HTMLElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: "-20%" });

  return (
    <section 
      ref={containerRef}
      id="process" 
      className="snap-section min-h-screen flex items-center justify-center relative overflow-hidden crypto-pattern"
    >
      {/* Vertical line decoration */}
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gradient-to-b from-transparent via-accent/20 to-transparent" />
      
      <div className="container mx-auto px-6 relative z-10">
        {/* Section Header */}
        <motion.div 
          className="text-center mb-20"
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
        >
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="w-16 h-px bg-accent/30" />
            <span className="text-accent text-xs tracking-[0.3em] uppercase">The Process</span>
            <div className="w-16 h-px bg-accent/30" />
          </div>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl text-foreground">
            Four Steps to <span className="text-gradient-accent">Privacy</span>
          </h2>
        </motion.div>

        {/* Steps - Vertical Timeline */}
        <div className="max-w-3xl mx-auto relative">
          {/* Connecting line */}
          <motion.div 
            className="absolute left-8 md:left-12 top-0 bottom-0 w-px bg-accent/20"
            initial={{ scaleY: 0 }}
            animate={isInView ? { scaleY: 1 } : {}}
            transition={{ duration: 1.5, ease: "easeOut" }}
            style={{ originY: 0 }}
          />

          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              className="relative flex gap-8 md:gap-12 mb-16 last:mb-0"
              initial={{ opacity: 0, x: -40 }}
              animate={isInView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.3 + index * 0.2 }}
            >
              {/* Number circle */}
              <div className="relative z-10 flex-shrink-0">
                <div className="w-16 h-16 md:w-24 md:h-24 border border-accent/40 flex items-center justify-center bg-background group-hover:border-accent/60 transition-colors">
                  <span className="font-display text-2xl md:text-3xl text-accent">{step.number}</span>
                </div>
              </div>

              {/* Content */}
              <div className="pt-2 md:pt-6">
                <h3 className="font-display text-xl md:text-2xl text-foreground mb-3 tracking-wide uppercase">
                  {step.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed max-w-md">
                  {step.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
