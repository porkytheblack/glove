import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"
import { AuthProvider } from "./components/auth-provider"
import { BreadcrumbProvider } from "./components/breadcrumb-provider"
import { ErrorBoundary } from "./components/error-boundary"
import { LoginPage } from "./components/login-page"
import { MonitorProvider } from "./hooks/use-monitor"
import { Shell } from "./components/shell"

export const metadata: Metadata = {
  title: "Glove Monitor",
  description: "Observability for Glove agents — conversations, tool calls, tokens, cost, latency.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ErrorBoundary>
          <AuthProvider loginPage={<LoginPage />}>
            <BreadcrumbProvider>
              <MonitorProvider>
                <Shell>{children}</Shell>
              </MonitorProvider>
            </BreadcrumbProvider>
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
