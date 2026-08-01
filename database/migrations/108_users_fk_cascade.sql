-- Repair foreign keys to users(id) that block account deletion.
--
-- schema.sql declares every user-owned table's FK as ON DELETE CASCADE; the
-- single exception, currencies.created_by_user_id, is ON DELETE SET NULL.
-- Some deployed databases also carry TypeORM-generated constraints (auto-named
-- FK_<hash>, e.g. FK_3ddc983c5f7bcf132fd8732c3f4 on refresh_tokens) created
-- from the `@ManyToOne(() => User)` entity relations, which declare no
-- ON DELETE action. Those default to NO ACTION, so deleting a user fails with
--   update or delete on table "users" violates foreign key constraint ...
--
-- This rewrites every FK referencing users whose delete action is NO ACTION or
-- RESTRICT into ON DELETE CASCADE, and simply drops it when an equivalent
-- cascading constraint already covers the same columns. SET NULL / SET DEFAULT
-- constraints are left alone, so currencies keeps its intended behaviour.
-- No-op on a database created from schema.sql.
DO $$
DECLARE
  r RECORD;
  new_def TEXT;
BEGIN
  FOR r IN
    SELECT c.oid,
           c.conname,
           c.conrelid,
           c.conkey,
           c.confkey,
           c.conrelid::regclass::text AS table_name,
           pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class ref ON ref.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = ref.relnamespace
    WHERE c.contype = 'f'
      AND ref.relname = 'users'
      AND n.nspname = 'public'
      AND c.confdeltype IN ('a', 'r')  -- NO ACTION / RESTRICT
  LOOP
    -- A duplicate of an already-cascading constraint adds nothing but the
    -- deletion block, so drop it outright.
    IF EXISTS (
      SELECT 1
      FROM pg_constraint dup
      WHERE dup.contype = 'f'
        AND dup.conrelid = r.conrelid
        AND dup.confrelid = (SELECT confrelid FROM pg_constraint WHERE oid = r.oid)
        AND dup.conkey = r.conkey
        AND dup.confkey = r.confkey
        AND dup.confdeltype = 'c'
        AND dup.oid <> r.oid
    ) THEN
      RAISE NOTICE 'Dropping redundant % on %', r.conname, r.table_name;
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.table_name, r.conname);
      CONTINUE;
    END IF;

    new_def := regexp_replace(
      r.def,
      '\s+ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)',
      '',
      'gi'
    );
    IF new_def ~* 'DEFERRABLE' THEN
      new_def := regexp_replace(
        new_def,
        '(\s+)((NOT\s+)?DEFERRABLE)',
        ' ON DELETE CASCADE\1\2',
        'i'
      );
    ELSE
      new_def := new_def || ' ON DELETE CASCADE';
    END IF;

    RAISE NOTICE 'Recreating % on % with ON DELETE CASCADE', r.conname, r.table_name;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.table_name, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I %s',
      r.table_name,
      r.conname,
      new_def
    );
  END LOOP;
END $$;
