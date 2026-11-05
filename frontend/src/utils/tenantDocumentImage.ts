export function tenantDocumentImageUri(blob: Blob, isWeb: boolean): Promise<string> {
  if (isWeb) return Promise.resolve(URL.createObjectURL(blob));

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not decode the downloaded document."));
    };
    reader.onerror = () => reject(new Error("Could not decode the downloaded document."));
    reader.readAsDataURL(blob);
  });
}
