'use client';

import { useState, type ReactNode } from 'react';
import type { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, ErrorBox, Modal } from './ui';

/** Modal with a form body; `onSubmit` errors are shown inline. */
export function FormModal({
  open,
  title,
  onClose,
  onSubmit,
  children,
  submitLabel,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: ReactNode;
  submitLabel?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit();
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {submitLabel ?? t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={error} />
        {children}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
