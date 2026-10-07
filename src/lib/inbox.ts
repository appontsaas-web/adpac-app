import { db } from './db';
import type { CurrentUser } from './access';

/** Prisma `where` limiting agent messages to clients the user can see (admin: all). */
export function inboxScope(me: CurrentUser) {
  return me.role === 'ADMIN' ? {} : { client: { assignments: { some: { userId: me.id } } } };
}

export async function unhandledInboxCount(me: CurrentUser): Promise<number> {
  return db.agentMessage.count({ where: { handledAt: null, ...inboxScope(me) } });
}
