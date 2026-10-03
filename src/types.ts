export interface Cell {
  row: number;
  col: number;
}

export interface Board {
  id: number;
  rows: number;
  cols: number;
  cells: string[][];
  createdAt: string;
}

export interface FoundWord {
  word: string;
  path: Cell[];
}

export interface CheckResult {
  word: string;
  found: boolean;
  paths: Cell[][];
}

export interface SearchReport {
  id: number;
  boardId: number;
  dictVersion: number;
  minLength: number;
  words: FoundWord[];
  createdAt: string;
}

export const MAX_DIM = 6;
export const MIN_DIM = 1;
export const DEFAULT_MIN_WORD_LENGTH = 2;

export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BAD_REQUEST"
  | "INTERNAL";

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
