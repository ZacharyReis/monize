-- 092_import_match_candidate_dismissed.sql
-- T-555: add a 'dismissed' terminal state so a staged match can be rejected
-- WITHOUT inserting the bank row (merge folds; keep-both inserts; dismiss drops).
ALTER TABLE import_match_candidate
    DROP CONSTRAINT IF EXISTS import_match_candidate_state_check;
ALTER TABLE import_match_candidate
    ADD CONSTRAINT import_match_candidate_state_check
    CHECK (state IN ('pending', 'merged', 'kept', 'dismissed'));
