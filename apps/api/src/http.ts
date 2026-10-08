export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return String(error).includes("UNIQUE");
}
