/**
 * use-import-export-gate
 *
 * CSV and Excel import and export are Mission and Enterprise features
 * (lib/plans). Wrap an Import or Export button's handler so that, on other
 * plans, clicking it explains the upgrade instead:
 *
 *   const gate = useImportExportGate();
 *   <Button onClick={gate(exportCSV)}>Export CSV</Button>
 *
 * The buttons stay visible on purpose, so people can find the feature.
 */

import { useCallback } from "react";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { IMPORT_EXPORT_UPGRADE_MESSAGE } from "@/lib/plans";

export function useImportExportGate() {
  const { plan } = useOrganization();
  const { toast } = useToast();
  const allowed = plan.features.importExport;

  return useCallback(
    (action: () => void) => () => {
      if (!allowed) {
        toast({ title: "Upgrade to import and export", description: IMPORT_EXPORT_UPGRADE_MESSAGE });
        return;
      }
      action();
    },
    [allowed, toast],
  );
}
