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
  const ink = mode === "dark" ? "#F2EFE9" : "#14110F";
  const bg = mode === "dark" ? "#1B1815" : "#FAF8F4";
  return {
    ...t,
    colors: {
      ...t.colors,
      accentColor: ink,
      accentColorForeground: mode === "dark" ? "#14110F" : "#F2EFE9",
      modalBackground: bg,
      modalBorder: mode === "dark" ? "#332E28" : "#D6D0C5",
      connectButtonBackground: bg,
      modalText: ink,
    },
    fonts: { body: "var(--font-hanken), system-ui, sans-serif" },
    radii: { ...t.radii, actionButton: "6px", connectButton: "6px", menuButton: "6px", modal: "10px", modalMobile: "10px" },
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
        defaultOptions: { queries: { staleTime: 4_000, refetchOnWindowFocus: true, retry: 2 } },
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
