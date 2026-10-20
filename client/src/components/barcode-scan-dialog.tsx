/**
 * BarcodeScanDialog
 *
 * A camera window that reads one barcode or QR code and hands back its text,
 * then closes. Used by the Barcode field in Inventory's item form.
 * Scanning uses @zxing/browser, loaded on first use; nothing leaves the device.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle } from "lucide-react";

export function BarcodeScanDialog({ onScanned, onClose }: { onScanned: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let controls: { stop: () => void } | null = null;
    let done = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't use the camera here. Type the barcode instead.");
        setStarting(false);
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (done || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (res) => {
            if (!res || done) return;
            done = true;
            controls?.stop();
            if (navigator.vibrate) navigator.vibrate(60);
            onScanned(res.getText().trim());
          },
        );
        if (done) controls.stop();
        setStarting(false);
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow the camera for this site in your browser settings, then try again."
            : name === "NotFoundError"
              ? "No camera was found on this device. Type the barcode instead."
              : "Couldn't start the camera. Type the barcode instead.",
        );
        setStarting(false);
      }
    })();

    return () => {
      done = true;
      controls?.stop();
    };
    // Runs once per opening; onScanned is read when a code is found.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scan a barcode</DialogTitle>
          <DialogDescription>Point the camera at the barcode on the product, or at a printed label.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : (
          <div className="relative overflow-hidden rounded-md bg-black aspect-[4/3]">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label="Camera view" />
            <div className="pointer-events-none absolute inset-x-[10%] top-1/2 h-[30%] -translate-y-1/2 rounded-lg border-2 border-white/80" aria-hidden="true" />
            {starting && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Starting camera...</p>}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
