import React from "react";
import { useI18n } from "../i18n/I18nProvider";
import styles from "./Loader.module.css";

type LoaderProps = {
  text?: string;
  fullScreen?: boolean;
  size?: "sm" | "md" | "lg" | number;
};

export function Loader({ text, fullScreen = false, size = "md" }: LoaderProps) {
  const { t } = useI18n();
  const resolvedText = text ?? t("common.loading");
  const content = (
    <div className={`${styles.loaderContainer} ${styles[`size_${size}`] ?? ""}`.trim()}>
      <div className={styles.logoWrapper}>
        <img 
          src="/assets/rob-logo.png" 
          alt={t("common.loading")} 
          className={styles.logo}
        />
      </div>
      {resolvedText && <p className={styles.text}>{resolvedText}</p>}
    </div>
  );

  if (fullScreen) {
    return <div className={styles.fullScreen}>{content}</div>;
  }

  return content;
}
