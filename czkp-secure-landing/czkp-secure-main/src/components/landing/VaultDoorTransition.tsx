import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

const VaultDoorTransition = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"]
  });

  // Curtains open as you scroll past
  const leftCurtainX = useTransform(scrollYProgress, [0.2, 0.6], ["0%", "-100%"]);
  const rightCurtainX = useTransform(scrollYProgress, [0.2, 0.6], ["0%", "100%"]);
  const curtainsOpacity = useTransform(scrollYProgress, [0.5, 0.7], [1, 0]);
  const glowIntensity = useTransform(scrollYProgress, [0.2, 0.5], [0, 1]);
  const textOpacity = useTransform(scrollYProgress, [0.3, 0.5], [0, 1]);
  const spotlightScale = useTransform(scrollYProgress, [0.3, 0.6], [0.5, 1.5]);

  return (
    <div 
      ref={containerRef}
      className="min-h-screen relative flex items-center justify-center overflow-hidden"
    >
      {/* Stage background with rich crimson gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-crimson/20 to-background" />
      
      {/* Spotlight effects */}
      <motion.div 
        className="absolute inset-0 flex items-center justify-center"
        style={{ opacity: glowIntensity }}
      >
        <motion.div 
          className="absolute w-[800px] h-[800px] rounded-full bg-crimson/30 blur-[150px]"
          style={{ scale: spotlightScale }}
        />
        <motion.div 
          className="absolute w-[500px] h-[500px] rounded-full bg-crimson/40 blur-[100px]"
          style={{ scale: spotlightScale }}
        />
        <div className="absolute w-[300px] h-[300px] rounded-full bg-crimson-dark/50 blur-[80px]" />
      </motion.div>

      {/* Smooth transition gradient to next section */}
      <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-b from-transparent via-crimson/10 to-background pointer-events-none" />

      {/* Left Theatre Curtain */}
      <motion.div
        className="absolute left-0 top-0 w-1/2 h-full z-10 overflow-hidden"
        style={{ x: leftCurtainX, opacity: curtainsOpacity }}
      >
        {/* Curtain fabric with folds */}
        <div className="absolute inset-0 bg-gradient-to-r from-crimson-dark via-crimson to-crimson-dark">
          {/* Curtain fold shadows */}
          <div className="absolute inset-0 flex">
            {[...Array(8)].map((_, i) => (
              <div 
                key={i}
                className="flex-1 bg-gradient-to-r from-black/30 via-transparent to-black/20"
              />
            ))}
          </div>
          {/* Velvet texture overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-black/20" />
        </div>
        
        {/* Gold trim on inner edge */}
        <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-r from-accent/60 to-accent/40" />
        
        {/* Curtain tassel */}
        <div className="absolute right-8 top-1/3">
          <div className="w-3 h-24 bg-gradient-to-b from-accent via-accent/80 to-accent/60 rounded-full" />
          <div className="w-8 h-16 bg-gradient-to-b from-accent/80 to-accent/40 -ml-2.5 rounded-b-full flex flex-col items-center pt-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="w-0.5 h-8 bg-accent/60 mx-0.5" />
            ))}
          </div>
        </div>

        {/* Decorative swag at top */}
        <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-crimson-dark to-transparent">
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-r from-crimson-dark via-crimson to-crimson-dark opacity-80" 
               style={{ borderRadius: "0 0 100% 100% / 0 0 100% 100%" }} />
        </div>
      </motion.div>

      {/* Right Theatre Curtain */}
      <motion.div
        className="absolute right-0 top-0 w-1/2 h-full z-10 overflow-hidden"
        style={{ x: rightCurtainX, opacity: curtainsOpacity }}
      >
        {/* Curtain fabric with folds */}
        <div className="absolute inset-0 bg-gradient-to-l from-crimson-dark via-crimson to-crimson-dark">
          {/* Curtain fold shadows */}
          <div className="absolute inset-0 flex">
            {[...Array(8)].map((_, i) => (
              <div 
                key={i}
                className="flex-1 bg-gradient-to-l from-black/30 via-transparent to-black/20"
              />
            ))}
          </div>
          {/* Velvet texture overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-black/20" />
        </div>
        
        {/* Gold trim on inner edge */}
        <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-l from-accent/60 to-accent/40" />
        
        {/* Curtain tassel */}
        <div className="absolute left-8 top-1/3">
          <div className="w-3 h-24 bg-gradient-to-b from-accent via-accent/80 to-accent/60 rounded-full" />
          <div className="w-8 h-16 bg-gradient-to-b from-accent/80 to-accent/40 -ml-2.5 rounded-b-full flex flex-col items-center pt-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="w-0.5 h-8 bg-accent/60 mx-0.5" />
            ))}
          </div>
        </div>

        {/* Decorative swag at top */}
        <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-crimson-dark to-transparent">
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-r from-crimson-dark via-crimson to-crimson-dark opacity-80" 
               style={{ borderRadius: "0 0 100% 100% / 0 0 100% 100%" }} />
        </div>
      </motion.div>

      {/* Top valance that stays */}
      <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-crimson-dark via-crimson-dark/80 to-transparent z-20">
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-r from-crimson via-crimson-dark to-crimson opacity-90"
             style={{ borderRadius: "0 0 50% 50% / 0 0 100% 100%" }} />
        {/* Gold trim on valance */}
        <div className="absolute bottom-2 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
      </div>

      {/* Reveal content behind curtains */}
      <motion.div 
        className="text-center z-0 max-w-3xl mx-auto px-6"
        style={{ opacity: textOpacity }}
      >
        <h2 className="font-display text-4xl md:text-6xl lg:text-7xl text-foreground tracking-[0.1em] uppercase mb-12">
          How It Works
        </h2>
        
        {/* Simple explanation */}
        <div className="space-y-8 text-lg md:text-xl leading-relaxed max-w-2xl mx-auto">
          <p className="text-muted-foreground">
            Think of your payroll data like a <span className="text-accent font-semibold">theatre performance</span>.
          </p>
          
          <p className="text-foreground/90">
            The audience knows the show happened—<br />
            but only backstage crew sees <span className="text-accent">behind the curtain</span>.
          </p>

          {/* Divider */}
          <div className="flex items-center justify-center gap-4 py-4">
            <div className="w-12 h-px bg-accent/40" />
            <span className="text-accent text-lg">◆</span>
            <div className="w-12 h-px bg-accent/40" />
          </div>

          <p className="text-foreground">
            CZKP uses zero-knowledge proofs to do the same for payroll.
          </p>
          
          <p className="text-muted-foreground">
            Auditors can verify that <span className="text-foreground">payments were processed correctly</span>—<br />
            without seeing <span className="text-accent">individual salaries</span>, <span className="text-accent">names</span>, or <span className="text-accent">accounts</span>.
          </p>

          <p className="text-foreground/80 mt-6">
            Need to share specific details? <span className="text-accent">Grant selective access</span>.<br />
            Each stakeholder sees exactly what's relevant to them.
          </p>

          <p className="text-foreground text-xl md:text-2xl font-display tracking-wide mt-8">
            Full compliance. <span className="text-accent">Complete privacy</span>.<br />
            No tradeoffs.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default VaultDoorTransition;
