/**
 * QrCode
 *
 * A QR code drawn as SVG, for ID cards and inventory labels. Made in the
 * browser (qrcode library, loaded on first use), so nothing is sent anywhere.
 */

import { useEffect, useState } from "react";

export function QrCode({ value, size, label }: { value: string; size: string; label: string }) {
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((QR) => QR.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M" }))
      .then((out) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        if (!cancelled) setSvg("");
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      className="[&>svg]:h-full [&>svg]:w-full"
      // The qrcode library's own SVG output, made from our link; no user HTML.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
