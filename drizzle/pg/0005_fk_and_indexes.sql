-- ════════════════════════════════════════════════════════════════════════
-- Intégrité référentielle (foreign keys ON DELETE CASCADE) + index de perf.
--
-- Les FK sont ajoutées en NOT VALID : la contrainte + la cascade s'appliquent
-- à TOUTES les opérations futures (insert/update/delete) sans rescanner les
-- lignes existantes — indispensable car des orphelins peuvent déjà exister
-- (l'ancienne suppression de projet ne nettoyait pas versions/chats/fichiers).
-- Tout est idempotent (IF NOT EXISTS / garde sur pg_constraint).
-- ════════════════════════════════════════════════════════════════════════

-- ── Index sur les colonnes de jointure / filtrage (anti full-scan) ─────────
CREATE INDEX IF NOT EXISTS "projects_userId_idx"                 ON "projects" ("userId");
CREATE INDEX IF NOT EXISTS "versions_projectId_idx"              ON "versions" ("projectId");
CREATE INDEX IF NOT EXISTS "versions_userId_idx"                 ON "versions" ("userId");
CREATE INDEX IF NOT EXISTS "chat_messages_projectId_idx"         ON "chat_messages" ("projectId");
CREATE INDEX IF NOT EXISTS "project_files_projectId_idx"         ON "project_files" ("projectId");
CREATE INDEX IF NOT EXISTS "project_files_versionId_idx"         ON "project_files" ("versionId");
CREATE INDEX IF NOT EXISTS "usage_logs_userId_idx"               ON "usage_logs" ("userId");
CREATE INDEX IF NOT EXISTS "usage_logs_projectId_idx"            ON "usage_logs" ("projectId");
CREATE INDEX IF NOT EXISTS "project_collaborators_projectId_idx" ON "project_collaborators" ("projectId");
CREATE INDEX IF NOT EXISTS "project_collaborators_collabId_idx"  ON "project_collaborators" ("collaboratorId");
CREATE INDEX IF NOT EXISTS "api_keys_userId_idx"                 ON "api_keys" ("userId");
CREATE INDEX IF NOT EXISTS "user_integrations_userId_idx"        ON "user_integrations" ("userId");
--> statement-breakpoint

-- ── Foreign keys (NOT VALID, cascade) ──────────────────────────────────────
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN (
    SELECT * FROM (VALUES
      ('api_keys',              'userId',         'users',    'id', 'CASCADE',  'api_keys_userId_fk'),
      ('projects',              'userId',         'users',    'id', 'CASCADE',  'projects_userId_fk'),
      ('versions',             'projectId',       'projects', 'id', 'CASCADE',  'versions_projectId_fk'),
      ('versions',              'userId',         'users',    'id', 'CASCADE',  'versions_userId_fk'),
      ('chat_messages',        'projectId',       'projects', 'id', 'CASCADE',  'chat_messages_projectId_fk'),
      ('chat_messages',         'userId',         'users',    'id', 'CASCADE',  'chat_messages_userId_fk'),
      ('project_files',        'projectId',       'projects', 'id', 'CASCADE',  'project_files_projectId_fk'),
      ('project_files',        'versionId',       'versions', 'id', 'CASCADE',  'project_files_versionId_fk'),
      ('usage_logs',            'userId',         'users',    'id', 'CASCADE',  'usage_logs_userId_fk'),
      ('usage_logs',           'projectId',       'projects', 'id', 'SET NULL', 'usage_logs_projectId_fk'),
      ('project_collaborators','projectId',       'projects', 'id', 'CASCADE',  'project_collaborators_projectId_fk'),
      ('project_collaborators', 'ownerId',        'users',    'id', 'CASCADE',  'project_collaborators_ownerId_fk'),
      ('project_collaborators', 'collaboratorId', 'users',    'id', 'SET NULL', 'project_collaborators_collabId_fk'),
      ('user_integrations',     'userId',         'users',    'id', 'CASCADE',  'user_integrations_userId_fk'),
      ('user_integrations',    'projectId',       'projects', 'id', 'SET NULL', 'user_integrations_projectId_fk')
    ) AS t(child_table, child_col, parent_table, parent_col, on_delete, fk_name)
  ) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.fk_name) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I) ON DELETE %s NOT VALID',
        fk.child_table, fk.fk_name, fk.child_col, fk.parent_table, fk.parent_col, fk.on_delete
      );
    END IF;
  END LOOP;
END $$;
