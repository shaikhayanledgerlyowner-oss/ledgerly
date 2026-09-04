import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import AuthPage from "./pages/AuthPage";
import AuthCallback from "./pages/AuthCallback";
import NotFound from "./pages/NotFound";
import DashboardLayout from "@/components/DashboardLayout";
import DashboardHome from "./pages/DashboardHome";
import AnalyticsPage from "./pages/AnalyticsPage";
import DocumentEditorPage from "./pages/DocumentEditorPage";
import EasyCountPage from "./pages/EasyCountPage";
import InvoicesPage from "./pages/InvoicesPage";
import PricingPage from "./pages/PricingPage";
import SettingsPage from "./pages/SettingsPage";
import TablesPage from "./pages/TablesPage";
import WalletPage from "./pages/Walletpage";

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
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="document-editor" element={<DocumentEditorPage />} />
              <Route path="easycount" element={<EasyCountPage />} />
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="pricing" element={<PricingPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="tables" element={<TablesPage />} />
              <Route path="wallet" element={<WalletPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
