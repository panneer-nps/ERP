"use client";

import { useLocale } from "./i18n";

export function MigrationHelp() {
  const { t } = useLocale();
  return <details className="migration-help">
    <summary>{t("migrationHelpTitle")}</summary>
    <p>{t("migrationBackup")}</p>
    <p>{t("migrationRunFrom")}</p>
    <pre><code>npm.cmd run db:status</code></pre>
    <p>{t("migrationApply")}</p>
    <pre><code>npm.cmd run db:migrate</code></pre>
    <p>{t("migrationRestart")}</p>
    <pre><code>npm.cmd run dev:api</code></pre>
  </details>;
}
