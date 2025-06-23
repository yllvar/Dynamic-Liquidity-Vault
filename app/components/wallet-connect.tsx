"use client"

import { useWallet } from "@solana/wallet-adapter-react"
import { Button } from "./ui/button"

export function WalletConnect() {
  const { connect, disconnect, publicKey } = useWallet()
  const base58 = publicKey?.toBase58()
  const content = base58 ? `${base58.slice(0, 4)}...${base58.slice(-4)}` : "Connect Wallet"

  return (
    <Button
      variant="outline"
      onClick={() => (base58 ? disconnect() : connect())}
    >
      {content}
    </Button>
  )
}
