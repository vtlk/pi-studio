import type { Asset } from './studio';

export type LibraryKind = 'characters' | 'locations';
export interface LibraryManifest {
  schemaVersion: 1;
  id: string;
  kind: LibraryKind;
  version: number;
  title: string;
  description: string;
  category: string;
  createdAt: number;
  files: { reference: string; preview: string; vector?: string };
}
export interface LibraryAsset extends Asset {
  library: { kind: LibraryKind; version: number; animated: false };
  createdAt: number;
}
export interface LibraryListing {
  folder: string;
  assets: LibraryAsset[];
  warnings: string[];
}
