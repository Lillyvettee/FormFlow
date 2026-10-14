/**
 * The Form Submissions tab of the Reports page.
 *
 *   FormsOverview  every form's responses in the period, with comparisons
 *   FormReport     one form: a summary for every question, written answers,
 *                  uploaded photos and voice memos, and a table of responses
 *                  that opens any single response in full
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  answeredCount,
  answerFields,
  buildTimeSeries,
  CHOICE_FIELD_TYPES,
  formatAnswer,
  formatChange,
  formatCount,
  formatDate,
  getAnswer,
  granularityLabel,
  isBlank,
  mediaUrl,
  MEDIA_FIELD_TYPES,
  percentChange,
  shorten,
  submittedDate,
  summarizeChoices,
  summarizeNumbers,
  TEXT_FIELD_TYPES,
  toISODate,
  type Granularity,
} from "@/lib/report-utils";
import { ChartCard, DonutChart, EmptyChart, RankedBarChart, StatGrid, TimeSeriesChart } from "@/components/reports/report-ui";
import { useFileLink } from "@/lib/uploads";
import { Eye, FileAudio, Image as ImageIcon, Paperclip, Search } from "lucide-react";
import type { Form, FormField, FormSubmission } from "@/types/database";

/** Tables and lists show at most this many rows on screen; exports include everything. */
export const MAX_TABLE_ROWS = 200;
const WRITTEN_ANSWERS_SHOWN = 50;
const PHOTOS_SHOWN = 12;
const AUDIO_SHOWN = 6;

export const fieldsOf = (form: Form | undefined): FormField[] => answerFields(form?.fields as FormField[] | null);

/**
 * "View photo" / "Play" style link for an uploaded file. Private files get a
 * link that works for an hour, made when it's shown (lib/uploads.ts).
 */
function MediaLink({ field, url: value }: { field: FormField; url: string }) {
  const { url, failed } = useFileLink(value);
  const Icon = field.type === "image" ? ImageIcon : field.type === "audio" ? FileAudio : Paperclip;
  const label = field.type === "image" ? "View photo" : field.type === "audio" ? "Play recording" : "Open file";
  if (!url) return <span className="text-xs text-muted-foreground">{failed ? "File unavailable" : "Loading..."}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary underline underline-offset-4 hover:no-underline"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </a>
  );
}

/** A photo that opens full size; private photos load through a short-lived link. */
function PhotoThumb({ value, alt, large = false }: { value: string; alt: string; large?: boolean }) {
  const { url, failed } = useFileLink(value);
  if (!url) {
    return (
      <div className={`${large ? "h-32 w-48" : "aspect-square"} rounded-md border bg-muted flex items-center justify-center text-xs text-muted-foreground`}>
        {failed ? "Unavailable" : "Loading..."}
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={large ? "inline-block" : "block aspect-square overflow-hidden rounded-md border bg-muted"}>
      <img src={url} alt={alt} loading="lazy" className={large ? "max-h-64 rounded-md border" : "h-full w-full object-cover hover:opacity-90"} />
    </a>
  );
}

/** A voice memo player; private recordings load through a short-lived link. */
function AudioPlayer({ value, className }: { value: string; className?: string }) {
  const { url, failed } = useFileLink(value);
  if (!url) return <span className="text-xs text-muted-foreground">{failed ? "Recording unavailable" : "Loading..."}</span>;
  return <audio controls preload="none" src={url} className={className} />;
}

/** An answer on screen: links for files, text for everything else. */
function AnswerView({ field, sub }: { field: FormField; sub: FormSubmission }) {
  const value = getAnswer(sub, field.id);
  const url = mediaUrl(field, value);
  if (url) return <MediaLink field={field} url={url} />;
  const text = formatAnswer(value);
  return <>{text || <span className="text-muted-foreground">-</span>}</>;
}

// ===========================================================================
// All forms
// ===========================================================================

export function FormsOverview({
  forms,
  submissions,
  previousCounts,
  compareLabel,
  onOpen,
}: {
  forms: Form[];
  /** Period submissions for every form. */
  submissions: FormSubmission[];
  previousCounts: Map<string, number> | null;
  compareLabel?: string;
  onOpen: (formId: string) => void;
}) {
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    const latest = new Map<string, string>();
    for (const s of submissions) {
      counts.set(s.form_id, (counts.get(s.form_id) ?? 0) + 1);
      if (s.submitted_at && (!latest.get(s.form_id) || s.submitted_at > latest.get(s.form_id)!)) latest.set(s.form_id, s.submitted_at);
    }
    return forms
      .map((f) => ({
        form: f,
        count: counts.get(f.id) ?? 0,
        change: previousCounts ? percentChange(counts.get(f.id) ?? 0, previousCounts.get(f.id) ?? 0) : null,
        latest: latest.get(f.id) ?? null,
      }))
      .sort((a, b) => b.count - a.count || a.form.title.localeCompare(b.form.title));
  }, [forms, submissions, previousCounts]);

  if (!forms.length) return <EmptyChart message="No forms yet" />;

  const withResponses = rows.filter((r) => r.count > 0);
  return (
    <div className="space-y-6">
      <StatGrid
        compareLabel={compareLabel}
        stats={[
          {
            label: "Responses",
            value: formatCount(submissions.length),
            change: previousCounts ? percentChange(submissions.length, [...previousCounts.values()].reduce((a, b) => a + b, 0)) : null,
          },
          { label: "Forms with responses", value: formatCount(withResponses.length) },
          { label: "Published forms", value: formatCount(forms.filter((f) => f.is_published && !f.is_archived).length) },
          { label: "Busiest form", value: withResponses[0] ? shorten(withResponses[0].form.title, 22) : "-" },
        ]}
      />

      <ChartCard title="Responses by form">
        <RankedBarChart
          seriesName="Responses"
          data={withResponses.slice(0, 15).map((r) => ({ label: shorten(r.form.title, 18), fullName: r.form.title, value: r.count }))}
        />
      </ChartCard>

      <Card className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Form</TableHead>
              <TableHead className="text-right">Responses</TableHead>
              {previousCounts && <TableHead className="text-right">Change</TableHead>}
              <TableHead>Latest response</TableHead>
              <TableHead>
                <span className="sr-only">Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.form.id}>
                <TableCell className="font-medium">
                  {r.form.title}
                  {r.form.is_archived && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      Archived
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{formatCount(r.count)}</TableCell>
                {previousCounts && (
                  <TableCell className="text-right text-xs text-muted-foreground">{r.change == null ? "new" : formatChange(r.change)}</TableCell>
                )}
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {r.latest ? formatDate(toISODate(new Date(r.latest))) : "-"}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => onOpen(r.form.id)} aria-label={`Open report for ${r.form.title}`}>
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ===========================================================================
// One form
// ===========================================================================

/** Answers to a written question, newest first. */
function WrittenAnswers({ field, subs }: { field: FormField; subs: FormSubmission[] }) {
  const answers = subs
    .map((s) => ({ id: s.id, text: formatAnswer(getAnswer(s, field.id)), date: submittedDate(s) }))
    .filter((a) => a.text);
  return (
    <ChartCard title={field.label || "Untitled question"} description={`${formatCount(answers.length)} of ${formatCount(subs.length)} answered`} pdf={false}>
      {answers.length === 0 ? (
        <EmptyChart message="No answers yet" />
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {answers.slice(0, WRITTEN_ANSWERS_SHOWN).map((a) => (
            <li key={a.id} className="rounded-md bg-muted/40 p-3 text-sm">
              <p className="whitespace-pre-line break-words">{a.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(a.date)}</p>
            </li>
          ))}
          {answers.length > WRITTEN_ANSWERS_SHOWN && (
            <li className="text-xs text-muted-foreground text-center">
              Showing the latest {WRITTEN_ANSWERS_SHOWN}. Export CSV for all {formatCount(answers.length)}.
            </li>
          )}
        </ul>
      )}
    </ChartCard>
  );
}

/** Uploaded photos as thumbnails, voice memos as players, other files as links. */
function MediaAnswers({ field, subs }: { field: FormField; subs: FormSubmission[] }) {
  const items = subs
    .map((s) => ({ id: s.id, url: mediaUrl(field, getAnswer(s, field.id)), date: submittedDate(s) }))
    .filter((i): i is { id: string; url: string; date: string } => Boolean(i.url));
  const limit = field.type === "image" ? PHOTOS_SHOWN : AUDIO_SHOWN;
  return (
    <ChartCard title={field.label || "Untitled question"} description={`${formatCount(items.length)} of ${formatCount(subs.length)} added one`} pdf={false}>
      {items.length === 0 ? (
        <EmptyChart message="Nothing uploaded yet" />
      ) : field.type === "image" ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {items.slice(0, limit).map((i) => (
            <PhotoThumb key={i.id} value={i.url} alt={`Photo from ${formatDate(i.date)}`} />
          ))}
        </div>
      ) : field.type === "audio" ? (
        <ul className="space-y-2">
          {items.slice(0, limit).map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3">
              <AudioPlayer value={i.url} className="h-9 max-w-full" />
              <span className="text-xs text-muted-foreground">{formatDate(i.date)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {items.slice(0, limit).map((i) => (
            <li key={i.id}>
              <MediaLink field={field} url={i.url} /> <span className="text-xs text-muted-foreground">{formatDate(i.date)}</span>
            </li>
          ))}
        </ul>
      )}
      {items.length > limit && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing the latest {limit} of {formatCount(items.length)}. Open a response below, or export CSV for every link.
        </p>
      )}
    </ChartCard>
  );
}

function NumberSummary({ field, subs }: { field: FormField; subs: FormSubmission[] }) {
  const summary = summarizeNumbers(field, subs);
  const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");
  return (
    <ChartCard title={field.label || "Untitled question"} description={summary ? `Based on ${formatCount(summary.count)} answers` : undefined}>
      {!summary ? (
        <EmptyChart message="No answers yet" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["Average", fmt(summary.avg)],
              ["Total", fmt(summary.sum)],
              ["Lowest", fmt(summary.min)],
              ["Highest", fmt(summary.max)],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="text-center p-3 bg-muted/40 rounded-md">
              <p className="text-xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

function DateSummary({ field, subs }: { field: FormField; subs: FormSubmission[] }) {
  const dates = subs
    .map((s) => getAnswer(s, field.id))
    .filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v))
    .sort();
  return (
    <ChartCard title={field.label || "Untitled question"} description={`${formatCount(dates.length)} of ${formatCount(subs.length)} answered`}>
      {!dates.length ? (
        <EmptyChart message="No answers yet" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-3 bg-muted/40 rounded-md">
            <p className="font-bold">{formatDate(dates[0])}</p>
            <p className="text-xs text-muted-foreground">Earliest</p>
          </div>
          <div className="text-center p-3 bg-muted/40 rounded-md">
            <p className="font-bold">{formatDate(dates[dates.length - 1])}</p>
            <p className="text-xs text-muted-foreground">Latest</p>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

/** Every answer in one response, with photos and recordings shown inline. */
export function ResponseDialog({
  fields,
  sub,
  index,
  title,
  onClose,
}: {
  fields: FormField[];
  sub: FormSubmission;
  index?: number;
  /** Defaults to "Response #<index>". */
  title?: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title ?? `Response #${index}`}</DialogTitle>
          <DialogDescription>{sub.submitted_at ? new Date(sub.submitted_at).toLocaleString("en-US") : ""}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-4">
          {fields.map((f) => {
            const value = getAnswer(sub, f.id);
            const url = mediaUrl(f, value);
            return (
              <div key={f.id} className="space-y-1">
                <dt className="text-xs font-medium text-muted-foreground">{f.label || "Untitled question"}</dt>
                <dd className="text-sm whitespace-pre-line break-words">
                  {url && f.type === "image" ? (
                    <PhotoThumb value={url} alt={f.label || "Uploaded photo"} large />
                  ) : url && f.type === "audio" ? (
                    <AudioPlayer value={url} className="w-full" />
                  ) : url ? (
                    <MediaLink field={f} url={url} />
                  ) : isBlank(value) ? (
                    <span className="text-muted-foreground">No answer</span>
                  ) : (
                    formatAnswer(value)
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

export function FormReport({
  form,
  submissions,
  filtered,
  search,
  previousCount,
  compareLabel,
  recent,
  range,
  granularity,
}: {
  form: Form;
  /** This form's responses in the period. */
  submissions: FormSubmission[];
  /** `submissions` narrowed by the search box. */
  filtered: FormSubmission[];
  search: string;
  previousCount: number | null;
  compareLabel?: string;
  recent: { last7: number | null; latest: string | null };
  range?: { from: string; to: string };
  granularity: Granularity;
}) {
  const fields = fieldsOf(form);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const series = useMemo(
    () => buildTimeSeries(filtered.map((s) => ({ date: submittedDate(s), value: 1 })), granularity, range),
    [filtered, granularity, range],
  );

  if (submissions.length === 0) return <EmptyChart message="No responses to this form in this period" />;
  if (filtered.length === 0) {
    return (
      <div className="text-center py-16 space-y-3">
        <Search className="h-6 w-6 text-muted-foreground mx-auto" aria-hidden="true" />
        <p className="text-sm font-medium">No responses match "{search}"</p>
      </div>
    );
  }

  const choice = fields.filter((f) => CHOICE_FIELD_TYPES.has(f.type));
  const numbers = fields.filter((f) => f.type === "number");
  const dates = fields.filter((f) => f.type === "date");
  const written = fields.filter((f) => TEXT_FIELD_TYPES.has(f.type));
  const media = fields.filter((f) => MEDIA_FIELD_TYPES.has(f.type));
  const completion = fields.length
    ? Math.round((fields.reduce((n, f) => n + answeredCount(f, filtered), 0) / (fields.length * filtered.length)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <StatGrid
        compareLabel={compareLabel}
        stats={[
          {
            label: search ? "Matching responses" : "Responses",
            value: formatCount(filtered.length),
            change: search ? null : percentChange(submissions.length, previousCount),
          },
          { label: "Last 7 days", value: recent.last7 == null ? "-" : formatCount(recent.last7), sub: "Regardless of period" },
          { label: "Questions answered", value: `${completion}%`, sub: "Across all questions" },
          { label: "Latest response", value: recent.latest ? formatDate(toISODate(new Date(recent.latest))) : "-" },
        ]}
      />

      <ChartCard title="Responses over time" description={`Per ${granularityLabel(granularity)}`}>
        <TimeSeriesChart data={series} kind="line" seriesName="Responses" heightClass="h-48" />
      </ChartCard>

      {(choice.length > 0 || numbers.length > 0 || dates.length > 0) && (
        <div className="grid md:grid-cols-2 gap-6">
          {choice.map((f) => (
            <ChartCard key={f.id} title={f.label || "Untitled question"} description={`${formatCount(answeredCount(f, filtered))} of ${formatCount(filtered.length)} answered`}>
              <DonutChart
                data={summarizeChoices(f, filtered)}
                valueFormatter={(v) => `${v} ${v === 1 ? "response" : "responses"}`}
                heightClass="h-44"
                showLabels
              />
            </ChartCard>
          ))}
          {numbers.map((f) => (
            <NumberSummary key={f.id} field={f} subs={filtered} />
          ))}
          {dates.map((f) => (
            <DateSummary key={f.id} field={f} subs={filtered} />
          ))}
        </div>
      )}

      {written.length > 0 && (
        <div className="grid md:grid-cols-2 gap-6">
          {written.map((f) => (
            <WrittenAnswers key={f.id} field={f} subs={filtered} />
          ))}
        </div>
      )}

      {media.length > 0 && (
        <div className="grid md:grid-cols-2 gap-6">
          {media.map((f) => (
            <MediaAnswers key={f.id} field={f} subs={filtered} />
          ))}
        </div>
      )}

      {/* Every response (capped on screen; exports include everything). */}
      <Card className="overflow-auto">
        <div className="p-4 border-b">
          <h3 className="font-semibold">All responses</h3>
          <p className="text-xs text-muted-foreground">Select View to see a whole response, including photos and recordings.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Submitted</TableHead>
              {fields.map((f) => (
                <TableHead key={f.id}>{f.label}</TableHead>
              ))}
              <TableHead>
                <span className="sr-only">View</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, MAX_TABLE_ROWS).map((sub, idx) => (
              <TableRow key={sub.id}>
                <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString("en-US") : "-"}
                </TableCell>
                {fields.map((f) => {
                  const text = formatAnswer(getAnswer(sub, f.id));
                  return (
                    // title shows the full answer on hover since the cell is truncated.
                    <TableCell key={f.id} className="max-w-[180px] truncate" title={mediaUrl(f, getAnswer(sub, f.id)) ? undefined : text || undefined}>
                      <AnswerView field={f} sub={sub} />
                    </TableCell>
                  );
                })}
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setOpenIndex(idx)} aria-label={`View response ${idx + 1}`}>
                    <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtered.length > MAX_TABLE_ROWS && (
          <p className="p-3 text-xs text-muted-foreground text-center border-t">
            Showing the latest {MAX_TABLE_ROWS} of {formatCount(filtered.length)} responses. Export CSV for the full list.
          </p>
        )}
      </Card>

      {openIndex !== null && filtered[openIndex] && (
        <ResponseDialog fields={fields} sub={filtered[openIndex]} index={openIndex + 1} onClose={() => setOpenIndex(null)} />
      )}
    </div>
  );
}

