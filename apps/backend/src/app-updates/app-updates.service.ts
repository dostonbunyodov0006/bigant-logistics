import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

/** Pure: the ids in a comma-separated list, blanks dropped. Exported for tests. */
export function parseTesterIds(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Which update channel a phone listens to (owner, 09.11.2026).
 *
 * An update used to reach every driver at once, and a bad one broke every
 * phone the same morning. Now a new update is published to `test` first: only
 * the users listed in OTA_TESTER_USER_IDS get it, and the owner promotes it to
 * everyone (tools/promote-update.sh) once it works on those phones. The app
 * asks here and tells its updater; nginx picks the manifest by that answer.
 */
@Injectable()
export class AppUpdatesService {
  private readonly testers: Set<string>;

  constructor(config: ConfigService<Env, true>) {
    this.testers = parseTesterIds(config.get('OTA_TESTER_USER_IDS', { infer: true }));
  }

  isTester(userId: string): boolean {
    return this.testers.has(userId);
  }
}
