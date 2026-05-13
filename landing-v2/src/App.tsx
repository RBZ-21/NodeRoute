import { useState } from 'react';
import { Comparison } from './components/Comparison';
import { EarlyAccess } from './components/EarlyAccess';
import { FAQ } from './components/FAQ';
import { FinalCTA } from './components/FinalCTA';
import { Footer } from './components/Footer';
import { Founder } from './components/Founder';
import { Hero } from './components/Hero';
import { HowItWorks } from './components/HowItWorks';
import { Nav } from './components/Nav';
import { Problem } from './components/Problem';
import { SignupGate } from './components/SignupGate';
import { Solution } from './components/Solution';
import { WhoItsFor } from './components/WhoItsFor';

export function App() {
  const [showSignup, setShowSignup] = useState(false);

  return (
    <div className="relative min-h-screen bg-ink-0">
      {showSignup && <SignupGate onClose={() => setShowSignup(false)} />}
      <Nav onSignupClick={() => setShowSignup(true)} />
      <main>
        <Hero onSignupClick={() => setShowSignup(true)} />
        <Problem />
        <Solution />
        <Comparison />
        <HowItWorks />
        <WhoItsFor />
        <Founder />
        <EarlyAccess />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
