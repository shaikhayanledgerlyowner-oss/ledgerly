import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { BookOpen, Chrome } from "lucide-react";

export default function AuthPage() {
  const navigate = useNavigate();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      navigate("/dashboard");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: { emailRedirectTo: window.location.origin + "/auth/callback" },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setVerifyEmail(true);
      toast.success("Check your email to verify your account!");
    }
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/auth/callback",
      },
    });
    if (error) toast.error(error.message);
  };

  if (verifyEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md glass-card animate-fade-in">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary">
              <BookOpen className="h-8 w-8 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl font-display">Verify Your Email</CardTitle>
            <CardDescription>
              We've sent a verification link to <strong>{signupEmail}</strong>. Please check your inbox and click the link to activate your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => setVerifyEmail(false)}>
              Back to Login
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
            <BookOpen className="h-8 w-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-display">Welcome to Ledgerly</CardTitle>
          <CardDescription>Smart ledger, invoicing & billing tools</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="mb-6 w-full gap-2"
            onClick={handleGoogleLogin}
          >
            <Chrome className="h-4 w-4" />
            Continue with Google
          </Button>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
            </div>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input id="login-email" type="email" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@example.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input id="login-password" type="password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" type="email" required value={signupEmail} onChange={e => setSignupEmail(e.target.value)} placeholder="you@example.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input id="signup-password" type="password" required minLength={6} value={signupPassword} onChange={e => setSignupPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Creating account..." : "Create Account"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
