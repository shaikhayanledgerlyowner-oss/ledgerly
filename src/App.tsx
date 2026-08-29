
Action: view_file({"path":"/app/frontend/src/App.tsx"})
Observation: [Showing lines 1-60 of 60 total] /app/frontend/src/App.tsx:
1|import { Toaster } from "@/components/ui/toaster";
2|import { Toaster as Sonner } from "@/components/ui/sonner";
3|import { TooltipProvider } from "@/components/ui/tooltip";
4|import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
5|import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
6|import { AuthProvider } from "@/contexts/AuthContext";
7|import ProtectedRoute from "@/components/ProtectedRoute";
8|import DashboardLayout from "@/components/DashboardLayout";
9|import { Analytics } from "@vercel/analytics/react";
10|import Index from "./pages/Index";
11|import AuthPage from "./pages/AuthPage";
12|import AuthCallback from "./pages/AuthCallback";
13|import DashboardHome from "./pages/DashboardHome";
14|import TablesPage from "./pages/TablesPage";
15|import InvoicesPage from "./pages/InvoicesPage";
16|import PricingPage from "./pages/PricingPage";
17|import AnalyticsPage from "./pages/AnalyticsPage";
18|import WalletPage from "./pages/Walletpage";
19|import SettingsPage from "./pages/SettingsPage";
20|import NotFound from "./pages/NotFound";
21|import DocumentEditorPage from "./pages/DocumentEditorPage";
22|
23|const queryClient = new QueryClient();
24|
25|const App = () => (
26|  <QueryClientProvider client={queryClient}>
27|    <TooltipProvider>
28|      <Toaster />
29|      <Sonner />
30|      <Analytics />
31|      <BrowserRouter>
32|        <AuthProvider>
33|          <Routes>
34|            <Route path="/" element={<Index />} />
35|            <Route path="/auth" element={<AuthPage />} />
36|            <Route path="/auth/callback" element={<AuthCallback />} />
37|            <Route path="/dashboard" element={
38|              <ProtectedRoute>
39|                <DashboardLayout />
40|              </ProtectedRoute>
41|            }>
42|              <Route index element={<DashboardHome />} />
43|              <Route path="tables" element={<TablesPage />} />
44|              <Route path="analytics" element={<AnalyticsPage />} />
45|              <Route path="invoices" element={<InvoicesPage />} />
46|              <Route path="pricing" element={<PricingPage />} />
47|              <Route path="wallet" element={<WalletPage />} />
48|              <Route path="settings" element={<SettingsPage />} />
49|              <Route path="document-editor" element={<DocumentEditorPage />} />
50|            </Route>
51|            <Route path="*" element={<NotFound />} />
52|          </Routes>
53|        </AuthProvider>
54|      </BrowserRouter>
55|    </TooltipProvider>
56|  </QueryClientProvider>
57|);
58|
59|export default App;
60|
[End of file]
