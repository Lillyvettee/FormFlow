/**
 * ImportDialog
 *
 * Import donations, volunteer hours, links or inventory from a CSV or Excel
 * file (rules per record type are in lib/import.ts). Follows the
 * organization's field setup: renamed and hidden fields, first/last names
 * and its own fields (lib/tracker-fields.ts).
 *
 * Steps:
 *   1. Choose a file (or download a template).
 *   2. Match columns: guessed from the headers, every match can be changed.
 *   3. Review: rows with problems and likely duplicates are listed, and the
 *      person decides what to do with each group before anything is saved.
 *   4. Import, then "Undo import" removes exactly what was added.
 */

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { friendlyWriteError } from "@/lib/db-errors";
import { downloadCsv, exportFileName } from "@/lib/report-utils";
import { autoMatch, buildImporter, checkRows, readSpreadsheet, templateRows, type CheckedRow, type ImportKind, type Sheet } from "@/lib/import";
import { useTrackerFields } from "@/lib/tracker-fields";
import { AlertTriangle, CheckCircle2, Copy, Download, FileSpreadsheet, Undo2, Upload } from "lucide-react";

const NOT_MAPPED = "__none__";
const CHUNK = 200;
const LIST_LIMIT = 100;

type Step = "upload" | "match" | "review" | "importing" | "done";
type ProblemChoice = "skip" | "stop" | null;
type DuplicateChoice = "skip" | "import" | "choose" | null;

export function ImportDialog({ kind, onClose, onImported }: { kind: ImportKind; onClose: () => void; onImported: () => void }) {
  const trackerFields = useTrackerFields(kind);
  const importer = useMemo(() => buildImporter(kind, trackerFields), [kind, trackerFields]);
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [readError, setReadError] = useState("");
  const [isReading, setIsReading] = useState(false);

  const [rows, setRows] = useState<CheckedRow[]>([]);
  const [problemChoice, setProblemChoice] = useState<ProblemChoice>(null);
  const [duplicateChoice, setDuplicateChoice] = useState<DuplicateChoice>(null);
  /** Row numbers of duplicates to import anyway, when choosing one by one. */
  const [chosenDuplicates, setChosenDuplicates] = useState<Set<number>>(new Set());

  const [progress, setProgress] = useState(0);
  const [insertedIds, setInsertedIds] = useState<string[]>([]);
  const [importError, setImportError] = useState("");
  const [isUndoing, setIsUndoing] = useState(false);
  const [undone, setUndone] = useState(false);

  // ----- Step 1: read the file -----
  const handleFile = async (file: File | null) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setReadError("");
    setIsReading(true);
    try {
      const s = await readSpreadsheet(file);
      setSheet(s);
      setFileName(file.name);
      setMapping(autoMatch(importer, s.headers));
      setStep("match");
    } catch (err) {
      setReadError(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally {
      setIsReading(false);
    }
  };

  // ----- Step 2 -> 3: check every row -----
  const missingRequired = importer.fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0);
  const review = async () => {
    if (!sheet || missingRequired.length) return;
    setIsReading(true);
    try {
      const existing = await importer.loadExistingKeys();
      const checked = checkRows(importer, sheet, mapping, existing);
      setRows(checked);
      setProblemChoice(null);
      setDuplicateChoice(null);
      setChosenDuplicates(new Set());
      setStep("review");
    } catch (err) {
      setReadError(err instanceof Error ? err.message : "Couldn't check your existing records. Try again.");
    } finally {
      setIsReading(false);
    }
  };

  const problemRows = useMemo(() => rows.filter((r) => r.problems.length), [rows]);
  const duplicateRows = useMemo(() => rows.filter((r) => !r.problems.length && r.duplicate), [rows]);
  const readyRows = useMemo(() => rows.filter((r) => !r.problems.length && !r.duplicate), [rows]);

  const toImport = useMemo(() => {
    const dups =
      duplicateChoice === "import" ? duplicateRows : duplicateChoice === "choose" ? duplicateRows.filter((r) => chosenDuplicates.has(r.rowNumber)) : [];
    return [...readyRows, ...dups].sort((a, b) => a.rowNumber - b.rowNumber);
  }, [readyRows, duplicateRows, duplicateChoice, chosenDuplicates]);

  const needsProblemChoice = problemRows.length > 0 && problemChoice === null;
  const needsDuplicateChoice = duplicateRows.length > 0 && duplicateChoice === null;
  const canImport = !needsProblemChoice && !needsDuplicateChoice && problemChoice !== "stop" && toImport.length > 0;

  const downloadProblems = () => {
    if (!sheet) return;
    downloadCsv(exportFileName([importer.plural, "to fix"], "csv"), [
      ["Row", "Problem", ...sheet.headers],
      ...problemRows.map((r) => [r.rowNumber, r.problems.join(" "), ...r.raw]),
    ]);
  };

  // ----- Step 4: save -----
  const runImport = async () => {
    if (!user || !canImport) return;
    setStep("importing");
    setImportError("");
    setProgress(0);
    const ids: string[] = [];
    try {
      for (let i = 0; i < toImport.length; i += CHUNK) {
        const batch = toImport.slice(i, i + CHUNK).map((r) => ({ ...r.values, user_id: user.id }));
        const { data, error } = await supabase.from(importer.table).insert(batch).select("id");
        if (error) throw error;
        ids.push(...(data ?? []).map((d: { id: string }) => d.id));
        setProgress(Math.round((ids.length / toImport.length) * 100));
      }
    } catch (err) {
      setImportError(
        `${ids.length ? `${ids.length} of ${toImport.length} were imported, then it stopped. ` : ""}${friendlyWriteError(err as { message?: string; code?: string })}`,
      );
    }
    setInsertedIds(ids);
    setStep("done");
    if (ids.length) onImported();
  };

  const undo = async () => {
    if (!insertedIds.length) return;
    if (!window.confirm(`Remove the ${insertedIds.length} ${insertedIds.length === 1 ? importer.noun : importer.plural} you just imported?`)) return;
    setIsUndoing(true);
    try {
      for (let i = 0; i < insertedIds.length; i += CHUNK) {
        const { error } = await supabase.from(importer.table).delete().in("id", insertedIds.slice(i, i + CHUNK));
        if (error) throw error;
      }
      setUndone(true);
      onImported();
      toast({ title: "Import undone" });
    } catch (err) {
      toast({ title: "Couldn't undo the import", description: friendlyWriteError(err as { message?: string }), variant: "destructive" });
    } finally {
      setIsUndoing(false);
    }
  };

  const title = `Import ${importer.plural}`;
  const preview = sheet?.rows.slice(0, 3) ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && step !== "importing" && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Add many records at once from a spreadsheet."}
            {step === "match" && `Step 2 of 3: check which column holds each detail. ${fileName}, ${sheet?.rows.length.toLocaleString("en-US")} rows.`}
            {step === "review" && "Step 3 of 3: review before anything is saved."}
            {step === "importing" && "Importing..."}
            {step === "done" && (undone ? "Import undone." : "Import finished.")}
          </DialogDescription>
        </DialogHeader>

        {/* ===== Step 1: choose a file ===== */}
        {step === "upload" && (
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFile(e.dataTransfer.files?.[0] ?? null);
              }}
              disabled={isReading || trackerFields.isLoading}
              className="w-full rounded-md border-2 border-dashed p-10 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Upload className="h-8 w-8" aria-hidden="true" />
              <span className="font-medium">{isReading ? "Reading..." : "Choose a file or drag it here"}</span>
              <span className="text-xs">CSV or Excel (.xlsx), up to 5,000 rows. The first row should be column names.</span>
            </button>
            {readError && (
              <p role="alert" className="text-sm text-destructive">
                {readError}
              </p>
            )}
            <div className="rounded-md bg-muted/50 p-4 space-y-2 text-sm">
              <p className="font-medium">What the file can include</p>
              <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                {importer.fields.map((f) => (
                  <li key={f.key}>
                    {f.label}
                    {f.required && <span className="text-foreground"> (required)</span>}
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" onClick={() => downloadCsv(`${importer.plural.replace(/ /g, "-")}-import-template.csv`, templateRows(importer))}>
                <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Download a template
              </Button>
            </div>
          </div>
        )}

        {/* ===== Step 2: match columns ===== */}
        {step === "match" && sheet && (
          <div className="space-y-4">
            <div className="space-y-3">
              {importer.fields.map((f) => {
                const col = mapping[f.key] ?? -1;
                return (
                  <div key={f.key} className="grid sm:grid-cols-[180px_1fr] gap-x-4 gap-y-1 items-start">
                    <Label htmlFor={`map-${f.key}`} className="pt-2">
                      {f.label}
                      {f.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <div className="space-y-1">
                      <Select
                        value={col >= 0 ? String(col) : NOT_MAPPED}
                        onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === NOT_MAPPED ? -1 : Number(v) }))}
                      >
                        <SelectTrigger id={`map-${f.key}`} className={f.required && col < 0 ? "border-destructive" : ""}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NOT_MAPPED}>{f.required ? "Choose a column..." : "Don't import"}</SelectItem>
                          {sheet.headers.map((h, i) => (
                            <SelectItem key={i} value={String(i)}>
                              {h}
                              {preview[0]?.[i] ? ` (e.g. ${preview[0][i].slice(0, 30)})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
            {missingRequired.length > 0 && (
              <p role="alert" className="text-sm text-destructive">
                Choose a column for: {missingRequired.map((f) => f.label).join(", ")}.
              </p>
            )}
            {readError && (
              <p role="alert" className="text-sm text-destructive">
                {readError}
              </p>
            )}
          </div>
        )}

        {/* ===== Step 3: review ===== */}
        {step === "review" && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-emerald-500/10 p-3">
                <p className="text-2xl font-bold">{readyRows.length.toLocaleString("en-US")}</p>
                <p className="text-xs text-muted-foreground">Ready</p>
              </div>
              <div className={`rounded-md p-3 ${problemRows.length ? "bg-destructive/10" : "bg-muted/50"}`}>
                <p className="text-2xl font-bold">{problemRows.length.toLocaleString("en-US")}</p>
                <p className="text-xs text-muted-foreground">With problems</p>
              </div>
              <div className={`rounded-md p-3 ${duplicateRows.length ? "bg-amber-500/10" : "bg-muted/50"}`}>
                <p className="text-2xl font-bold">{duplicateRows.length.toLocaleString("en-US")}</p>
                <p className="text-xs text-muted-foreground">Possible duplicates</p>
              </div>
            </div>

            {/* ----- Problem rows: ask what to do ----- */}
            {problemRows.length > 0 && (
              <section className="space-y-3 rounded-md border border-destructive/40 p-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
                  {problemRows.length} {problemRows.length === 1 ? "row has" : "rows have"} problems
                </h3>
                <div className="max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Row</TableHead>
                        <TableHead>Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {problemRows.slice(0, LIST_LIMIT).map((r) => (
                        <TableRow key={r.rowNumber}>
                          <TableCell>{r.rowNumber}</TableCell>
                          <TableCell className="text-sm">{r.problems.join(" ")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {problemRows.length > LIST_LIMIT && <p className="text-xs text-muted-foreground p-2">And {problemRows.length - LIST_LIMIT} more. Download them to see all.</p>}
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">What should we do with these rows?</legend>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="problems" className="mt-1" checked={problemChoice === "skip"} onChange={() => setProblemChoice("skip")} />
                    <span>Skip them and import the rest. You can download them, fix them and import them later.</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="problems" className="mt-1" checked={problemChoice === "stop"} onChange={() => setProblemChoice("stop")} />
                    <span>Don't import anything yet. I'll fix my file first.</span>
                  </label>
                </fieldset>
                <Button variant="outline" size="sm" onClick={downloadProblems}>
                  <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Download rows to fix
                </Button>
                {problemChoice === "stop" && (
                  <p className="text-xs text-muted-foreground">
                    Fix the rows in your spreadsheet (the download lists each problem), then choose Import again.
                  </p>
                )}
              </section>
            )}

            {/* ----- Duplicates: ask what to do ----- */}
            {duplicateRows.length > 0 && problemChoice !== "stop" && (
              <section className="space-y-3 rounded-md border border-amber-500/50 p-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Copy className="h-4 w-4 text-amber-600" aria-hidden="true" />
                  {duplicateRows.length} {duplicateRows.length === 1 ? "row looks" : "rows look"} like {duplicateRows.length === 1 ? "a duplicate" : "duplicates"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {kind === "donations" && "Same donor, amount and date."}
                  {kind === "volunteer_hours" && "Same volunteer, date, hours and activity."}
                  {kind === "links" && "Same web address."}
                  {kind === "inventory_items" && "Same item name and location."}
                </p>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">What should we do with them?</legend>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="dups" className="mt-1" checked={duplicateChoice === "skip"} onChange={() => setDuplicateChoice("skip")} />
                    <span>Skip them all</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="dups" className="mt-1" checked={duplicateChoice === "import"} onChange={() => setDuplicateChoice("import")} />
                    <span>Import them all anyway (for example, two separate gifts on the same day)</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="dups" className="mt-1" checked={duplicateChoice === "choose"} onChange={() => setDuplicateChoice("choose")} />
                    <span>Let me choose</span>
                  </label>
                </fieldset>
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  <ul className="divide-y">
                    {duplicateRows.slice(0, LIST_LIMIT).map((r) => (
                      <li key={r.rowNumber} className="flex items-start gap-3 p-2 text-sm">
                        {duplicateChoice === "choose" && (
                          <Checkbox
                            className="mt-0.5"
                            checked={chosenDuplicates.has(r.rowNumber)}
                            onCheckedChange={(on) =>
                              setChosenDuplicates((cur) => {
                                const next = new Set(cur);
                                if (on) next.add(r.rowNumber);
                                else next.delete(r.rowNumber);
                                return next;
                              })
                            }
                            aria-label={`Import row ${r.rowNumber} anyway`}
                          />
                        )}
                        <span className="flex-1">
                          <span className="text-muted-foreground">Row {r.rowNumber}:</span> {importer.describe(r.values)}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{r.duplicate}</span>
                      </li>
                    ))}
                  </ul>
                  {duplicateRows.length > LIST_LIMIT && (
                    <p className="text-xs text-muted-foreground p-2">
                      And {duplicateRows.length - LIST_LIMIT} more{duplicateChoice === "choose" ? " (not imported unless you choose Import them all)" : ""}.
                    </p>
                  )}
                </div>
                {duplicateChoice === "choose" && (
                  <p className="text-xs text-muted-foreground">Checked rows will be imported; unchecked rows are skipped.</p>
                )}
              </section>
            )}

            {problemChoice !== "stop" && (
              <p className="text-sm">
                {needsProblemChoice || needsDuplicateChoice ? (
                  <span className="text-muted-foreground">Answer the question{needsProblemChoice && needsDuplicateChoice ? "s" : ""} above to continue.</span>
                ) : toImport.length ? (
                  <>
                    Ready to import <strong>{toImport.length.toLocaleString("en-US")}</strong> {toImport.length === 1 ? importer.noun : importer.plural}.
                  </>
                ) : (
                  <span className="text-muted-foreground">Nothing left to import.</span>
                )}
              </p>
            )}
          </div>
        )}

        {/* ===== Step 4: importing / done ===== */}
        {step === "importing" && (
          <div className="space-y-3 py-6" role="status">
            <Progress value={progress} aria-label="Import progress" />
            <p className="text-sm text-center text-muted-foreground">
              {progress}% of {toImport.length.toLocaleString("en-US")} {importer.plural}. Please keep this window open.
            </p>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 py-2">
            {insertedIds.length > 0 && !undone && (
              <div className="flex items-start gap-3 rounded-md bg-emerald-500/10 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-medium">
                    Imported {insertedIds.length.toLocaleString("en-US")} {insertedIds.length === 1 ? importer.noun : importer.plural}.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[
                      problemRows.length && problemChoice === "skip" ? `${problemRows.length} with problems skipped` : "",
                      duplicateRows.length - (toImport.length - readyRows.length) > 0
                        ? `${duplicateRows.length - (toImport.length - readyRows.length)} duplicates skipped`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
              </div>
            )}
            {undone && <p className="text-sm">The imported records were removed.</p>}
            {importError && (
              <p role="alert" className="text-sm text-destructive">
                {importError}
              </p>
            )}
            {problemRows.length > 0 && problemChoice === "skip" && !undone && (
              <Button variant="outline" size="sm" onClick={downloadProblems}>
                <FileSpreadsheet className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Download skipped rows to fix
              </Button>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "match" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")}>
                Choose another file
              </Button>
              <Button onClick={review} disabled={missingRequired.length > 0 || isReading}>
                {isReading ? "Checking..." : "Review"}
              </Button>
            </>
          )}
          {step === "review" && (
            <>
              <Button variant="outline" onClick={() => setStep("match")}>
                Back
              </Button>
              {problemChoice === "stop" ? (
                <Button onClick={onClose}>Close</Button>
              ) : (
                <Button onClick={runImport} disabled={!canImport}>
                  Import {toImport.length ? toImport.length.toLocaleString("en-US") : ""}
                </Button>
              )}
            </>
          )}
          {step === "done" && (
            <>
              {insertedIds.length > 0 && !undone && (
                <Button variant="outline" onClick={undo} disabled={isUndoing}>
                  <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  {isUndoing ? "Undoing..." : "Undo import"}
                </Button>
              )}
              <Button onClick={onClose}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
