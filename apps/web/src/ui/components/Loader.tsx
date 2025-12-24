import React from "react";
import styles from "./Loader.module.css";

type LoaderProps = {
  text?: string;
  fullScreen?: boolean;
  size?: "sm" | "md" | "lg";
};

export function Loader({ text = "Загрузка...", fullScreen = false, size = "md" }: LoaderProps) {
  const content = (
    <div className={`${styles.loaderContainer} ${styles[`size_${size}`] ?? ""}`.trim()}>
      <div className={styles.logoWrapper}>
        <img 
          src="/assets/rob-logo.png" 
          alt="Loading" 
          className={styles.logo}
        />
      </div>
      {text && <p className={styles.text}>{text}</p>}
    </div>
  );

  if (fullScreen) {
    return <div className={styles.fullScreen}>{content}</div>;
  }

  return content;
}
