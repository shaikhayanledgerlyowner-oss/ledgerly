import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BookOpen, ArrowRight, Table2, FileText, Shield, Zap } from "lucide-react";
import { motion } from "framer-motion";

const features = [
  { icon: Table2, title: "Smart Ledger", desc: "Excel-like tables with search, filter, and easy count" },
  { icon: FileText, title: "Professional Documents", desc: "Create invoices, quotations, and bills with PDF export" },
  { icon: Shield, title: "Secure & Private", desc: "Your data is encrypted and never shared between users" },
  { icon: Zap, title: "Fast & Simple", desc: "Designed for beginners — no formulas needed" },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 md:px-12">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
            <BookOpen className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-display font-bold">Ledgerly</span>
        </div>
        <Button onClick={() => navigate("/auth")} variant="outline">Sign In</Button>
      </header>

      {/* Hero */}
      <section className="px-6 py-20 text-center md:py-32 md:px-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl"
        >
          <h1 className="text-4xl font-display font-extrabold leading-tight md:text-6xl">
            Your Business,{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Simplified
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Smart ledger, invoicing, quotations, bills, and PDF tools — all in one beautifully simple app built for small businesses.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Button size="lg" className="gap-2" onClick={() => navigate("/auth")}>
              Get Started Free <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="px-6 pb-20 md:px-12">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 * i }}
              className="glass-card rounded-xl p-6"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-6 py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Ledgerly. All rights reserved.
      </footer>
    </div>
  );
}
