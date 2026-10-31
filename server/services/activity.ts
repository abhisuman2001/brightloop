import { db } from '../db';

export interface Actor {
  id: number | null;
  name: string;
  isAdmin?: boolean;
}

export const SYSTEM_ACTOR: Actor = { id: null, name: 'Automation' };

export function logActivity(actor: Actor, action: string, entityType: string, entityId: number | null, summary: string, at?: string) {
  db()
    .prepare('INSERT INTO activity_log (actor, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(actor.name, action, entityType, entityId, summary, at ?? new Date().toISOString());
}
