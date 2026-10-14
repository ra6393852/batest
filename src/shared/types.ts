export const outcomes = ['B', 'P', 'T'] as const;
export type Outcome = typeof outcomes[number];
export const methods = ['A', 'B', 'C', 'D'] as const;
export type Method = typeof methods[number];
export type Probabilities = Record<Outcome, number>;
export interface Observation {
  roomId: string; roomName: string; shoeId: string; round: number; outcome: Outcome;
  confidence: number; source: 'dom' | 'ocr' | 'demo' | 'manual' | 'chrome'; historical: boolean;
  occurredAt?: string; score?: number;
}
export interface GameResult extends Observation { id: string; recordedAt: string }
export interface Forecast {
  id: string; roomId: string; shoeId: string; targetRound: number; cutoffRound: number;
  horizon: 1 | 2 | 3 | 4; method: Method; probabilities: Probabilities; pick: Outcome;
  sampleSize: number; basis: string; createdAt: string;
  actual?: Outcome; mark?: 'O' | 'X';
}
export interface Pending extends Observation { id: string; reason: string; observedAt: string }
export interface Accuracy {
  count: number; correct: number; rate: number | null;
  noTieCount: number; noTieCorrect: number; noTieRate: number | null;
  brier: number | null; logLoss: number | null;
}
export interface RoomStats {
  total: number; counts: Record<Outcome, number>; ratios: Probabilities;
  current: { outcome: 'B' | 'P' | null; length: number }; longest: { B: number; P: number };
  transitions: number; comparisons: number;
  accuracy: Record<Method, { all: Accuracy; last10: Accuracy; last30: Accuracy; last100: Accuracy }>;
  advanceComparisons: number; advanceAccuracy: Record<Method, Accuracy>;
}
export interface Room { id: string; name: string; shoes: string[]; updatedAt: string }
export interface Snapshot {
  rooms: Room[]; roomId: string | null; shoeId: string | null; results: GameResult[];
  forecasts: Forecast[]; pending: Pending[]; stats: RoomStats;
}
export interface CollectorStatus {
  state: 'idle' | 'demo' | 'unsupported' | 'collecting' | 'error'; message: string;
  history: 'unknown' | 'visible-only';
}
export interface AdapterProfile {
  id: string; hosts: string[]; roomSelector: string; roomIdAttribute: string;
  shoeSelector: string; shoeIdAttribute: string; rowSelector: string;
  roundAttribute: string; outcomeAttribute: string; occurredAtAttribute?: string;
  confidence: number;
  ocr?: { imageSelector: string; roundSelector: string; roundAttribute: string };
}
export interface AnalyzerAPI {
  accessStatus():Promise<AccessStatus>;
  unlock(password:string):Promise<AccessStatus>;
  captureWindows(): Promise<CaptureWindow[]>;
  captureStart(id: string): Promise<void>;
  captureStop(): Promise<void>;
  captureInfo(): Promise<CaptureInfo>;
  captureNewShoe(): Promise<void>;
  beginWindowDrag(point:{x:number;y:number}):void;
  moveWindowDrag(point:{x:number;y:number}):void;
  endWindowDrag():void;
  onCapture(callback: (info: CaptureInfo) => void): () => void;
  analyzeImage(): Promise<ImageReview | ImagePreview | null>;
  pasteImage(): Promise<ImageReview | ImagePreview>;
  reviewSequence(sequence: string): Promise<ImageReview>;
  appendManual(input: { roomId: string; shoeId: string; round: number; outcome: Outcome }): Promise<void>;
  saveImage(request: ImageSaveRequest): Promise<ImageSaveResult>;
  chromeInfo(): Promise<ChromeConnection>;
  chromeReset(): Promise<void>;
  chromeExtensionFolder(): Promise<string>;
  chromeOpenPanel(): Promise<boolean>;
  onChrome(callback: (status: ChromeConnection) => void): () => void;
  snapshot(roomId?: string, shoeId?: string): Promise<Snapshot>;
  open(mode: 'site' | 'demo'): Promise<void>;
  closeBrowser(): Promise<void>;
  confirm(id: string, accept: boolean): Promise<void>;
  exportCSV(roomId: string, shoeId: string): Promise<boolean>;
  importProfile(): Promise<boolean>;
  setBrowserBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  onChange(callback: () => void): () => void;
  onStatus(callback: (status: CollectorStatus) => void): () => void;
}
export interface CaptureWindow { id: string; name: string }
export interface CaptureInfo {
  enabled: boolean; state: 'idle'|'waiting'|'collecting'|'blocked'; message: string;
  windowName?: string; preview?: string; capturedAt?: string; processedAt?: string;
  roomId?: string; roomName?: string; shoeId?: string; rounds?: number;
  originalPreview?:string; recognitionScale?:2; recognitionMs?:number; appVersion?:string; detectedResults?:number;
  analysisMs?:number; reusedFrame?:boolean; scannedPixels?:number;
  previewUnchanged?:boolean;
}
export interface AccessStatus {locked:boolean;retryAfterMs:number}
export interface ImageReview {
  id: string; outcomes: Outcome[]; confidence: number; preview: string; warnings: string[];
  format: 'bead' | 'big-road'; tieAfter: number[]; diagnostics?: RecognitionDiagnostics;
  scores?: Array<number | null>; scoreConfidences?: number[];
}
export interface RecognitionDiagnostics {
  width: number; height: number; coloredPixels: number; gridCandidates: number;
  circleCandidates: number; circleGrids: number;
  stage: 'color' | 'grid' | 'circles' | 'order' | 'ambiguous' | 'complete'; detail: string;
}
export interface ImagePreview { preview: string; recognitionError: string; diagnostics?: RecognitionDiagnostics }
export interface ImageSaveRequest { reviewId: string; roomName: string; shoeId: string; startRound: number; outcomes: Outcome[]; scores?: Array<number | null>; tiesAfter?: Array<{ index: number; count: number }> }
export interface ImageSaveResult { roomId: string; shoeId: string; added: number; pending: number }
export interface ChromeConnection {
  state: 'waiting' | 'connected' | 'error'; paired: boolean; pairingCode: string | null;
  tabs: number; message: string; profileConfigured: boolean; targets: ChromeGameTarget[];
}
export interface ChromeGameTarget {
  host: string; kind: 'window' | 'frame'; permission: boolean;
  recognition: 'unconfigured' | 'waiting' | 'unmatched' | 'observed';
}
