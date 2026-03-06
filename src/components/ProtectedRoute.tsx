import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );

  // PinLock already handles showing PIN screen if not logged in
  // Don't redirect — just return null, PinLock will show login
  if (!user) return null;

  return <>{children}</>;
}
