import React from "react";

/** Shared style dictionary used by all payroll components. */
export const styles: { [key: string]: React.CSSProperties } = {
  container: {
    background: "hsl(0, 0%, 4%)",
    color: "hsl(220, 20%, 90%)",
    minHeight: "100vh",
    fontFamily: "'Inter', sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "40px 20px",
  },
  header: {
    width: "100%",
    maxWidth: "1100px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "30px",
    borderBottom: "1px solid hsl(220, 10%, 18%)",
    paddingBottom: "20px",
  },
  logo: {
    fontSize: "24px",
    fontWeight: "700",
    fontFamily: "'Cinzel', serif",
    letterSpacing: "0.1em",
    background:
      "linear-gradient(135deg, hsl(220, 20%, 80%), hsl(350, 65%, 50%), hsl(350, 70%, 40%))",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  main: { width: "100%", maxWidth: "1100px" },
  card: {
    background: "hsl(0, 0%, 7%)",
    border: "1px solid hsl(220, 10%, 18%)",
    borderRadius: "0",
    padding: "24px",
    marginBottom: "20px",
    position: "relative" as const,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "16px",
    marginBottom: "24px",
  },
  statCard: {
    background: "hsl(0, 0%, 5%)",
    border: "1px solid hsl(220, 10%, 18%)",
    padding: "20px",
    position: "relative" as const,
  },
  uploadZone: {
    border: "2px dashed hsl(350, 65%, 45%)",
    borderRadius: "0",
    padding: "40px",
    textAlign: "center" as const,
    cursor: "pointer",
    background: "rgba(139, 92, 99, 0.05)",
    transition: "all 0.3s ease",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    marginTop: "16px",
  },
  th: {
    textAlign: "left" as const,
    padding: "12px",
    color: "hsl(220, 10%, 50%)",
    fontSize: "10px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.15em",
    borderBottom: "1px solid hsl(220, 10%, 18%)",
  },
  td: {
    padding: "14px 12px",
    borderBottom: "1px solid hsl(220, 10%, 18%)",
    fontSize: "14px",
  },
  primaryBtn: {
    padding: "14px 28px",
    background:
      "linear-gradient(135deg, hsl(350, 65%, 50%), hsl(350, 70%, 38%))",
    color: "hsl(220, 20%, 95%)",
    border: "none",
    borderRadius: "0",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    letterSpacing: "0.15em",
    textTransform: "uppercase" as const,
    boxShadow: "0 0 40px hsl(350, 65%, 45%, 0.2)",
    transition: "all 0.3s ease",
  },
  secondaryBtn: {
    padding: "8px 16px",
    background: "transparent",
    color: "hsl(220, 20%, 90%)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "hsl(350, 65%, 45%, 0.5)",
    borderRadius: "0",
    cursor: "pointer",
    fontSize: "11px",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    transition: "all 0.3s ease",
  },
  backBtn: {
    padding: "8px 16px",
    background: "transparent",
    color: "hsl(220, 10%, 50%)",
    border: "1px solid hsl(220, 10%, 18%)",
    borderRadius: "0",
    textDecoration: "none",
    fontSize: "12px",
    letterSpacing: "0.1em",
    transition: "all 0.3s ease",
  },
  checkbox: {
    width: "16px",
    height: "16px",
    accentColor: "hsl(350, 65%, 50%)",
    cursor: "pointer",
  },
  walletWidget: {
    background: "hsl(0, 0%, 5%)",
    border: "1px solid hsl(220, 10%, 18%)",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginLeft: "auto",
  },
  balanceIndicator: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-end",
  },
  previewSection: {
    background: "hsl(0, 0%, 5%)",
    border: "1px solid hsl(350, 65%, 45%, 0.3)",
    padding: "20px",
    marginTop: "20px",
  },
};

/** Returns inline badge styles coloured by status. */
export const getBadgeStyle = (status: string): React.CSSProperties => {
  let bgColor = "rgba(255,255,255,0.05)";
  let textColor = "hsl(220, 10%, 50%)";
  if (status === "Paid" || status === "Success") {
    bgColor = "hsl(140, 60%, 40%, 0.15)";
    textColor = "hsl(140, 60%, 50%)";
  } else if (status === "Processing...") {
    bgColor = "hsl(45, 100%, 50%, 0.15)";
    textColor = "hsl(45, 100%, 60%)";
  } else if (status === "Failed") {
    bgColor = "hsl(0, 60%, 40%, 0.15)";
    textColor = "hsl(0, 60%, 50%)";
  } else if (status === "Selected") {
    bgColor = "hsl(350, 65%, 45%, 0.15)";
    textColor = "hsl(350, 65%, 55%)";
  }
  return {
    padding: "4px 12px",
    borderRadius: "0",
    fontSize: "10px",
    background: bgColor,
    color: textColor,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  };
};

/** Corner accent decorations used on cards. */
export const CornerAccents = () => (
  <>
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 12,
        height: 12,
        borderTop: "2px solid hsl(350, 65%, 45%)",
        borderLeft: "2px solid hsl(350, 65%, 45%)",
      }}
    />
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 12,
        height: 12,
        borderTop: "2px solid hsl(350, 65%, 45%)",
        borderRight: "2px solid hsl(350, 65%, 45%)",
      }}
    />
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: 12,
        height: 12,
        borderBottom: "2px solid hsl(350, 65%, 45%)",
        borderLeft: "2px solid hsl(350, 65%, 45%)",
      }}
    />
    <div
      style={{
        position: "absolute",
        bottom: 0,
        right: 0,
        width: 12,
        height: 12,
        borderBottom: "2px solid hsl(350, 65%, 45%)",
        borderRight: "2px solid hsl(350, 65%, 45%)",
      }}
    />
  </>
);
