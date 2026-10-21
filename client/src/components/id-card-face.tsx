/**
 * IdCardFace
 *
 * One ID card, drawn at its real size (inches) from the organization's card
 * design (lib/card-design). Used by the print sheet and the Card design
 * preview, so what you preview is what prints.
 */

import { AppLogo } from "@/components/app-logo";
import { QrCode } from "@/components/qr-code";
import { prefersDarkText } from "@/lib/form-appearance";
import { cardSize, type CardDesign } from "@/lib/card-design";
import { formatCardNumber, personScanUrl } from "@/lib/cards";
import { formatCustomValue, type CustomField } from "@/lib/tracker-fields";

export interface CardPerson {
  id: string;
  full_name: string;
  card_number?: number | null;
  custom?: Record<string, unknown> | null;
}

export function IdCardFace({
  design,
  person,
  prefix,
  orgName,
  logoUrl,
  customFields,
  dashedEdge = false,
}: {
  design: CardDesign;
  person: CardPerson;
  prefix: string | null;
  orgName: string;
  logoUrl: string | null;
  /** The organization's custom People fields, to label and format the chosen ones. */
  customFields: CustomField[];
  /** Cut line around the card, for the print sheet. */
  dashedEdge?: boolean;
}) {
  const { w, h } = cardSize(design.orientation);
  const portrait = design.orientation === "portrait";
  const { background, text, accent } = design.colors;
  const bandText = prefersDarkText(accent) ? "#111111" : "#ffffff";

  const fields = design.customFieldIds
    .map((id) => customFields.find((f) => f.id === id))
    .filter((f): f is CustomField => Boolean(f))
    .map((f) => ({ label: f.label, value: formatCustomValue(f, person.custom?.[f.id]) }))
    .filter((f) => f.value);
  const lines = design.lines.filter((l) => l.trim());
  const number = person.card_number != null ? formatCardNumber(prefix, person.card_number) : formatCardNumber(prefix, 0).replace(/0/g, "-");
  const qrSize = portrait ? "1.15in" : fields.length + lines.length > 2 ? "0.85in" : "1in";

  const logo = logoUrl ? (
    <img src={logoUrl} alt="" className="h-[0.24in] max-w-[0.9in] object-contain shrink-0" />
  ) : (
    <AppLogo className="h-[0.2in] w-[0.2in] shrink-0" />
  );

  const header =
    design.layout === "header_band" ? (
      <div className="flex items-center gap-[0.06in] px-[0.12in] py-[0.07in]" style={{ background: accent, color: bandText }}>
        {logo}
        <div className="min-w-0">
          <p className="truncate text-[8.5pt] font-semibold leading-tight">{orgName}</p>
          {design.title && <p className="truncate text-[7pt] uppercase tracking-wider opacity-90">{design.title}</p>}
        </div>
      </div>
    ) : (
      <div className="px-[0.12in] pt-[0.1in]">
        <div className="flex items-center gap-[0.06in] min-w-0">
          {logo}
          <span className="truncate text-[8.5pt] font-semibold">{orgName}</span>
        </div>
        {design.title && (
          <p className="mt-[0.03in] text-[7pt] font-semibold uppercase tracking-wider" style={{ color: accent }}>
            {design.title}
          </p>
        )}
      </div>
    );

  const details = (
    <div className={`min-w-0 ${portrait ? "text-center" : ""}`}>
      <p className="text-[12pt] font-bold leading-tight break-words">{person.full_name}</p>
      <p className="mt-[0.02in] font-mono text-[10pt] tracking-wide" style={{ color: design.layout === "header_band" ? text : accent }}>
        {number}
      </p>
      {fields.map((f) => (
        <p key={f.label} className="text-[6.5pt] leading-snug truncate">
          <span className="opacity-70">{f.label}:</span> {f.value}
        </p>
      ))}
      {lines.map((l, i) => (
        <p key={i} className="text-[6.5pt] leading-snug opacity-80 break-words">
          {l}
        </p>
      ))}
    </div>
  );

  const qr = <QrCode value={personScanUrl(person.id)} size={qrSize} label={`QR code for ${person.full_name}`} />;

  return (
    <div
      className={`flex flex-col overflow-hidden break-inside-avoid ${dashedEdge ? "outline outline-1 outline-dashed outline-neutral-400" : "rounded-[0.12in] shadow-md"}`}
      style={{ width: `${w}in`, height: `${h}in`, background, color: text }}
    >
      {header}
      {portrait ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-[0.08in] px-[0.12in] pb-[0.1in]">
          {qr}
          {details}
        </div>
      ) : (
        <div
          className={`flex flex-1 items-end justify-between gap-[0.1in] px-[0.12in] pb-[0.1in] ${design.layout === "qr_left" ? "flex-row-reverse" : ""}`}
        >
          {details}
          <div className="shrink-0 rounded-[0.04in] bg-white p-[0.03in]">{qr}</div>
        </div>
      )}
    </div>
  );
}
