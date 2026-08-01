'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { loanRateChangesApi } from '@/lib/loan-rate-changes';
import { LoanRateChange, ScheduledPaymentPreview } from '@/types/loan-rate-change';
import { Account } from '@/types/account';
import { getErrorMessage } from '@/lib/errors';
import { useNumberFormat } from '@/hooks/useNumberFormat';

export type RatePaymentMode = 'keep' | 'set' | 'recalculate';

export interface RateFormState {
  effectiveDate: string;
  annualRate: string;
  paymentMode: RatePaymentMode;
  newPaymentAmount: string;
  note: string;
}

const emptyForm = (): RateFormState => ({
  effectiveDate: '',
  annualRate: '',
  paymentMode: 'keep',
  newPaymentAmount: '',
  note: '',
});

/**
 * The rate-timeline editing behaviour shared by the Loan Schedule's rate cells
 * (each opens the Add form pre-filled with its date and rate), the rate
 * controls (Add / per-change edit + delete), and the Rate History panel: the
 * create/update/delete mutations, the scheduled-payment "ask permission"
 * prompt, and detect-from-history. Kept out of the components so the schedule,
 * the controls, and the panel all drive one instance.
 */
export function useLoanRateEditing(account: Account, onChanged: () => void) {
  const t = useTranslations('accounts');
  const { formatCurrency } = useNumberFormat();

  const [formModal, setFormModal] = useState<
    { mode: 'add' } | { mode: 'edit'; change: LoanRateChange } | null
  >(null);
  const [form, setForm] = useState<RateFormState>(emptyForm());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [changeToDelete, setChangeToDelete] = useState<LoanRateChange | null>(null);
  const [showDetectConfirm, setShowDetectConfirm] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [scheduledPreview, setScheduledPreview] =
    useState<ScheduledPaymentPreview | null>(null);

  const isMortgage = account.accountType === 'MORTGAGE';

  const openAdd = () => {
    setForm(emptyForm());
    setFormModal({ mode: 'add' });
  };

  const openEdit = (change: LoanRateChange) => {
    setForm({
      effectiveDate: change.effectiveDate,
      annualRate: String(change.annualRate),
      paymentMode: change.newPaymentAmount != null ? 'set' : 'keep',
      newPaymentAmount:
        change.newPaymentAmount != null ? String(change.newPaymentAmount) : '',
      note: change.note ?? '',
    });
    setFormModal({ mode: 'edit', change });
  };

  /**
   * Open the Add form pre-filled with a date and rate -- used from a schedule
   * row's rate cell so the user can record a rate change at that point with the
   * values already in hand. Payment mode defaults to "keep".
   */
  const openAddWith = (effectiveDate: string, annualRate: number) => {
    setForm({
      effectiveDate: effectiveDate.split('T')[0],
      annualRate: String(annualRate),
      paymentMode: 'keep',
      newPaymentAmount: '',
      note: '',
    });
    setFormModal({ mode: 'add' });
  };

  const closeForm = () => setFormModal(null);

  const parsedRate = Number.parseFloat(form.annualRate);
  const parsedPayment = Number.parseFloat(form.newPaymentAmount);
  const isFormValid =
    form.effectiveDate.length > 0 &&
    Number.isFinite(parsedRate) &&
    parsedRate >= 0 &&
    parsedRate <= 100 &&
    (form.paymentMode !== 'set' ||
      (Number.isFinite(parsedPayment) && parsedPayment > 0));

  const submitForm = async () => {
    if (!formModal || !isFormValid) return;
    setIsSubmitting(true);
    try {
      const note = form.note.trim();
      if (formModal.mode === 'add') {
        const result = await loanRateChangesApi.create(account.id, {
          effectiveDate: form.effectiveDate,
          annualRate: parsedRate,
          newPaymentAmount: form.paymentMode === 'set' ? parsedPayment : null,
          recalculatePayment: form.paymentMode === 'recalculate',
          note: note || null,
        });
        toast.success(t('loanDetail.rateHistory.addedToast'));
        setFormModal(null);
        onChanged();
        // A linked scheduled bill payment can be resynced to the new rate, but
        // only with the user's permission -- surface the pending change.
        if (result.scheduledPaymentPreview) {
          setScheduledPreview(result.scheduledPaymentPreview);
        }
        return;
      }
      await loanRateChangesApi.update(account.id, formModal.change.id, {
        effectiveDate: form.effectiveDate,
        annualRate: parsedRate,
        newPaymentAmount: form.paymentMode === 'set' ? parsedPayment : null,
        note: note || null,
      });
      toast.success(t('loanDetail.rateHistory.updatedToast'));
      setFormModal(null);
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err, t('loanDetail.rateHistory.saveFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };


  const requestDelete = (change: LoanRateChange) => setChangeToDelete(change);
  const cancelDelete = () => setChangeToDelete(null);
  const confirmDelete = async () => {
    if (!changeToDelete) return;
    try {
      await loanRateChangesApi.delete(account.id, changeToDelete.id);
      toast.success(t('loanDetail.rateHistory.deletedToast'));
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err, t('loanDetail.rateHistory.deleteFailed')));
    } finally {
      setChangeToDelete(null);
    }
  };

  const applyScheduledPayment = async () => {
    if (!scheduledPreview) return;
    setScheduledPreview(null);
    try {
      await loanRateChangesApi.applyScheduledPayment(account.id);
      toast.success(t('loanDetail.rateHistory.scheduledUpdateAppliedToast'));
      onChanged();
    } catch (err) {
      toast.error(
        getErrorMessage(err, t('loanDetail.rateHistory.scheduledUpdateFailed')),
      );
    }
  };

  const skipScheduledPayment = () => {
    setScheduledPreview(null);
    toast(t('loanDetail.rateHistory.scheduledUpdateSkippedToast'), { icon: 'ℹ️' });
  };

  // Detect rate changes from the payment history (backend segmentation). It is
  // non-destructive: only previously *inferred* rows are replaced; manual and
  // initial rows, and the account's own rate/payment, are left untouched.
  const openDetect = () => setShowDetectConfirm(true);
  const cancelDetect = () => setShowDetectConfirm(false);
  const runDetect = async () => {
    setShowDetectConfirm(false);
    setIsDetecting(true);
    try {
      const result = await loanRateChangesApi.detect(account.id);
      toast.success(
        t('loanDetail.rateHistory.detectedToast', { count: result.created.length }),
      );
      for (const warning of result.warnings) toast(warning, { icon: '⚠️' });
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err, t('loanDetail.rateHistory.detectFailed')));
    } finally {
      setIsDetecting(false);
    }
  };

  const scheduledUpdateMessage = scheduledPreview
    ? t('loanDetail.rateHistory.scheduledUpdateMessage', {
        name:
          scheduledPreview.scheduledTransactionName ||
          t('loanDetail.rateHistory.scheduledUpdateDefaultName'),
        payment: formatCurrency(
          scheduledPreview.proposedPaymentAmount,
          scheduledPreview.currencyCode,
        ),
        principal: formatCurrency(
          scheduledPreview.proposedPrincipal,
          scheduledPreview.currencyCode,
        ),
        interest: formatCurrency(
          scheduledPreview.proposedInterest,
          scheduledPreview.currencyCode,
        ),
      })
    : '';

  return {
    isMortgage,
    // header actions
    openAdd,
    // per-change actions
    openEdit,
    openAddWith,
    requestDelete,
    // add/edit form
    formModal,
    form,
    setForm,
    isSubmitting,
    isFormValid,
    submitForm,
    closeForm,
    // delete confirm
    changeToDelete,
    confirmDelete,
    cancelDelete,
    // detect from history
    openDetect,
    cancelDetect,
    showDetectConfirm,
    isDetecting,
    runDetect,
    // scheduled-payment prompt
    scheduledPreview,
    scheduledUpdateMessage,
    applyScheduledPayment,
    skipScheduledPayment,
  };
}

export type LoanRateEditing = ReturnType<typeof useLoanRateEditing>;
