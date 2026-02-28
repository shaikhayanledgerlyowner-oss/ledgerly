import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "@/components/DashboardLayout";

import Index from "./pages/Index";
import AuthPage from "./pages/AuthPage";
import AuthCallback from "./pages/AuthCallback";
import DashboardHome from "./pages/DashboardHome";
import TablesPage from "./pages/TablesPage";
import InvoicesPage from "./pages/InvoicesPage";
import PricingPage from "./pages/PricingPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import NotificationsPage from "./pages/NotificationsPage";
import WalletPage from "./pages/Walletpage";
import SettingsPage from "./pages/SettingsPage";
import VerificationPage from "./pages/VerificationPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardHome />} />
              <Route path="tables" element={<TablesPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="pricing" element={<PricingPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="wallet" element={<WalletPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="verification" element={<VerificationPage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
