-- Drop the "250 restaurants" table — a one-off customer import dump that was
-- never part of the schema. No backend routes referenced it and it had no
-- foreign key relationships. Already applied directly to production on 2026-05-18.
DROP TABLE IF EXISTS "250 restaurants";
