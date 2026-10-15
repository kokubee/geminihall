export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelOutputError";
  }
}

export class InvalidClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidClaimError";
  }
}

export class SchemaViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaViolationError";
  }
}
