import type { DomainEvent, Task } from "../../schemas/src/index.js";

export interface Projection {
  readonly lastSequence: number;
  readonly tasks: ReadonlyMap<string, Task>;
  readonly leases: ReadonlyMap<string, { leaseId: string; ownerId: string; expiresAt: string }>;
}

export function replay(events: readonly DomainEvent[]): Projection {
  const tasks = new Map<string, Task>();
  const leases = new Map<string, { leaseId: string; ownerId: string; expiresAt: string }>();
  let lastSequence = 0;

  for (const event of events) {
    if (event.sequence !== lastSequence + 1) throw new Error("Event sequence is not contiguous.");
    lastSequence = event.sequence;
    switch (event.type) {
      case "task.created":
        if (tasks.has(event.payload.id)) throw new Error("Task already exists.");
        tasks.set(event.payload.id, event.payload);
        break;
      case "task.status_changed": {
        const task = tasks.get(event.payload.taskId);
        if (!task) throw new Error("Task does not exist.");
        if (event.payload.revision !== task.revision + 1) throw new Error("Task revision conflict.");
        tasks.set(task.id, { ...task, status: event.payload.status, revision: event.payload.revision });
        break;
      }
      case "lease.granted":
        if (!tasks.has(event.payload.taskId)) throw new Error("Task does not exist.");
        if (leases.has(event.payload.taskId)) throw new Error("Task already leased.");
        leases.set(event.payload.taskId, {
          leaseId: event.payload.leaseId,
          ownerId: event.payload.ownerId,
          expiresAt: event.payload.expiresAt
        });
        break;
      case "lease.released": {
        const lease = leases.get(event.payload.taskId);
        if (!lease || lease.leaseId !== event.payload.leaseId) throw new Error("Lease mismatch.");
        leases.delete(event.payload.taskId);
        break;
      }
    }
  }
  return { lastSequence, tasks, leases };
}
