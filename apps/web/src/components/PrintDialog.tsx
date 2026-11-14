import { useState } from "react";
import { Printer } from "lucide-react";
import { t } from "@nootion/shared";
import { printPage, readPrintOptions, type PrintBreaks } from "../lib/print";
import { Button, CancelButton, Modal, Select } from "./ui";

/**
 * "Print / Save as PDF": a few choices for the sheets, then the browser's print dialog, where "Save as PDF" is one of
 * the printers. The PDF is made by the browser, so nothing is asked of the server.
 */
export function PrintDialog({ onClose }: { onClose: () => void }) {
  const [options, setOptions] = useState(readPrintOptions);

  function print() {
    onClose();
    // Once the dialog is gone from the page.
    setTimeout(() => void printPage(options), 0);
  }

  return (
    <Modal title={t("print.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          print();
        }}
        className="space-y-4 text-sm"
        data-print-dialog
      >
        <p className="text-neutral-500">{t("print.help")}</p>
        <label className="flex items-center justify-between gap-3">
          <span>{t("print.breaks")}</span>
          <Select value={options.breaks} onChange={(e) => setOptions({ ...options, breaks: e.target.value as PrintBreaks })} data-print-breaks>
            <option value="none">{t("print.breaksNone")}</option>
            <option value="h1">{t("print.breaksH1")}</option>
            <option value="h2">{t("print.breaksH2")}</option>
          </Select>
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span>{t("print.linkUrls")}</span>
          <input
            type="checkbox"
            role="switch"
            className="h-4 w-4 accent-blue-600"
            checked={options.linkUrls}
            onChange={(e) => setOptions({ ...options, linkUrls: e.target.checked })}
            data-print-links
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <CancelButton onClose={onClose} />
          <Button type="submit" className="flex items-center gap-1.5" data-print-go>
            <Printer size={15} /> {t("print.button")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
