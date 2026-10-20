/**
 * BillingCycleToggle
 *
 * Monthly / Yearly switch above the pricing cards on the landing page and in
 * Settings > Plan. Yearly shows the discount from lib/plans.
 */

import { YEARLY_DISCOUNT_PERCENT, type BillingCycle } from "@/lib/plans";

export function BillingCycleToggle({
  value,
  onChange,
  className = "",
}: {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  className?: string;
}) {
  const option = (cycle: BillingCycle, label: string, extra?: string) => (
    <button
      type="button"
      aria-pressed={value === cycle}
      onClick={() => onChange(cycle)}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        value === cycle ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
      data-testid={`button-cycle-${cycle}`}
    >
      {label}
      {extra && <span className="ml-1.5 text-xs font-semibold text-primary">{extra}</span>}
    </button>
  );

  return (
    <div role="group" aria-label="Billing period" className={`inline-flex items-center gap-1 rounded-full bg-muted p-1 ${className}`}>
      {option("monthly", "Monthly")}
      {option("yearly", "Yearly", `Save ${YEARLY_DISCOUNT_PERCENT}%`)}
    </div>
  );
}
