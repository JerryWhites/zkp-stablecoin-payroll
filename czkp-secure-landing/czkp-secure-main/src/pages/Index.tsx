import Navbar from "@/components/landing/Navbar";
import HeroSection from "@/components/landing/HeroSection";
import VaultDoorTransition from "@/components/landing/VaultDoorTransition";
import FeaturesSection from "@/components/landing/FeaturesSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import QuoteSection from "@/components/landing/QuoteSection";
import Footer from "@/components/landing/Footer";

const Index = () => {
  return (
    <div className="landing-page min-h-screen bg-background grain-overlay overflow-x-hidden">
      <Navbar />
      <main>
        <HeroSection />
        <VaultDoorTransition />
        <FeaturesSection />
        <HowItWorksSection />
        <QuoteSection />
        <Footer />
      </main>
    </div>
  );
};

export default Index;
