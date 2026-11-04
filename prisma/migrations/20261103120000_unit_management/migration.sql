-- Add unit precision metadata without replacing or reassigning existing rows.
-- Review the read-only report from `npm run db:unit-mapping` before deployment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "units"
    WHERE length("symbol") > 5
  ) THEN
    RAISE EXCEPTION 'Unit migration stopped: one or more symbols exceed five characters; review the unit mapping report first.';
  END IF;

  IF EXISTS (
    SELECT lower(btrim("name"))
    FROM "units"
    GROUP BY lower(btrim("name"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Unit migration stopped: normalized unit names collide; review and resolve them before deployment.';
  END IF;
END $$;

ALTER TABLE "units" ALTER COLUMN "symbol" TYPE VARCHAR(5);
ALTER TABLE "units" ADD COLUMN "allows_decimals" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "units_name_normalized_key" ON "units" (lower(btrim("name")));
