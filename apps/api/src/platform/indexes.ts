import type { Logger } from '@alola/security';
import type { Connection } from 'mongoose';
import {
  decisionModel,
  delegationModel,
  policyModel,
  requestModel,
} from '../modules/approval/model';
import { auditModel } from '../modules/audit/model';
import {
  accountModel,
  accountTokenModel,
  refreshTokenModel,
  sessionModel,
} from '../modules/identity/model';
import {
  branchModel,
  departmentModel,
  jobTitleModel,
  legalEntityModel,
  placementModel,
  teamModel,
} from '../modules/organization/model';
import { accountGrantModel, roleModel } from '../modules/security/model';

/**
 * Index creation (ADR-0002: "every new collection declares its indexes in the same change").
 *
 * `autoIndex` is disabled globally so that connecting never mutates the database implicitly. Indexes are
 * therefore created explicitly at startup and by integration tests. `createIndexes` is idempotent.
 */
export async function ensureIndexes(connection: Connection, logger: Logger): Promise<string[]> {
  const models = [
    auditModel(connection),
    roleModel(connection),
    accountGrantModel(connection),
    accountModel(connection),
    sessionModel(connection),
    refreshTokenModel(connection),
    accountTokenModel(connection),
    policyModel(connection),
    requestModel(connection),
    decisionModel(connection),
    delegationModel(connection),
    legalEntityModel(connection),
    branchModel(connection),
    departmentModel(connection),
    teamModel(connection),
    jobTitleModel(connection),
    placementModel(connection),
  ];
  const created: string[] = [];
  for (const model of models) {
    await model.createIndexes();
    const indexes = await model.collection.indexes();
    for (const index of indexes) created.push(`${model.collection.collectionName}.${index.name}`);
  }
  logger.info({ indexes: created.length }, 'MongoDB indexes ensured');
  return created;
}
