# AuxloMuscleCF

An isolated, high-performance transaction execution boundary and secure signing worker for the **AuxloNeo** autonomous agent framework. Designed specifically for Cloudflare Workers, **AuxloMuscleCF** uses the `viem` library to interact with both Mantle Mainnet and Mantle Sepolia network topologies, exposing secure, authenticated RPC proxies and wallet orchestration services.

---

## Architecture Overview

AuxloMuscleCF plays a critical cryptographic role within the Auxlo ecosystem. While **AuxloNeo** manages high-level logic, telegram chat channels, memory structures, and scheduling, **AuxloMuscleCF** serves as the transaction execution module (HSM) and blockchain driver.

This separation of concerns enforces the **Single Responsibility Principle** and guarantees that:
1. **Private Key Isolation:** Keys are never loaded or manipulated inside the user-facing chat runtime of AuxloNeo.
2. **Deterministic Transaction Assembly:** Core transaction building, gas execution estimates, and ABI simulation are packaged into a clean, reproducible service layer.
3. **Optimized Network Binding:** Direct Cloudflare Worker-to-node streaming is achieved using standard `fetch` routing via service bindings.

### System Topology & Interaction Flow

```
       Telegram / API UI
              │
              ▼
   ┌──────────────────────┐
   │       AuxloNeo       │  <--- (Core logic, Agent, DB, KV-Memory)
   └──────────────────────┘
              │ (Service Binding / Service-to-Service call)
              ▼
   ┌──────────────────────┐
   │    AuxloMuscleCF     │  <--- (Private Keys, Viem Client, Gas Estimator)
   └──────────────────────┘
              │ (JSON-RPC)
              ▼
   ┌──────────────────────┐
   │    Mantle Network    │  <--- (MNT Ledger, Agni/Moe Smart Contracts)
   └──────────────────────┘
```

---

## Integration Endpoints

All actions require an API Key header authentication `x-api-key` or an `Authorization: Bearer <key>` header mirroring the configured `MUSCLE_API_KEY` variable.

### 1. `POST /send`
Performs direct transfer of MNT native tokens on either Mainnet or Sepolia testnet.
- **Request Body:**
  ```json
  {
    "to": "0xDestinationAddress...",
    "amount": "1.0",
    "network": "testnet",
    "privateKey": "0xOptionalOverrideKey..."
  }
  ```

### 2. `POST /send-raw`
The core worker function used by **AuxloNeo** to broadcast pre-compiled or custom payload transactions (such as strategy executions, swaps, and trade logs).
- **Request Body:**
  ```json
  {
    "to": "0xContractOrRecipientAddress...",
    "value": "0",
    "data": "0xEncodedContractPayload...",
    "network": "testnet",
    "privateKey": "0x..."
  }
  ```

### 3. `POST /approve`
Interacts directly with ERC-20 standard interfaces to grant spending limits.
- **Request Body:**
  ```json
  {
    "token": "0xTokenAddress...",
    "spender": "0xSpenderAddress...",
    "amount": "1000000000000000000",
    "network": "testnet",
    "privateKey": "0x..."
  }
  ```

### 4. `POST /call`
Performs dry-run / off-chain simulation on target contract view functions without broad-scale state alteration.
- **Request Body:**
  ```json
  {
    "to": "0xContractAddress...",
    "data": "0xEncodedSelector...",
    "network": "testnet"
  }
  ```

### 5. `POST /balance`
Queries native address assets on-chain.
- **Request Body:**
  ```json
  {
    "address": "0xWalletAddress...",
    "network": "testnet"
  }
  ```

---

## Security Architecture

1. **Service Bindings:** In production, AuxloNeo binds AuxloMuscleCF directly using standard Cloudflare configuration. External requests never reach the `/send-raw` or `/derive-address` routes directly; instead, they are routed through the internal `env.MUSCLE` fetcher interface.
2. **Access Control:** Every route verifies the presence and correctness of the `MUSCLE_API_KEY`.
3. **Stateless Operations:** To avoid key exposure on persistent drives, private keys are decrypted using memory buffers and passed securely on demand, mitigating cold-boot reading attacks on worker infrastructure.

---

## Deployment & Configuration

AuxloMuscleCF compiles with `wrangler` and is fully typechecked. 

1. Setup environment variables in `wrangler.toml`:
   ```toml
   [vars]
   MUSCLE_API_KEY = "your-secret-api-key"
   MANTLE_RPC_MAINNET = "https://rpc.mantle.xyz"
   MANTLE_RPC_TESTNET = "https://rpc.sepolia.mantle.xyz"
   ```

2. Deploy:
   ```bash
   npm run deploy
   ```
