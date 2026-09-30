-- One-time backfill: give every account that predates the username column the
-- local part of its email, which is what the sign-in lookup was already
-- accepting. Without this the user list shows a blank username for accounts that
-- in fact sign in with one, leaving two answers to the same question.
UPDATE `users`
SET `username` = LOWER(SUBSTRING_INDEX(`email`, '@', 1))
WHERE `username` IS NULL
  AND `email` IS NOT NULL
  AND `email` <> '';
