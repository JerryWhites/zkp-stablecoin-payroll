import { motion, useInView, AnimatePresence } from "framer-motion";
import { useRef, useEffect, useState } from "react";

const phases = [
  { label: "Initiating transfer...", duration: 1.5 },
  { label: "Encrypting data...", duration: 1.5 },
  { label: "In transit (encrypted)", duration: 2 },
  { label: "Verifying proof...", duration: 1.5 },
  { label: "Transfer complete", duration: 1.5 },
];

const TOTAL_DURATION = 8; // seconds
const PAUSE_DURATION = 2; // seconds between loops

const CYCLE_DURATION = 8000; // 8 seconds per cycle
const PAUSE_BETWEEN = 2000; // 2 seconds pause between cycles
const TOTAL_CYCLES = 3;

const MoneyTransferAnimation = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: "-50px" });
  const [currentPhase, setCurrentPhase] = useState(0);
  const [animationKey, setAnimationKey] = useState(0);
  const hasStarted = useRef(false);
  const cycleCount = useRef(0);

  useEffect(() => {
    if (!isInView || hasStarted.current) {
      return;
    }

    hasStarted.current = true;

    const runCycle = () => {
      setAnimationKey((prev) => prev + 1);
      setCurrentPhase(0);

      const phaseTimings = [0, 1500, 3000, 5000, 6500];
      const timers: NodeJS.Timeout[] = [];

      phaseTimings.forEach((timing, index) => {
        const timer = setTimeout(() => {
          setCurrentPhase(index);
        }, timing);
        timers.push(timer);
      });

      return timers;
    };

    let allTimers: NodeJS.Timeout[] = [];
    
    // Run first cycle immediately
    allTimers.push(...runCycle());
    cycleCount.current = 1;

    // Schedule remaining cycles
    for (let i = 1; i < TOTAL_CYCLES; i++) {
      const cycleDelay = i * (CYCLE_DURATION + PAUSE_BETWEEN);
      const cycleTimer = setTimeout(() => {
        allTimers.push(...runCycle());
        cycleCount.current = i + 1;
      }, cycleDelay);
      allTimers.push(cycleTimer);
    }

    return () => {
      allTimers.forEach(clearTimeout);
    };
  }, [isInView]);

  // Calculate orb position based on phase (0-4)
  const getOrbPosition = () => {
    switch (currentPhase) {
      case 0: return 0; // At source
      case 1: return 15; // Starting to move
      case 2: return 50; // Middle (transit)
      case 3: return 85; // Near destination
      case 4: return 100; // At destination
      default: return 0;
    }
  };

  // Scrambled amount display for encryption phase
  const getAmountDisplay = () => {
    if (currentPhase === 0) return "$5,000";
    if (currentPhase === 1) return "$█,███";
    if (currentPhase === 2 || currentPhase === 3) return "██████";
    if (currentPhase === 4) return "$5,000";
    return "";
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-lg mx-auto py-8">
      {/* Main transfer visualization */}
      <div className="relative h-32 flex items-center">
        {/* Source Node */}
        <motion.div
          className="absolute left-0 flex flex-col items-center z-10"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.5 }}
        >
          <div className="w-16 h-16 border border-border bg-card flex flex-col items-center justify-center relative">
            {/* Corner accents */}
            <div className="absolute -top-px -left-px w-3 h-3 border-t border-l border-accent" />
            <div className="absolute -top-px -right-px w-3 h-3 border-t border-r border-accent" />
            <div className="absolute -bottom-px -left-px w-3 h-3 border-b border-l border-accent" />
            <div className="absolute -bottom-px -right-px w-3 h-3 border-b border-r border-accent" />
            
            <span className="text-accent text-[10px] tracking-[0.2em] font-mono">ACME</span>
            <span className="text-muted-foreground text-[8px] tracking-wider">CORP</span>
          </div>
          <span className="mt-2 text-[10px] text-muted-foreground font-mono tracking-wider">SOURCE</span>
        </motion.div>

        {/* Destination Node */}
        <motion.div
          className="absolute right-0 flex flex-col items-center z-10"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="w-16 h-16 border border-border bg-card flex flex-col items-center justify-center relative">
            {/* Corner accents */}
            <div className="absolute -top-px -left-px w-3 h-3 border-t border-l border-accent" />
            <div className="absolute -top-px -right-px w-3 h-3 border-t border-r border-accent" />
            <div className="absolute -bottom-px -left-px w-3 h-3 border-b border-l border-accent" />
            <div className="absolute -bottom-px -right-px w-3 h-3 border-b border-r border-accent" />
            
            <span className="text-accent text-[10px] tracking-[0.2em] font-mono">PAYEE</span>
            <span className="text-muted-foreground text-[8px] tracking-wider">DST</span>
          </div>
          <span className="mt-2 text-[10px] text-muted-foreground font-mono tracking-wider">DESTINATION</span>
        </motion.div>

        {/* Connection line with dashes */}
        <div className="absolute left-20 right-20 top-1/2 -translate-y-1/2 h-px">
          <div className="w-full h-full border-t border-dashed border-border" />
          {/* Glow line overlay for active transfer */}
          {isInView && currentPhase >= 1 && currentPhase <= 3 && (
            <motion.div
              className="absolute inset-0 h-px bg-gradient-to-r from-accent/50 via-accent to-accent/50"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 0.5 }}
              transition={{ duration: 0.5 }}
              style={{ transformOrigin: "left" }}
            />
          )}
        </div>

        {/* Animated Transfer Orb */}
        {isInView && (
          <motion.div
            key={`orb-${animationKey}`}
            className="absolute top-1/2 z-20"
            initial={{ left: "80px" }}
            style={{ y: "-50%" }}
            animate={{
              left: currentPhase === 0 ? "80px" : 
                    currentPhase === 1 ? "120px" : 
                    currentPhase === 2 ? "calc(50% - 12px)" : 
                    currentPhase === 3 ? "calc(100% - 140px)" : 
                    "calc(100% - 104px)",
            }}
            transition={{
              type: "tween",
              duration: 1.4,
              ease: [0.4, 0, 0.2, 1],
            }}
          >
            {/* The orb itself */}
            <motion.div
              className="relative"
              animate={{
                scale: currentPhase === 4 ? [1, 1.2, 1] : 1,
              }}
              transition={{ duration: 0.3 }}
            >
              {/* Outer glow */}
              <div 
                className={`absolute inset-0 rounded-full blur-md transition-colors duration-500 ${
                  currentPhase >= 1 && currentPhase <= 3 
                    ? "bg-accent/40" 
                    : "bg-accent/20"
                }`}
                style={{ width: 24, height: 24, margin: -4 }}
              />
              
              {/* Inner orb */}
              <div 
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all duration-500 ${
                  currentPhase >= 1 && currentPhase <= 3
                    ? "bg-gradient-to-br from-accent to-crimson-dark"
                    : "bg-gradient-to-br from-accent/80 to-accent"
                }`}
              >
                {currentPhase === 4 ? (
                  <span className="text-accent-foreground text-xs">✓</span>
                ) : currentPhase >= 1 && currentPhase <= 3 ? (
                  <span className="text-accent-foreground text-[8px]">●</span>
                ) : (
                  <span className="text-accent-foreground text-[10px]">◇</span>
                )}
              </div>

              {/* Amount label above orb */}
              <motion.div
                className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                key={`amount-${currentPhase}`}
              >
                <span 
                  className={`text-[11px] font-mono tracking-wide transition-colors duration-300 ${
                    currentPhase >= 1 && currentPhase <= 3 
                      ? "text-muted-foreground" 
                      : "text-accent"
                  }`}
                >
                  {getAmountDisplay()}
                </span>
              </motion.div>
            </motion.div>
          </motion.div>
        )}

        {/* Checkmark at destination when complete */}
        <AnimatePresence>
          {currentPhase === 4 && (
            <motion.div
              className="absolute right-0 top-0 z-30"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ duration: 0.3, type: "spring" }}
            >
              <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                <span className="text-accent-foreground text-[10px]">✓</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Phase indicator and label */}
      <div className="mt-6 text-center">
        {/* Phase dots */}
        <div className="flex items-center justify-center gap-2 mb-3">
          {phases.map((_, index) => (
            <motion.div
              key={index}
              className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                index === currentPhase
                  ? "bg-accent"
                  : index < currentPhase
                  ? "bg-accent/50"
                  : "bg-border"
              }`}
              animate={{
                scale: index === currentPhase ? 1.2 : 1,
              }}
            />
          ))}
        </div>

        {/* Current phase label */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPhase}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="h-6"
          >
            <span className="text-sm font-mono text-muted-foreground tracking-wide">
              {phases[currentPhase]?.label || ""}
            </span>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Document-style border decoration */}
      <div className="absolute -inset-4 border border-dashed border-border/30 pointer-events-none" />
      <div className="absolute -top-4 left-4 px-2 bg-background">
        <span className="text-[9px] text-muted-foreground font-mono tracking-widest">TRANSFER PROTOCOL</span>
      </div>
    </div>
  );
};

export default MoneyTransferAnimation;
