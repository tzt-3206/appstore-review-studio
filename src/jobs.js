import { EventEmitter } from 'node:events';

export class JobStore {
  constructor() {
    this.jobs = new Map();
  }

  create(input) {
    const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      id,
      input,
      events: [],
      status: 'pending',
      result: null,
      error: null,
      emitter: new EventEmitter(),
      created_at: new Date().toISOString(),
    };
    this.jobs.set(id, job);
    return job;
  }

  get(id) {
    return this.jobs.get(id);
  }

  recordEvent(id, event) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.events.push(event);
    if (job.events.length > 5000) job.events.splice(0, job.events.length - 5000);
    job.emitter.emit('event', event);
  }

  start(id) {
    const job = this.jobs.get(id);
    if (job) job.status = 'running';
  }

  finish(id, result, error = null) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = error ? 'failed' : 'done';
    job.result = result;
    job.error = error;
    job.completed_at = new Date().toISOString();
    job.emitter.emit('done', { status: job.status, result, error });
  }

  snapshot(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    return {
      id: job.id,
      status: job.status,
      input: job.input,
      events: job.events,
      result: job.result,
      error: job.error,
      created_at: job.created_at,
      completed_at: job.completed_at,
    };
  }
}

