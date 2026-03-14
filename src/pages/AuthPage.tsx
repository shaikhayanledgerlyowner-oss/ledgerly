import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { BookOpen, Chrome, Loader2 } from "lucide-react";

export default function AuthPage() {
  const navigate = useNavigate();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/dashboard", { replace: true });
    });
  }, []);

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword) return toast.error("Email aur password dono zaroori hain");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    setLoading(false);
    if (error) toast.error(error.message);
    else navigate("/dashboard", { replace: true });
  };

  const handleSignup = async () => {
    if (!signupEmail.trim()) return toast.error("Email daalo");
    if (signupPassword.length < 6) return toast.error("Password kam se kam 6 characters ka hona chahiye");
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: signupEmail.trim(),
      password: signupPassword,
      options: { emailRedirectTo: window.location.origin + "/auth/callback" },
    });
    setLoading(false);
    if (error) toast.error(error.message);
    else {
      setVerifyEmail(true);
      toast.success("Check your email to verify your account!");
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/auth/callback" },
    });
    if (error) { toast.error(error.message); setGoogleLoading(false); }
  };

  if (verifyEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md glass-card animate-fade-in">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary">
              <BookOpen className="h-8 w-8 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl font-display">Email verify karo</CardTitle>
            <CardDescription>
              Humne <strong>{signupEmail}</strong> pe ek verification link bheja hai. Inbox check karo aur link pe click karo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => setVerifyEmail(false)}>
              Wapas Login pe
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md glass-card animate-fade-in">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary">
            <BookOpen className="h-8 w-8 text-primary-foreground" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl font-display">Welcome to Ledgerly</CardTitle>
          <CardDescription>Smart ledger, GST invoicing & billing tools</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="mb-6 w-full gap-2"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            aria-label="Google se login karo"
          >
            {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Chrome className="h-4 w-4" />}
            Continue with Google
          </Button>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Ya email se</span>
            </div>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleLogin()}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleLogin()}
                    placeholder="••••••••"
                  />
                </div>
                <Button className="w-full" onClick={handleLogin} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="signup">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={signupEmail}
                    onChange={e => setSignupEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={signupPassword}
                    onChange={e => setSignupPassword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSignup()}
                    placeholder="••••••••"
                  />
                  <p className="text-xs text-muted-foreground">Kam se kam 6 characters</p>
                </div>
                <Button className="w-full" onClick={handleSignup} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {loading ? "Creating account..." : "Create Account — Free Trial"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
