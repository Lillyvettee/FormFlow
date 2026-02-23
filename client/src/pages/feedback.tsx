import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, MessageSquare, Bug, Lightbulb, Heart } from "lucide-react";

const FEEDBACK_TYPES = [
  { value: "bug", label: "🐛 Bug Report", icon: Bug },
  { value: "feedback", label: "💬 General Feedback", icon: MessageSquare },
  { value: "feature", label: "💡 Feature Request", icon: Lightbulb },
  { value: "other", label: "❤️ Other", icon: Heart },
];

export default function FeedbackPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [type, setType] = useState("feedback");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !subject.trim()) return;
    setIsSubmitting(true);

    const { error } = await supabase.from("feedback").insert({
      user_id: user?.id ?? null,
      email: email.trim(),
      type,
      subject: subject.trim(),
      message: message.trim(),
    });

    setIsSubmitting(false);
    if (error) {
      toast({ title: "Error sending feedback", description: error.message, variant: "destructive" });
    } else {
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="p-6 max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
        <div className="h-16 w-16 rounded-full bg-chart-2/10 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-chart-2" />
        </div>
        <h2 className="text-2xl font-serif font-bold">Thank you!</h2>
        <p className="text-muted-foreground">Your feedback has been received. We read every submission and use it to improve FormFlow.</p>
        <Button variant="outline" onClick={() => { setSubmitted(false); setSubject(""); setMessage(""); setType("feedback"); }}>
          Send Another
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold">Feedback & Contact</h1>
        <p className="text-muted-foreground">Report a bug, suggest a feature, or just say hello</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {FEEDBACK_TYPES.map((ft) => (
          <button
            key={ft.value}
            onClick={() => setType(ft.value)}
            className={`p-3 rounded-md border text-sm font-medium transition-colors text-center ${
              type === ft.value ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/50"
            }`}
          >
            {ft.label}
          </button>
        ))}
      </div>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Your Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@organization.org" />
          </div>
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={
              type === "bug" ? "Describe the bug briefly..." :
              type === "feature" ? "What would you like to see?" :
              "What's on your mind?"
            } />
          </div>
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                type === "bug"
                  ? "Steps to reproduce the bug:\n1. Go to...\n2. Click...\n3. See error..."
                  : type === "feature"
                  ? "Describe the feature and how it would help your organization..."
                  : "Tell us more..."
              }
              className="min-h-[150px]"
            />
          </div>
          <Button type="submit" className="w-full" disabled={!subject.trim() || !message.trim() || isSubmitting}>
            {isSubmitting ? "Sending..." : "Send Feedback"}
          </Button>
        </form>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        We typically respond within 1-2 business days. For urgent issues, include "URGENT" in your subject.
      </p>
    </div>
  );
}
