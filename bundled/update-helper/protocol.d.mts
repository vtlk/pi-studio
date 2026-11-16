export interface FileIdentity {
  dev: string;
  ino: string;
  birthtimeNs: string;
}
export interface UpdateJob {
  schema: 1;
  id: string;
  nonce: string;
  platform: 'darwin' | 'win32';
  oldPid: number;
  oldVersion: string;
  version: string;
  target: string;
  stage: string;
  userData: string;
  oldIdentity: FileIdentity;
  newIdentity: FileIdentity;
  limits: { exitMs: number; healthMs: number; abortMs: number };
}
export function validateJob(value: unknown): UpdateJob;
export function paths(
  job: UpdateJob,
): Record<
  | 'candidate'
  | 'previous'
  | 'rejected'
  | 'journal'
  | 'result'
  | 'active'
  | 'ready'
  | 'commit'
  | 'cancel'
  | 'health'
  | 'abort'
  | 'phase'
  | 'startups',
  string
>;
export function executable(root: string, platform: string): string;
export function identity(path: string): Promise<FileIdentity>;
export function sameIdentity(
  left: FileIdentity | undefined,
  right: FileIdentity | undefined,
): boolean;
export function exists(path: string): Promise<boolean>;
export function readJson(path: string): Promise<Record<string, unknown>>;
export function atomicJson(path: string, value: unknown): Promise<void>;
export function authenticated(
  path: string,
  job: UpdateJob,
): Promise<Record<string, unknown> | undefined>;
export function loadJob(path: string): Promise<UpdateJob>;
