import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { WalletProviders } from "./providers/wallet-provider"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Dynamic Vault",
  description: "Solana dynamic vault application",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WalletProviders>
          {children}
        </WalletProviders>
      </body>
    </html>
  )
}
