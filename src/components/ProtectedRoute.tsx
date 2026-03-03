import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: ReactNode;
  requirePremium?: boolean;
}

export default function ProtectedRoute({ children, requirePremium = false }: ProtectedRouteProps) {
  const { user, loading, isOwner, isPremium, isTrialActive } = useAuth();

  // ⏳ Still loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // 🔒 Not logged in
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // ✅ Owner has full access always
  if (isOwner) {
    return <>{children}</>;
  }

  // ✅ Access allowed if: premium active OR trial active
  const hasAccess = isPremium || isTrialActive;

  // 🔒 Trial expired AND not premium → redirect to pricing
  if (!hasAccess) {
    return <Navigate to="/pricing" replace />;
  }

  // 🔒 Premium-only route but user only has trial
  if (requirePremium && !isPremium) {
    return <Navigate to="/pricing" replace />;
  }

  return <>{children}</>;
}
