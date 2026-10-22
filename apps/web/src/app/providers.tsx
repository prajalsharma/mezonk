"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, lightTheme, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { ToastProvider } from "@/components/ui/Toast";
import { shouldRetry } from "@/lib/api/types";

function brandTheme(mode: "light" | "dark"): Theme {
  const t = mode === "dark" ? darkTheme() : lightTheme();
  const ink = mode === "dark" ? "#F4F5F8" : "#0D0F15";
  const bg = mode === "dark" ? "#101318" : "#FFFFFF";
  const blue = mode === "dark" ? "#528DFE" : "#0A54DD";
  return {
    ...t,
    colors: {
      ...t.colors,
      accentColor: blue,
      accentColorForeground: mode === "dark" ? "#080A0E" : "#FFFFFF",
      modalBackground: bg,
      modalBorder: mode === "dark" ? "#2A2E36" : "#DEE1E7",
      connectButtonBackground: bg,
      modalText: ink,
    },
    fonts: { body: "var(--font-geist), system-ui, sans-serif" },
    radii: { ...t.radii, actionButton: "8px", connectButton: "8px", menuButton: "8px", modal: "14px", modalMobile: "14px" },
  };
}

function WalletTheme({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  // The server can't know the visitor's theme; render the light theme until mounted to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <RainbowKitProvider theme={brandTheme(mounted && resolvedTheme === "dark" ? "dark" : "light")} modalSize="compact">
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 4_000, refetchOnWindowFocus: true, retry: shouldRetry } },
      }),
  );
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
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
