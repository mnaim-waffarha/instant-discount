'use client';

import { CampaignWizard } from '@/components/CampaignWizard';
import { PageHeader } from '@/components/ui';
import { emptyForm } from '@/lib/campaign';
import { useI18n } from '@/lib/i18n';

export default function NewCampaignPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('campaigns.new')} back="/admin/campaigns" />
      <CampaignWizard initial={emptyForm()} />
    </>
  );
}
