import { db } from './db';

const SETTING_ID = 'global';

/** Whether non-admin staff can see the beta "measured" AI impact card (see lib/realImpact.ts). Admins always see it regardless of this flag. Defaults to false — an admin has to explicitly turn it on. */
export async function getRealImpactVisibleToStaff(): Promise<boolean> {
  const setting = await db.appSetting.findUnique({ where: { id: SETTING_ID } });
  return setting?.realImpactVisibleToStaff ?? false;
}

export async function setRealImpactVisibleToStaff(visible: boolean, userId?: string) {
  return db.appSetting.upsert({
    where: { id: SETTING_ID },
    create: { id: SETTING_ID, realImpactVisibleToStaff: visible, updatedByUserId: userId ?? null },
    update: { realImpactVisibleToStaff: visible, updatedByUserId: userId ?? null },
  });
}
