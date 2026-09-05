/** Opens the browser print dialog (Save as PDF) for the hidden route print sheet. */
export function printRoutePdf(): void {
  document.body.classList.add("route-print-active");

  const cleanup = () => {
    document.body.classList.remove("route-print-active");
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  window.print();
}
