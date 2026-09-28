import type { Logger } from '@alola/security';
import type { Connection } from 'mongoose';
import {
  decisionModel,
  delegationModel,
  policyModel,
  requestModel,
} from '../modules/approval/model';
import { auditModel } from '../modules/audit/model';
import { instrumentModel, receiptModel, reminderModel } from '../modules/collections/model';
import { documentModel, documentVersionModel, templateModel } from '../modules/documents/model';
import {
  brandAssetModel,
  companyProfileModel,
  companyProfileRevisionModel,
} from '../modules/company/model';
import { activityModel, customerModel, leadModel } from '../modules/crm/model';
import {
  accountModel,
  accountTokenModel,
  refreshTokenModel,
  sessionModel,
} from '../modules/identity/model';
import { buildingModel, projectModel, unitEventModel, unitModel } from '../modules/inventory/model';
import { campaignModel } from '../modules/marketing/model';
import {
  notificationAttemptModel,
  notificationModel,
  notificationPreferencesModel,
} from '../modules/notifications/model';
import {
  branchModel,
  departmentModel,
  jobTitleModel,
  legalEntityModel,
  placementHistoryModel,
  placementModel,
  teamModel,
} from '../modules/organization/model';
import {
  contractModel,
  counterModel,
  installmentModel,
  reservationModel,
} from '../modules/sales/model';
import {
  counterModel as numberCounterModel,
  issuedNumberModel,
  sequenceModel as numberSequenceModel,
} from '../modules/numbering/model';
import { accountGrantModel, roleModel } from '../modules/security/model';
import {
  referenceItemModel,
  settingRevisionModel,
  settingValueModel,
} from '../modules/settings/model';

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
    placementHistoryModel(connection),
    projectModel(connection),
    buildingModel(connection),
    unitModel(connection),
    unitEventModel(connection),
    customerModel(connection),
    leadModel(connection),
    activityModel(connection),
    reservationModel(connection),
    contractModel(connection),
    installmentModel(connection),
    counterModel(connection),
    receiptModel(connection),
    instrumentModel(connection),
    reminderModel(connection),
    campaignModel(connection),
    companyProfileModel(connection),
    companyProfileRevisionModel(connection),
    brandAssetModel(connection),
    settingValueModel(connection),
    settingRevisionModel(connection),
    referenceItemModel(connection),
    numberSequenceModel(connection),
    numberCounterModel(connection),
    issuedNumberModel(connection),
    documentModel(connection),
    documentVersionModel(connection),
    templateModel(connection),
    notificationModel(connection),
    notificationAttemptModel(connection),
    notificationPreferencesModel(connection),
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
