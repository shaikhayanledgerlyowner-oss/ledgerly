import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/dashboard", { replace: true });
      } else {
        // Hash fragment handle karo
        supabase.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_IN" && session) {
            navigate("/dashboard", { replace: true });
          } else if (event === "SIGNED_OUT") {
            navigate("/auth", { replace: true });
          }
        });
      }
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground animate-pulse">
        Completing sign in...
      </p>
    </div>
  );
}
