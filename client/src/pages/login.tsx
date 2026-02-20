import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ThemeToggle } from "@/components/theme-toggle";
import { Heart, ArrowRight, Eye, EyeOff, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState("");

  const formValid = email.trim() && password;

  const loginMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/auth/login", {
        email: email.trim(),
        password,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setServerError("");
      window.location.href = "/";
    },
    onError: (error: Error) => {
      const msg = error.message.replace(/^\d+:\s*/, "");
      setServerError(msg);
    },
  });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="h-10 w-10 rounded-md bg-primary flex items-center justify-center mx-auto">
            <Heart className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-login-title">Welcome back</h1>
          <p className="text-muted-foreground text-sm">Sign in to your FormFlow account</p>
        </div>

        <Card className="p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (formValid) loginMutation.mutate();
            }}
            className="space-y-4"
          >
            {serverError && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-login-error">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@organization.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                data-testid="input-email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  data-testid="input-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={!formValid || loginMutation.isPending}
              data-testid="button-login"
            >
              {loginMutation.isPending ? "Signing in..." : "Sign In"}
              {!loginMutation.isPending && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <a href="/signup" className="text-foreground font-medium hover:underline" data-testid="link-signup">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
