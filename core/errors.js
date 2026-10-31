// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
/** Errors callers can act on: LOW_CONFIDENCE, NOT_FOUND, STALE, DENIED, NOT_ALLOWED, NO_PERMISSION… */
export class JevisError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}
