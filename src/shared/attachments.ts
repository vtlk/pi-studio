export interface ReferenceFile {
  id: string;
  name: string;
  size: number;
  type: string;
  preview?: string;
}
export interface SavedAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  sha256: string;
  path: string;
  image?: { path: string; mimeType: string };
}
