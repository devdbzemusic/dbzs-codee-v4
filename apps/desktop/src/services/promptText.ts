export async function promptText(request: {
  title: string;
  label: string;
  value: string;
  confirmText: string;
}): Promise<string | null> {
  if (window.dbzs.promptTextInput) {
    return window.dbzs.promptTextInput({ ...request, cancelText: "Abbrechen" });
  }

  const result = window.prompt(`${request.title}\n${request.label}`, request.value);
  return result?.trim() ? result.trim() : null;
}
