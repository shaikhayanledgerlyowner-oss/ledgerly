import { Routes, Route } from "react-router-dom";
import DashboardHome from "./DashboardHome";
import AnalyticsPage from "./AnalyticsPage";
import DocumentEditorPage from "./DocumentEditorPage";
import EasyCountPage from "./EasyCountPage";
import InvoicesPage from "./InvoicesPage";
import PricingPage from "./PricingPage";
import SettingsPage from "./SettingsPage";
import TablesPage from "./TablesPage";
import WalletPage from "./Walletpage";
import NotFound from "./NotFound";

export default function DashboardLayout() {
  return (
    <Routes>
      <Route path="/" element={<DashboardHome />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
      <Route path="/documents" element={<DocumentEditorPage />} />
      <Route path="/easycount" element={<EasyCountPage />} />
      <Route path="/invoices" element={<InvoicesPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/tables" element={<TablesPage />} />
      <Route path="/wallet" element={<WalletPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
