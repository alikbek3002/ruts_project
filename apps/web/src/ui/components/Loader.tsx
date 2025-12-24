import React from "react";
import styles from "./Loader.module.css";

type LoaderProps = {
  text?: string;
  fullScreen?: boolean;
};

export function Loader({ text = "Загрузка...", fullScreen = false }: LoaderProps) {
  const content = (
    <div className={styles.loaderContainer}>
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
