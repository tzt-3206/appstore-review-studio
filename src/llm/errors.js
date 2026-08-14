export class ModelUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ModelUnavailableError';
    this.details = details;
  }
}

