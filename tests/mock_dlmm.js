const anchor = require("@coral-xyz/anchor");

class MockDLMM {
  constructor(programId, provider) {
    this.programId = programId;
    this.provider = provider;
    this.positions = new Map();
    this.pools = new Map();
    this.feeRate = 100; // Default fee rate (basis points)
  }

    async initialize() {
        this.program = new anchor.Program({
            name: "mock_dlmm",
            version: "0.1.0",
            accounts: [
                {
                    name: "Position",
                    type: {
                        kind: "struct",
                        fields: [
                            { name: "bins", type: { array: ["i32", 2] } },
                            { name: "amount", type: "u64" },
                            { name: "fees", type: "u64" },
                            { name: "lbPair", type: "publicKey" },
                            { name: "tokenX", type: "publicKey" },
                            { name: "tokenY", type: "publicKey" },
                            { name: "liquidity", type: "u64" },
                            { name: "lastUpdated", type: "i64" },
                            { name: "binArrayLower", type: "publicKey" },
                            { name: "binArrayUpper", type: "publicKey" },
                            { name: "tokenProgram", type: "publicKey" },
                            { name: "bump", type: "u8" },
                            { name: "_padding", type: { array: ["u8", 32] } },
                            { name: "reserved", type: { array: ["u8", 64] } } // Additional padding
                        ]
                    }
                },
        {
          name: "Pool",
          type: {
            kind: "struct",
            fields: [
              { name: "reserves", type: { array: ["u64", 2] } }
            ]
          }
        }
      ],
      instructions: [
        {
          name: "harvestFee",
          accounts: [
            { name: "pool", isMut: true },
            { name: "position", isMut: true },
            { name: "feeTokenAccount", isMut: true },
            { name: "tokenProgram", isMut: false }
          ],
          args: []
        },
        {
          name: "addLiquidity",
          accounts: [
            { name: "pool", isMut: true },
            { name: "position", isMut: true },
            { name: "userTokenA", isMut: true },
            { name: "userTokenB", isMut: true },
            { name: "tokenProgram", isMut: false }
          ],
          args: [
            { name: "amount", type: "u64" },
            { name: "bins", type: { array: ["i32", 2] } }
          ]
        },
        {
          name: "removeLiquidity",
          accounts: [
            { name: "pool", isMut: true },
            { name: "position", isMut: true },
            { name: "userTokenA", isMut: true },
            { name: "userTokenB", isMut: true },
            { name: "tokenProgram", isMut: false }
          ],
          args: [
            { name: "bins", type: { array: ["i32", 2] } }
          ]
        }
      ],
      accounts: [],
      types: [],
      metadata: {}
    }, this.programId, this.provider);
  }

  setFeeRate(basisPoints) {
    this.feeRate = basisPoints;
  }

  async harvestFee(accounts) {
    const positionKey = accounts.position.toBase58();
    const currentFees = this.positions.get(positionKey)?.fees || 0;
    const feeAmount = this.feeRate;
    this.positions.set(positionKey, { 
      ...(this.positions.get(positionKey) || {}),
      fees: currentFees + feeAmount
    });
    return { feeAmount };
  }

    async addLiquidity(accounts, args) {
        const positionKey = accounts.position.toBase58();
        const position = {
            bins: args.bins,
            amount: args.amount,
            fees: 0,
            lbPair: accounts.pool.toBase58(),
            tokenX: accounts.userTokenA.toBase58(),
            tokenY: accounts.userTokenB.toBase58(),
            liquidity: args.amount,
            lastUpdated: Date.now() / 1000,
            // Add all required fields from program
            binArrayLower: accounts.binArrayLower?.toBase58() || "",
            binArrayUpper: accounts.binArrayUpper?.toBase58() || "",
            tokenProgram: accounts.tokenProgram.toBase58(),
            bump: 0 // Default bump value
        };
        this.positions.set(positionKey, position);
        return { 
            liquidityAmount: args.amount,
            position: positionKey
        };
    }

  async removeLiquidity(accounts, args) {
    const positionKey = accounts.position.toBase58();
    const position = this.positions.get(positionKey);
    if (!position) throw new Error("Position not found");
    
    // Verify bins match
    if (!position.bins.every((bin, i) => bin === args.bins[i])) {
      throw new Error("Bin mismatch");
    }

    // Calculate proportional amounts based on liquidity
    const removedAmount = args.amount || position.liquidity;
    position.liquidity -= removedAmount;
    position.amount = position.liquidity; // Keep amount in sync
    this.positions.set(positionKey, position);
    
    return { 
      tokenAAmount: removedAmount / 2,
      tokenBAmount: removedAmount / 2,
      binArrayLower: accounts.binArrayLower.toBase58(),
      binArrayUpper: accounts.binArrayUpper.toBase58(),
      lbPair: accounts.lbPair.toBase58(),
      tokenX: position.tokenX,
      tokenY: position.tokenY,
      liquidity: position.liquidity
    };
  }
}

module.exports = MockDLMM;
