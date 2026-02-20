import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ThemeToggle } from "@/components/theme-toggle";
import { Heart, ArrowRight, Check, Eye, EyeOff, AlertCircle } from "lucide-react";

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "At least 8 characters", valid: password.length >= 8 },
    { label: "Uppercase letter", valid: /[A-Z]/.test(password) },
    { label: "Lowercase letter", valid: /[a-z]/.test(password) },
    { label: "Number", valid: /\d/.test(password) },
  ];
  const passed = checks.filter((c) => c.valid).length;

  if (!password) return null;

  return (
    <div className="space-y-2 mt-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= passed
                ? passed <= 1
                  ? "bg-destructive"
                  : passed <= 2
                    ? "bg-chart-4"
                    : passed <= 3
                      ? "bg-chart-2"
                      : "bg-chart-2"
                : "bg-muted"
            }`}
          />
        ))}
      </div>
      <div className="space-y-0.5">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-1.5 text-xs">
            {check.valid ? (
              <Check className="h-3 w-3 text-chart-2" />
            ) : (
              <AlertCircle className="h-3 w-3 text-muted-foreground" />
            )}
            <span className={check.valid ? "text-chart-2" : "text-muted-foreground"}>{check.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SignupPage() {
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [step, setStep] = useState<"register" | "plan">("register");
  const [serverError, setServerError] = useState("");

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const passwordValid =
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password);
  const passwordsMatch = password === confirmPassword;
  const formValid = firstName.trim() && lastName.trim() && emailValid && passwordValid && passwordsMatch;

  const registerMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/auth/register", {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        confirmPassword,
        companyName: companyName.trim() || null,
        phone: phone.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setServerError("");
      setStep("plan");
    },
    onError: (error: Error) => {
      setServerError(error.message.replace(/^\d+:\s*/, ""));
    },
  });

  const planMutation = useMutation({
    mutationFn: async (plan: string) => {
      return apiRequest("POST", "/api/subscription", { plan });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      toast({ title: "Welcome to FormFlow!" });
      window.location.href = "/";
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (step === "plan") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-2xl space-y-8">
          <div className="text-center space-y-2">
            <div className="h-10 w-10 rounded-md bg-primary flex items-center justify-center mx-auto">
              <Heart className="h-5 w-5 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-serif font-bold" data-testid="text-plan-title">Choose Your Plan</h1>
            <p className="text-muted-foreground">Select a plan to get started with FormFlow</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Card
              className={`p-6 cursor-pointer hover-elevate`}
              onClick={() => planMutation.mutate("monthly")}
              data-testid="card-plan-monthly"
            >
              <h3 className="font-semibold text-lg">Starter</h3>
              <p className="text-3xl font-bold mt-2">
                $5<span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-sm text-muted-foreground mt-2">Billed monthly, cancel anytime</p>
              <ul className="mt-4 space-y-1.5 text-sm">
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Unlimited forms & surveys</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Impact reports & CSV export</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Resource tracking</li>
              </ul>
              <Button className="w-full mt-5" disabled={planMutation.isPending} data-testid="button-select-monthly">
                {planMutation.isPending ? "Processing..." : "Select Starter"}
              </Button>
            </Card>
            <Card
              className={`p-6 cursor-pointer hover-elevate`}
              onClick={() => planMutation.mutate("yearly")}
              data-testid="card-plan-yearly"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-lg">Mission</h3>
                <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-md">Save 40%</span>
              </div>
              <p className="text-3xl font-bold mt-2">
                $3<span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-sm text-muted-foreground mt-2">Billed $36/year</p>
              <ul className="mt-4 space-y-1.5 text-sm">
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Everything in Starter</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Priority support</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Custom organization branding</li>
              </ul>
              <Button className="w-full mt-5" disabled={planMutation.isPending} data-testid="button-select-yearly">
                {planMutation.isPending ? "Processing..." : "Select Mission"}
              </Button>
            </Card>
          </div>
        </div>
      </div>
    );
  }

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
          <h1 className="text-2xl font-serif font-bold" data-testid="text-signup-title">Create your account</h1>
          <p className="text-muted-foreground text-sm">Start collecting data and amplifying your mission</p>
        </div>

        <Card className="p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (formValid) registerMutation.mutate();
            }}
            className="space-y-4"
          >
            {serverError && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-signup-error">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="first-name">First Name</Label>
                <Input
                  id="first-name"
                  placeholder="Jane"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last-name">Last Name</Label>
                <Input
                  id="last-name"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  data-testid="input-last-name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@organization.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-email"
              />
              {email && !emailValid && (
                <p className="text-xs text-destructive">Please enter a valid email address</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
              <PasswordStrength password={password} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  data-testid="input-confirm-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  tabIndex={-1}
                  data-testid="button-toggle-confirm-password"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {confirmPassword && !passwordsMatch && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="company">Organization Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="company"
                placeholder="Your non-profit name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                data-testid="input-company"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-testid="input-phone"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={!formValid || registerMutation.isPending}
              data-testid="button-create-account"
            >
              {registerMutation.isPending ? "Creating Account..." : "Create Account"}
              {!registerMutation.isPending && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href="/login" className="text-foreground font-medium hover:underline" data-testid="link-login">
            Log in
          </a>
        </p>
      </div>
    </div>
  );
}
