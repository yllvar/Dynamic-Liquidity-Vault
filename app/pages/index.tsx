import React from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import { Program, AnchorProvider } from '@project-serum/anchor';
import type { DynamicVault } from '../../programs/dynamic_vault/target/types/dynamic_vault';
import idl from '../../programs/dynamic_vault/target/idl/dynamic_vault.json';

declare module '@project-serum/anchor' {
  interface Program {
    account: {
      vault: {
        fetch: (publicKey: PublicKey) => Promise<DynamicVault>;
      };
    };
    methods: {
      initializeVault: (
        feeTokenAccount: PublicKey,
        rebalanceThreshold: number,
        maxFeeAmount: number,
        minRebalanceDelay: number
      ) => any;
      harvestFees: () => any;
    };
  }
}

export default function VaultDashboard() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [program, setProgram] = useState(null);
  const [vaultData, setVaultData] = useState(null);
  const [rebalanceThreshold, setRebalanceThreshold] = useState(5);
  const [maxFeeAmount, setMaxFeeAmount] = useState(10000);
  const [minRebalanceDelay, setMinRebalanceDelay] = useState(3600);

  useEffect(() => {
    if (!publicKey || !connection) return;

    const setup = async () => {
      const provider = new AnchorProvider(connection, { publicKey }, {});
      const programId = new PublicKey(idl.metadata.address);
      const program = new Program(idl, programId, provider);
      setProgram(program);

      try {
        const [vault] = await PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), publicKey.toBuffer()],
          programId
        );
        
        const vaultAccount = await program.account.vault.fetch(vault);
        setVaultData({
          ...vaultAccount,
          publicKey: vault
        });
      } catch (error) {
        console.log('Vault not initialized yet');
      }
    };

    setup();
  }, [publicKey, connection]);

  const initializeVault = async () => {
    if (!program || !publicKey) return;

    try {
      const [vault] = await PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), publicKey.toBuffer()],
        program.programId
      );

      const feeTokenAccount = await createAssociatedTokenAccount();
      
      const tx = await program.methods
        .initializeVault(
          feeTokenAccount,
          rebalanceThreshold,
          maxFeeAmount,
          minRebalanceDelay
        )
        .accounts({ vault })
        .rpc();
      
      console.log("Vault initialized:", tx);
      refreshVaultState();
    } catch (error) {
      console.error("Error initializing vault:", error);
    }
  };

  const harvestFees = async () => {
    if (!program || !vaultData) return;
    
    try {
      const tx = await program.methods
        .harvestFees()
        .accounts({ vault: vaultData.publicKey })
        .rpc();
      console.log("Fees harvested:", tx);
      refreshVaultState();
    } catch (error) {
      console.error("Error harvesting fees:", error);
    }
  };

  const refreshVaultState = async () => {
    if (!program || !vaultData) return;
    const account = await program.account.vault.fetch(vaultData.publicKey);
    setVaultData({
      ...account,
      publicKey: vaultData.publicKey
    });
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Dynamic Vault Dashboard</h1>
      
      {vaultData ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card bg-base-200 p-4">
              <h2 className="text-xl font-semibold">Current Bins</h2>
              <p>{vaultData.currentBins.join(' - ')}</p>
            </div>
            <div className="card bg-base-200 p-4">
              <h2 className="text-xl font-semibold">Total Fees Earned</h2>
              <p>{vaultData.totalFeesEarned}</p>
            </div>
            <div className="card bg-base-200 p-4">
              <h2 className="text-xl font-semibold">Last Rebalance</h2>
              <p>{new Date(vaultData.lastRebalanceTime * 1000).toLocaleString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card bg-base-200 p-4">
              <h2 className="text-xl font-semibold">Max Fee Amount</h2>
              <p>{vaultData.maxFeeAmount}</p>
            </div>
            <div className="card bg-base-200 p-4">
              <h2 className="text-xl font-semibold">Min Rebalance Delay</h2>
              <p>{vaultData.minRebalanceDelay} seconds</p>
            </div>
            <div className="card bg-base-200 p-4">
              <h2 className="text-xl font-semibold">Last Fee Harvest</h2>
              <p>{new Date(vaultData.lastFeeHarvestTime * 1000).toLocaleString()}</p>
            </div>
          </div>

          <div className="flex space-x-2">
            <button 
              onClick={harvestFees}
              className="btn btn-primary"
            >
              Harvest Fees
            </button>
          </div>
        </div>
      ) : (
        <div className="card bg-base-200 p-6 max-w-lg mx-auto">
          <h2 className="text-xl font-semibold mb-4">Initialize Vault</h2>
          <div className="space-y-4">
            <div>
              <label className="label">
                <span className="label-text">Rebalance Threshold (%)</span>
              </label>
              <input
                type="number"
                value={rebalanceThreshold}
                onChange={(e) => setRebalanceThreshold(Number(e.target.value))}
                className="input input-bordered w-full"
              />
            </div>
            <div>
              <label className="label">
                <span className="label-text">Max Fee Amount</span>
              </label>
              <input
                type="number"
                value={maxFeeAmount}
                onChange={(e) => setMaxFeeAmount(Number(e.target.value))}
                className="input input-bordered w-full"
              />
            </div>
            <div>
              <label className="label">
                <span className="label-text">Min Rebalance Delay (seconds)</span>
              </label>
              <input
                type="number"
                value={minRebalanceDelay}
                onChange={(e) => setMinRebalanceDelay(Number(e.target.value))}
                className="input input-bordered w-full"
              />
            </div>
            <button
              onClick={initializeVault}
              className="btn btn-primary w-full"
            >
              Initialize Vault
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

async function createAssociatedTokenAccount() {
  // Implementation for creating token account
  return new PublicKey('...');
}
