/**
 * People, personal form links and outcome results (migration 010).
 *
 * A personal link is a form's normal address plus the person's token:
 * /forms/<form id>/submit?p=<token>. Responses sent through it are attached
 * to that person by the database, which never stores the token on the
 * response.
 *
 * Outcomes are worked out by the database (outcome_summary), so the Reports
 * page and funder portals always agree.
 */

import { supabase } from "@/lib/supabase";
import type { FormField } from "@/types/database";

export const PERSON_LINK_PARAM = "p";

export const personalFormLink = (formId: string, token: string): string =>
  `${window.location.origin}/forms/${formId}/submit?${PERSON_LINK_PARAM}=${encodeURIComponent(token)}`;

/** 64 random hex characters, like the database's random_token(). */
export const newAccessToken = (): string =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");

/** Question types that can be outcomes. */
export const canBeOutcome = (field: Pick<FormField, "type">): boolean => field.type === "number" || field.type === "select";

/** A person's score on an outcome question, or null. Dropdowns score by position (first option = 1). */
export const outcomeScore = (field: FormField, value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  if (field.type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === "select") {
    const i = (field.options ?? []).indexOf(String(value));
    return i >= 0 ? i + 1 : null;
  }
  return null;
};

export interface OutcomeResult {
  form_id: string;
  form_title: string;
  field_id: string;
  label: string;
  kind: "number" | "scale";
  better_when: "higher" | "lower";
  /** Dropdown options, in score order (first = 1). */
  options: string[];
  people_measured: number;
  people_with_followup: number;
  average_first: number | null;
  average_latest: number | null;
  improved: number;
  same: number;
  worse: number;
  trend: { month: string; average: number }[];
}

/** Normalizes the database's numbers (which can arrive as strings). */
export const parseOutcomes = (raw: unknown): OutcomeResult[] =>
  (Array.isArray(raw) ? raw : []).map((o) => ({
    ...o,
    options: Array.isArray(o.options) ? o.options : [],
    people_measured: Number(o.people_measured) || 0,
    people_with_followup: Number(o.people_with_followup) || 0,
    average_first: o.average_first == null ? null : Number(o.average_first),
    average_latest: o.average_latest == null ? null : Number(o.average_latest),
    improved: Number(o.improved) || 0,
    same: Number(o.same) || 0,
    worse: Number(o.worse) || 0,
    trend: (Array.isArray(o.trend) ? o.trend : []).map((t: { month: string; average: unknown }) => ({ month: t.month, average: Number(t.average) })),
  }));

/** Outcomes for the signed-in member's organization. Throws if migration 010 hasn't been run. */
export async function fetchOutcomes(from: string, to: string): Promise<OutcomeResult[]> {
  const { data, error } = await supabase.rpc("get_outcome_summary", { p_from: from || null, p_to: to || null });
  if (error) throw error;
  return parseOutcomes(data);
}

/** "3.2 (Sometimes)" for scales, "3.2" for numbers. */
export const formatScore = (o: Pick<OutcomeResult, "kind" | "options">, value: number | null): string => {
  if (value == null) return "-";
  const rounded = Math.round(value * 10) / 10;
  if (o.kind === "scale" && o.options.length) {
    const nearest = o.options[Math.min(o.options.length, Math.max(1, Math.round(value))) - 1];
    return `${rounded} (${nearest})`;
  }
  return rounded.toLocaleString("en-US");
};

/** Share of people measured more than once who improved, as a whole percent. */
export const improvedPercent = (o: Pick<OutcomeResult, "improved" | "people_with_followup">): number | null =>
  o.people_with_followup ? Math.round((o.improved / o.people_with_followup) * 100) : null;

/** "2026-03" -> "Mar 26" */
export const monthLabel = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};
