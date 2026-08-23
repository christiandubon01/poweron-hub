import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { SCHEMA_VERSION, type LifecycleEventDocument, type LifecycleEventType } from '../types.ts';

export interface EventWriter {
  append(type: LifecycleEventType, data?: Record<string, unknown>): Promise<LifecycleEventDocument>;
}

export function createEventWriter(options: {
  eventsPath: string;
  hostId: string;
  instanceId: string;
  repoKey: string;
}): EventWriter {
  let sequence = 0;

  return {
    async append(type: LifecycleEventType, data: Record<string, unknown> = {}): Promise<LifecycleEventDocument> {
      sequence += 1;
      const document: LifecycleEventDocument = {
        schemaVersion: SCHEMA_VERSION,
        eventId: randomUUID(),
        seq: sequence,
        type,
        hostId: options.hostId,
        instanceId: options.instanceId,
        repoKey: options.repoKey,
        timestamp: new Date().toISOString(),
        data,
      };

      await mkdir(path.dirname(options.eventsPath), { recursive: true });
      await appendFile(options.eventsPath, `${JSON.stringify(document)}\n`, 'utf8');
      return document;
    },
  };
}
