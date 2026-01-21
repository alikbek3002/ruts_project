import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiListDirections,
  type Direction,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { Loader } from "../../components/Loader";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./AdminDirections.module.css";
import { Map, Hash } from "lucide-react";
import { CurriculumModal } from "./modals/CurriculumModal";

export function AdminDirectionsPage() {
  const { state } = useAuth();
  const { t } = useI18n();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [directions, setDirections] = useState<Direction[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await apiListDirections(token);
      setDirections(resp.directions || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (can) reload().catch((e) => setErr(String(e)));
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const titleKey = user.role === "manager" ? "admin.directions.pageTitleManager" : "admin.directions.pageTitleAdmin";

  /* New logic */
  const [modalDirection, setModalDirection] = useState<Direction | null>(null);

  /* ... */

  return (
    <AppShell
      titleKey={titleKey}
      nav={getAdminNavItems(base)}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>{t("nav.directions")}</h2>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        {loading && <Loader text={t("common.loading")} />}

        <div className={styles.cardsGrid}>
          {!loading && directions.map((d) => (
            <div key={d.id} className={styles.card}>
              <div className={styles.cardTitle}>
                <Map size={18} style={{ display: "inline-block", verticalAlign: "text-bottom", marginRight: 8 }} />
                {d.name}
              </div>
              <div className={styles.cardCode}>
                <Hash size={14} style={{ display: "inline-block", verticalAlign: "text-bottom", marginRight: 4 }} />
                {d.code}
              </div>

              <button
                className="secondary"
                style={{ marginTop: 16, width: "100%", fontSize: 13 }}
                onClick={() => setModalDirection(d)}
              >
                Учебный план
              </button>
            </div>
          ))}

          {directions.length === 0 && !loading && (
            <div className={styles.empty}>
              {t("admin.directions.empty")}
            </div>
          )}
        </div>

        <div className={styles.infoBox}>
          <h3>{t("admin.directions.aboutTitle")}</h3>
          <p>{t("admin.directions.aboutText")}</p>
        </div>
      </div>

      {modalDirection && token && (
        <CurriculumModal
          direction={modalDirection}
          token={token}
          onClose={() => setModalDirection(null)}
        />
      )}
    </AppShell>
  );
}
