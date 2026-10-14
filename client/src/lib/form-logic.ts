/**
 * Conditional questions: "show this question only if...".
 *
 * A field's showIf names an earlier question and a condition:
 *   is / is_not       the answer equals (or doesn't equal) a value; case and
 *                     extra spaces don't matter. Yes/No questions compare
 *                     "Yes" or "No".
 *   answered          the question has any answer
 *   not_answered      the question was left blank
 *
 * A question is only shown when its controlling question is itself shown,
 * so chains work ("Q3 if Q2 is Yes, Q2 if Q1 is Yes"). A condition pointing
 * at a deleted question is ignored (the question always shows).
 *
 * Hidden questions are skipped by validation and their answers aren't saved.
 */

import type { FormField } from "@/types/database";

export type ShowIfOperator = "is" | "is_not" | "answered" | "not_answered";

export interface ShowIf {
  fieldId: string;
  op: ShowIfOperator;
  value?: string;
}

export const SHOW_IF_OPERATORS: { value: ShowIfOperator; label: string; needsValue: boolean }[] = [
  { value: "is", label: "is", needsValue: true },
  { value: "is_not", label: "is not", needsValue: true },
  { value: "answered", label: "is answered", needsValue: false },
  { value: "not_answered", label: "is left blank", needsValue: false },
];

/** Question types that can control others (uploads can't). */
export const canControl = (f: Pick<FormField, "type">): boolean => !["image", "audio", "file", "section"].includes(f.type);

const norm = (v: unknown): string => {
  if (v === true) return "yes";
  if (v === false) return "no";
  if (Array.isArray(v)) return v.map(norm).join(", ");
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
};

const isBlank = (v: unknown) => v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);

/** Whether a field should be shown, given the answers so far. */
export function isFieldVisible(field: FormField, fields: FormField[], answers: Record<string, unknown>, depth = 0): boolean {
  const rule = field.showIf;
  if (!rule || depth > 20) return true;
  const controller = fields.find((f) => f.id === rule.fieldId);
  if (!controller || controller.id === field.id) return true;
  if (!isFieldVisible(controller, fields, answers, depth + 1)) return false;
  // An untouched Yes/No question counts as "No".
  const answer = controller.type === "checkbox" ? answers[controller.id] === true : answers[controller.id];
  switch (rule.op) {
    case "answered":
      return !isBlank(answer);
    case "not_answered":
      return isBlank(answer);
    case "is_not":
      return norm(answer) !== norm(rule.value);
    default:
      return norm(answer) === norm(rule.value);
  }
}

/** "Shown if Household size is answered" style summary for the builder. */
export function describeShowIf(rule: ShowIf, fields: FormField[]): string {
  const controller = fields.find((f) => f.id === rule.fieldId);
  if (!controller) return "Shown always (its question was removed)";
  const op = SHOW_IF_OPERATORS.find((o) => o.value === rule.op);
  return `Shown if "${controller.label || "Untitled question"}" ${op?.label ?? "is"}${op?.needsValue ? ` "${rule.value ?? ""}"` : ""}`;
}
