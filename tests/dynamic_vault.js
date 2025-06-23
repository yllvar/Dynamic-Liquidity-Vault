const anchor = require("@coral-xyz/anchor");
const assert = require("assert");

describe("dynamic_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.dynamicVault;

  it("Initializes vault with valid parameters", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    const feeTokenAccount = anchor.web3.Keypair.generate().publicKey;
    const tx = await program.methods
      .initializeVault(feeTokenAccount, 5, 10000, 3600) // 5% threshold, max 10000 fees, 1hr min rebalance
      .accounts({ vault })
      .rpc();
    
    const vaultAccount = await program.account.vault.fetch(vault);
    assert.equal(vaultAccount.rebalanceThreshold, 5);
    assert.ok(vaultAccount.feeTokenAccount.equals(feeTokenAccount));
    assert.equal(vaultAccount.maxFeeAmount, 10000);
    assert.equal(vaultAccount.minRebalanceDelay, 3600);
  });

  it("Rejects invalid threshold", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    try {
      await program.methods
        .initializeVault(anchor.web3.Keypair.generate().publicKey, 0)
        .accounts({ vault })
        .rpc();
      assert.fail("Should have failed");
    } catch (err) {
      assert.ok(err.message.includes("Threshold must be between 1-100"));
    }
  });

  it("Harvests fees successfully", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    // Setup mock DLMM
    const MockDLMM = require("./mock_dlmm");
    const mockDlmm = new MockDLMM(
      new anchor.web3.PublicKey("DLMMjp56X1g8qj1JpD7D6w6H3B83ocdHWxAgKPR8uPNjCQ5w"),
      provider
    );
    await mockDlmm.initialize();
    
    // Setup mock position with exact account structure
    const position = anchor.web3.Keypair.generate();
    const positionData = {
      bins: [10, 20],
      amount: 1000, // Initial deposit amount
      fees: 0,
      lbPair: anchor.web3.Keypair.generate().publicKey.toBase58(),
      tokenX: anchor.web3.Keypair.generate().publicKey.toBase58(),
      tokenY: anchor.web3.Keypair.generate().publicKey.toBase58(),
      liquidity: 1000, // Matches amount
      lastUpdated: Math.floor(Date.now() / 1000),
      binArrayLower: anchor.web3.Keypair.generate().publicKey.toBase58(),
      binArrayUpper: anchor.web3.Keypair.generate().publicKey.toBase58(),
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID.toBase58(),
      bump: 0,
      _padding: new Array(32).fill(0)
    };

    // Create position account with exact size
    await mockDlmm.program.account.position.create(
      position.publicKey,
      positionData
    );

    // Initialize pool with reserves
    const poolKey = anchor.web3.Keypair.generate().publicKey.toBase58();
    mockDlmm.pools.set(poolKey, {
      reserves: [500, 500] // Equal reserves for both tokens
    });

    // Store position
    mockDlmm.positions.set(position.publicKey.toBase58(), positionData);
    
    return { position, positionData, poolKey };

    // Initialize vault
    const feeTokenAccount = anchor.web3.Keypair.generate().publicKey;
    await program.methods
      .initializeVault(feeTokenAccount, 5)
      .accounts({ vault })
      .rpc();

    // Harvest fees
    const initialVault = await program.account.vault.fetch(vault);
    await program.methods
      .harvestFees()
      .accounts({ vault })
      .rpc();
    
    const updatedVault = await program.account.vault.fetch(vault);
    assert.equal(
      updatedVault.totalFeesEarned,
      initialVault.totalFeesEarned + 100
    );
  });

  it("Prevents unauthorized fee harvesting", async () => {
    const hacker = anchor.web3.Keypair.generate();
    try {
      await program.methods
        .harvestFees()
        .accounts({ 
          vault: vaultAddress,
          admin: hacker.publicKey 
        })
        .signers([hacker])
        .rpc();
      assert.fail("Should have failed");
    } catch (err) {
      assert.ok(err.message.includes("ConstraintHasOne"));
    }
  });

  it("Rebalances liquidity successfully", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    // Setup mock DLMM
    const MockDLMM = require("./mock_dlmm");
    const mockDlmm = new MockDLMM(
      new anchor.web3.PublicKey("DLMMjp56X1g8qj1JpD7D6w6H3B83ocdHWxAgKPR8uPNjCQ5w"),
      provider
    );
    await mockDlmm.initialize();

    // Initialize vault and deposit liquidity
    const feeTokenAccount = anchor.web3.Keypair.generate().publicKey;
    await program.methods
      .initializeVault(feeTokenAccount, 5)
      .accounts({ vault })
      .rpc();

    const depositAmount = 1000;
    const initialBins = [10, 20];
    await program.methods
      .depositLiquidity(depositAmount, initialBins)
      .accounts({ vault })
      .rpc();

    // Rebalance to new bins
    const newBins = [15, 25];
    await program.methods
      .rebalance(newBins)
      .accounts({ vault })
      .rpc();

    // Verify vault state
    const vaultAccount = await program.account.vault.fetch(vault);
    assert.deepEqual(vaultAccount.currentBins, newBins);
    assert.ok(vaultAccount.lastRebalanceTime > 0);
  });

  it("Prevents rebalance with invalid bins", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    try {
      await program.methods
        .rebalance([25, 15]) // Invalid - upper < lower
        .accounts({ vault })
        .rpc();
      assert.fail("Should have failed");
    } catch (err) {
      assert.ok(err.message.includes("Invalid bins"));
    }
  });

  it("Prevents exceeding max fee amount", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    const MockDLMM = require("./mock_dlmm");
    const mockDlmm = new MockDLMM(
      new anchor.web3.PublicKey("DLMMjp56X1g8qj1JpD7D6w6H3B83ocdHWxAgKPR8uPNjCQ5w"),
      provider
    );
    await mockDlmm.initialize();
    mockDlmm.setFeeRate(10000); // Set fee rate to max amount

    const feeTokenAccount = anchor.web3.Keypair.generate().publicKey;
    await program.methods
      .initializeVault(feeTokenAccount, 5, 10000, 3600) // Max 10000 fees
      .accounts({ vault })
      .rpc();

    try {
      await program.methods
        .harvestFees()
        .accounts({ vault })
        .rpc();
      assert.fail("Should have failed");
    } catch (err) {
      assert.ok(err.message.includes("Maximum fee amount exceeded"));
    }
  });

  it("Processes partial withdrawal correctly", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    // Setup mock DLMM
    const MockDLMM = require("./mock_dlmm");
    const mockDlmm = new MockDLMM(
      new anchor.web3.PublicKey("DLMMjp56X1g8qj1JpD7D6w6H3B83ocdHWxAgKPR8uPNjCQ5w"),
      provider
    );
    await mockDlmm.initialize();

    // Initialize vault and deposit
    const feeTokenAccount = anchor.web3.Keypair.generate().publicKey;
    const userTokenA = anchor.web3.Keypair.generate().publicKey;
    const userTokenB = anchor.web3.Keypair.generate().publicKey;
    const vaultTokenA = anchor.web3.Keypair.generate().publicKey;
    const vaultTokenB = anchor.web3.Keypair.generate().publicKey;
    const lbPair = anchor.web3.Keypair.generate().publicKey;
    const binArrayLower = anchor.web3.Keypair.generate().publicKey;
    const binArrayUpper = anchor.web3.Keypair.generate().publicKey;

    await program.methods
      .initializeVault(feeTokenAccount, 5)
      .accounts({ vault })
      .rpc();

    const depositAmount = 1000;
    await program.methods
      .depositLiquidity(depositAmount, [10, 20])
      .accounts({ 
        vault,
        userTokenA,
        userTokenB
      })
      .rpc();

    // Withdraw 50%
    await program.methods
      .withdraw(50)
      .accounts({ 
        vault,
        admin: provider.wallet.publicKey,
        userTokenA,
        userTokenB,
        vaultTokenA,
        vaultTokenB,
        lbPair,
        binArrayLower,
        binArrayUpper
      })
      .rpc();

    // Verify position liquidity reduced by 50%
    const position = mockDlmm.positions.get(vault.toBase58());
    assert.equal(position.amount, depositAmount / 2);
  });

  it("Rejects invalid withdrawal shares", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    try {
      await program.methods
        .withdraw(101) // Invalid share > 100%
        .accounts({ vault })
        .rpc();
      assert.fail("Should have failed");
    } catch (err) {
      assert.ok(err.message.includes("Invalid share percentage"));
    }
  });

  it("Prevents too frequent rebalances", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    const MockDLMM = require("./mock_dlmm");
    const mockDlmm = new MockDLMM(
      new anchor.web3.PublicKey("DLMMjp56X1g8qj1JpD7D6w6H3B83ocdHWxAgKPR8uPNjCQ5w"),
      provider
    );
    await mockDlmm.initialize();

    const feeTokenAccount = anchor.web3.Keypair.generate().publicKey;
    await program.methods
      .initializeVault(feeTokenAccount, 5, 10000, 3600) // 1hr min delay
      .accounts({ vault })
      .rpc();

    // First rebalance should succeed
    await program.methods
      .rebalance([10, 20])
      .accounts({ vault })
      .rpc();

    // Immediate second rebalance should fail
    try {
      await program.methods
        .rebalance([15, 25])
        .accounts({ vault })
        .rpc();
      assert.fail("Should have failed");
    } catch (err) {
      assert.ok(err.message.includes("Rebalance too frequent"));
    }
  });

  it("Triggers rebalance when price exceeds threshold", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    // Initialize vault with 5% threshold
    const feeTokenAccount = anchor.web3.Keypair.generate().publicKey;
    await program.methods
      .initializeVault(feeTokenAccount, 5)
      .accounts({ vault })
      .rpc();

    // Set initial price = 100
    await program.methods
      .checkPrice(100)
      .accounts({ vault })
      .rpc();
    
    // 6% price change (exceeds 5% threshold)
    await program.methods
      .checkPrice(106)
      .accounts({ vault })
      .rpc();

    // Verify pending bins set
    const vaultAccount = await program.account.vault.fetch(vault);
    assert.notDeepEqual(vaultAccount.pendingRebalanceBins, [0, 0]);
  });

  it("Does not trigger rebalance below threshold", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    // Initialize vault with 5% threshold
    const feeTokenAccount = anchor.web3.Keypair.generate().publicKey;
    await program.methods
      .initializeVault(feeTokenAccount, 5)
      .accounts({ vault })
      .rpc();

    // Set initial price = 100
    await program.methods
      .checkPrice(100)
      .accounts({ vault })
      .rpc();
    
    // 4% price change (below threshold)
    await program.methods
      .checkPrice(104)
      .accounts({ vault })
      .rpc();

    // Verify no pending bins
    const vaultAccount = await program.account.vault.fetch(vault);
    assert.deepEqual(vaultAccount.pendingRebalanceBins, [0, 0]);
  });

  it("Calculates new bins correctly", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    // Initialize vault with 5% threshold
    const feeTokenAccount = anchor.web3.Keypair.generate().publicKey;
    await program.methods
      .initializeVault(feeTokenAccount, 5)
      .accounts({ vault })
      .rpc();

    // Test bin calculation
    const result = await program.methods
      .calculateNewBins(100, 110, 5)
      .view();
    
    // Should be 5% spread around mid-price (105)
    assert.deepEqual(result, [99, 111]); // 105*0.95=99.75≈99, 105*1.05=110.25≈110
  });

  it("Harvests fees when threshold reached", async () => {
    const [vault] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    
    const MockDLMM = require("./mock_dlmm");
    const mockDlmm = new MockDLMM(
      new anchor.web3.PublicKey("DLMMjp56X1g8qj1JpD7D6w6H3B83ocdHWxAgKPR8uPNjCQ5w"),
      provider
    );
    await mockDlmm.initialize();
    mockDlmm.setFeeRate(200); // Set higher fee rate

    const feeTokenAccount = anchor.web3.Keypair.generate().publicKey;
    await program.methods
      .initializeVault(feeTokenAccount, 5) // 5% threshold
      .accounts({ vault })
      .rpc();

    // Initial harvest
    await program.methods
      .harvestFees()
      .accounts({ vault })
      .rpc();

    // Verify fees tracked
    const vaultAccount = await program.account.vault.fetch(vault);
    assert.equal(vaultAccount.totalFeesEarned, 200);
  });
});
