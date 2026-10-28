'use client';

import { use } from 'react';
import { CampaignWizard } from '@/components/CampaignWizard';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import { useApi } from '@/lib/api';
import { campaignToInput, formFromInput } from '@/lib/campaign';
import { useI18n } from '@/lib/i18n';
import type { Campaign } from '@/lib/types';

export default function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const { data, error } = useApi<Campaign>(`/campaigns/${id}`);
  return (
    <>
      <PageHeader
        title={data ? `${t('common.edit')}: ${data.name}` : t('common.edit')}
        back={`/admin/campaigns/${id}`}
      />
      <ErrorBox error={error} />
      {/* A pending change is edited in place of the live configuration. */}
      {data ? (
        <CampaignWizard
          campaign={data}
          initial={formFromInput(data.pendingChanges ?? campaignToInput(data))}
        />
      ) : (
        !error && <Loading />
      )}
    </>
  );
}
