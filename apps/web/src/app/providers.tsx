"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, lightTheme, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { ToastProvider } from "@/components/ui/Toast";

function brandTheme(mode: "light" | "dark"): Theme {
  const t = mode === "dark" ? darkTheme() : lightTheme();
  const ink = mode === "dark" ? "#E9EDF4" : "#0B0F19";
  const bg = mode === "dark" ? "#10141D" : "#FFFFFF";
  return {
    ...t,
    colors: {
      ...t.colors,
      accentColor: ink,
      accentColorForeground: mode === "dark" ? "#090C13" : "#FFFFFF",
      modalBackground: bg,
      modalBorder: mode === "dark" ? "#1F2532" : "#DDE2EA",
      connectButtonBackground: bg,
      modalText: ink,
    },
    fonts: { body: "var(--font-geist), system-ui, sans-serif" },
    radii: { ...t.radii, actionButton: "12px", connectButton: "12px", menuButton: "12px", modal: "20px", modalMobile: "20px" },
  };
}

function WalletTheme({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  // The server can't know the visitor's theme; render the dark theme until mounted to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <RainbowKitProvider theme={brandTheme(!mounted || resolvedTheme !== "light" ? "dark" : "light")} modalSize="compact">
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 4_000, refetchOnWindowFocus: true, retry: 2 } },
      }),
  );
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={client}>
          <WalletTheme>
            <ToastProvider>{children}</ToastProvider>
          </WalletTheme>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
