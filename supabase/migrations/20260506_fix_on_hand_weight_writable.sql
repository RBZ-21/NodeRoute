-- on_hand_weight must be a plain writable numeric column.
-- Remove any generated/computed definition if it was accidentally created that way,
-- then ensure it is a regular column with a safe default.
--
-- If the column is already a plain column this is a no-op (IF NOT EXISTS guards).
ALTER TABLE seafood_inventory
  ALTER COLUMN on_hand_weight DROP EXPRESSION IF EXISTS,
  ALTER COLUMN on_hand_weight SET DEFAULT 0,
  ALTER COLUMN on_hand_weight DROP NOT NULL;
