import { Button } from "@/components/ui/button";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

const HeroSection = () => {
  const containerRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"]
  });

  const y = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  const scrollToQuote = () => {
    const element = document.getElementById("quote");
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      // Fallback for snap-scroll containers
      setTimeout(() => {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  };

  return (
    <section 
      ref={containerRef}
      className="snap-section min-h-screen flex items-center justify-center relative overflow-hidden crypto-pattern"
    >
      {/* Subtle radial gradient */}
      <div className="absolute inset-0 bg-gradient-radial from-accent/5 via-transparent to-transparent" />
      
      {/* Animated corner frames */}
      <div className="absolute top-20 left-10 w-32 h-32 border-l border-t border-accent/20 animate-fade-in-slow" style={{ animationDelay: "1s" }} />
      <div className="absolute top-20 right-10 w-32 h-32 border-r border-t border-accent/20 animate-fade-in-slow" style={{ animationDelay: "1.2s" }} />
      <div className="absolute bottom-20 left-10 w-32 h-32 border-l border-b border-accent/20 animate-fade-in-slow" style={{ animationDelay: "1.4s" }} />
      <div className="absolute bottom-20 right-10 w-32 h-32 border-r border-b border-accent/20 animate-fade-in-slow" style={{ animationDelay: "1.6s" }} />

      {/* Floating cryptographic symbols */}
      <motion.div 
        className="absolute top-1/4 left-[15%] text-6xl text-accent/10 font-display"
        animate={{ y: [-10, 10, -10], rotate: [0, 5, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      >
        ◇
      </motion.div>
      <motion.div 
        className="absolute bottom-1/3 right-[15%] text-4xl text-accent/10 font-display"
        animate={{ y: [10, -10, 10], rotate: [0, -5, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      >
        ⬡
      </motion.div>
      <motion.div 
        className="absolute top-1/3 right-[25%] text-3xl text-accent/5 font-display"
        animate={{ y: [5, -15, 5] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      >
        ⬢
      </motion.div>

      {/* Main content with parallax */}
      <motion.div 
        className="container mx-auto px-6 relative z-10"
        style={{ y, opacity }}
      >
        <div className="max-w-4xl mx-auto text-center relative">
          {/* AUTHORIZED stamp - positioned top right of content */}
          <motion.div
            className="absolute -top-16 right-0 md:right-10 pointer-events-none"
            initial={{ opacity: 0, scale: 1.5, rotate: -25 }}
            animate={{ opacity: 0.15, scale: 1, rotate: -15 }}
            transition={{ duration: 0.8, delay: 1.5 }}
          >
            <div className="border-4 border-accent text-accent font-display text-xl md:text-2xl tracking-[0.2em] px-6 py-2">
              AUTHORIZED
            </div>
          </motion.div>

          {/* Overline */}
          <motion.div 
            className="flex items-center justify-center gap-4 mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="w-12 h-px bg-accent/50" />
            <span className="text-accent text-xs tracking-[0.3em] uppercase font-mono">Enterprise Payroll Solution</span>
            <div className="w-12 h-px bg-accent/50" />
          </motion.div>

          {/* Main Headline */}
          <motion.h1 
            className="font-display text-5xl md:text-7xl lg:text-8xl text-foreground leading-[1.1] mb-8"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.4 }}
          >
            <span className="block">Private Payroll</span>
            <span className="text-gradient-accent">For Modern Teams</span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p 
            className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto mb-12 leading-relaxed"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
          >
            Process payroll while keeping salary data confidential. 
            Built for companies that value employee privacy and compliance.
          </motion.p>

          {/* CTA */}
          <motion.div 
            className="flex flex-col sm:flex-row items-center justify-center gap-6"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
          >
            <Button
              size="lg"
              onClick={scrollToQuote}
              className="bg-gradient-accent text-accent-foreground hover:opacity-90 text-sm tracking-widest uppercase px-10 py-6 font-semibold shadow-glow-accent animate-pulse-accent"
            >
              Get a Demo
            </Button>
            <button 
              onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
              className="text-muted-foreground hover:text-accent transition-colors text-sm tracking-widest uppercase flex items-center gap-2 group font-mono"
            >
              Learn More
              <span className="group-hover:translate-y-1 transition-transform">↓</span>
            </button>
          </motion.div>

          {/* Document reference number */}
          <motion.div
            className="mt-16 text-[10px] font-mono text-muted-foreground/50 tracking-widest"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.2 }}
          >
            DOC-REF: CZKP-{new Date().getFullYear()}-MAIN
          </motion.div>
        </div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div 
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 1.5 }}
      >
        <motion.div 
          className="w-px h-16 bg-gradient-to-b from-accent/50 to-transparent"
          animate={{ scaleY: [1, 0.5, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </motion.div>
    </section>
  );
};

export default HeroSection;
