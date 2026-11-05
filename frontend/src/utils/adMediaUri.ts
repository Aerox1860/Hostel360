export function normalizeAdMediaUri(uri: string, isWeb: boolean, hasBrowserFile: boolean): string {
  if (isWeb) {
    if (!hasBrowserFile) {
      throw new Error("The browser did not provide the selected file. Please select it again.");
    }
    return uri;
  }

  const normalizedUri = uri.startsWith("/") ? `file://${uri}` : uri;
  if (!normalizedUri.startsWith("file://") && !normalizedUri.startsWith("content://")) {
    throw new Error("This file location is not supported. Please choose the media from your device library again.");
  }
  return normalizedUri;
}
