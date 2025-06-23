"use client"

import * as React from "react"
import { 
  ConnectionProvider, 
  WalletProvider 
} from "@solana/wallet-adapter-react"
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui"
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter
} from "@solana/wallet-adapter-wallets"

require("@solana/wallet-adapter-react-ui/styles.css")

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const endpoint = "https://api.mainnet-beta.solana.com"
  const wallets = [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter()
  ]

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
