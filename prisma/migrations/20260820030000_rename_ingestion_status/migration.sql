-- RenameIngestionStatus: COMPLETED -> SUCCESS
-- Safe for dev database with no existing COMPLETED records.

ALTER TYPE "IngestionStatus" RENAME VALUE 'COMPLETED' TO 'SUCCESS';
