-- 'LOWER_INSTALLMENT' is 17 characters, but both overpayment-mode columns were
-- created as VARCHAR(16), so saving a lower-installment scenario failed with
-- "value too long for type character varying(16)" (22001). Widen both to 64.
-- Safe on any database: widening a varchar never touches stored data, and
-- re-running is a no-op in effect.
ALTER TABLE loan_scenarios
    ALTER COLUMN recurring_extra_mode TYPE VARCHAR(64),
    ALTER COLUMN target_monthly_payment_mode TYPE VARCHAR(64);
