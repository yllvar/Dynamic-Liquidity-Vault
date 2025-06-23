"use client"

import React from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletConnect } from '../components/wallet-connect';

export default function VaultDashboard() {
  const { publicKey } = useWallet();

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Dynamic Vault Dashboard</h1>
      
      <div className="card bg-base-200 p-6 max-w-lg mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Wallet Status</h2>
          <WalletConnect />
        </div>
        
        {publicKey ? (
          <div className="space-y-2">
            <p>Connected: {publicKey.toBase58()}</p>
            <p className="text-warning">Note: Program deployment is currently unavailable</p>
          </div>
        ) : (
          <p>Please connect your wallet</p>
        )}
      </div>
    </div>
  );
}
