import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { mantle } from 'viem/chains';

// Mantle Sepolia testnet has chainId 5003, not the default 5001 in viem
const mantleSepolia = {
  ...mantle,
  id: 5003,
  name: 'Mantle Sepolia',
  network: 'mantle-sepolia',
  nativeCurrency: { name: 'MNT', symbol: 'MNT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.sepolia.mantle.xyz'] },
    public: { http: ['https://rpc.sepolia.mantle.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Mantle Sepolia Explorer', url: 'https://sepolia.mantlescan.xyz' },
  },
  testnetsCORSBypass: true,
} as const

interface Env {
  MUSCLE_API_KEY: string;
  MANTLE_PRIVATE_KEY?: string;
  MANTLE_RPC_MAINNET: string;
  MANTLE_RPC_TESTNET: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/', (c) => {
  return c.json({
    name: 'auxlo-muscle',
    version: '1.0.0',
    runtime: 'cloudflare-workers',
    endpoints: {
      'POST /send': 'Send MNT tokens',
      'POST /send-raw': 'Send raw transaction',
      'POST /approve': 'Approve ERC20 spending limit',
      'POST /call': 'Simulate/read contract data off-chain',
      'POST /balance': 'Get MNT balance for an address',
      'POST /ledger': 'Get chain info (block number, gas price)',
      'POST /wallet': 'Create a new wallet',
      'POST /derive-address': 'Derive address from private key',
    }
  });
});

app.post('/send', async (c) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  if (apiKey !== c.env.MUSCLE_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { to, amount, network = 'testnet', privateKey } = body;

  if (!to || !amount) {
    return c.json({ error: 'Missing required fields: to, amount' }, 400);
  }

  const key = privateKey || c.env.MANTLE_PRIVATE_KEY;
  if (!key) {
    return c.json({ error: 'No private key available. Set MANTLE_PRIVATE_KEY or provide privateKey in request.' }, 400);
  }

  try {
    const chain = network === 'mainnet' ? mantle : mantleSepolia;
    const rpcUrl = network === 'mainnet' ? c.env.MANTLE_RPC_MAINNET : c.env.MANTLE_RPC_TESTNET;

    const account = privateKeyToAccount(key as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const value = parseEther(amount);

    const hash = await walletClient.sendTransaction({
      to: to as `0x${string}`,
      value,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const explorerUrl = network === 'mainnet'
      ? `https://mantlescan.xyz/tx/${hash}`
      : `https://sepolia.mantlescan.xyz/tx/${hash}`;

    return c.json({
      success: true,
      txHash: hash,
      status: receipt.status === 'success' ? 'confirmed' : 'failed',
      blockNumber: Number(receipt.blockNumber),
      from: account.address,
      to,
      amount,
      network,
      explorer: explorerUrl,
    });
  } catch (error: any) {
    console.error('Send error:', error);
    return c.json({
      error: error.message || 'Transaction failed',
      details: error.metaMessages?.join('\n') || undefined,
    }, 500);
  }
});

app.post('/balance', async (c) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  if (apiKey !== c.env.MUSCLE_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { address, network = 'testnet' } = body;

  if (!address) {
    return c.json({ error: 'Missing required field: address' }, 400);
  }

  try {
    const chain = network === 'mainnet' ? mantle : mantleSepolia;
    const rpcUrl = network === 'mainnet' ? c.env.MANTLE_RPC_MAINNET : c.env.MANTLE_RPC_TESTNET;

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const balance = await publicClient.getBalance({ address: address as `0x${string}` });
    const balanceMnt = formatEther(balance);

    const explorerUrl = network === 'mainnet'
      ? `https://mantlescan.xyz/address/${address}`
      : `https://sepolia.mantlescan.xyz/address/${address}`;

    return c.json({
      address,
      balance: balanceMnt,
      balanceWei: balance.toString(),
      network,
      explorer: explorerUrl,
    });
  } catch (error: any) {
    console.error('Balance error:', error);
    return c.json({ error: error.message || 'Balance check failed' }, 500);
  }
});

app.post('/ledger', async (c) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  if (apiKey !== c.env.MUSCLE_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { network = 'testnet' } = body;

  try {
    const chain = network === 'mainnet' ? mantle : mantleSepolia;
    const rpcUrl = network === 'mainnet' ? c.env.MANTLE_RPC_MAINNET : c.env.MANTLE_RPC_TESTNET;

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const blockNumber = await publicClient.getBlockNumber();
    const gasPrice = await publicClient.getGasPrice();

    return c.json({
      network,
      chainId: chain.id,
      blockNumber: Number(blockNumber),
      gasPriceGwei: formatEther(gasPrice, 'gwei'),
      nativeCurrency: chain.nativeCurrency,
    });
  } catch (error: any) {
    console.error('Ledger error:', error);
    return c.json({ error: error.message || 'Ledger check failed' }, 500);
  }
});

app.post('/wallet', async (c) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  if (apiKey !== c.env.MUSCLE_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    return c.json({
      address: account.address,
      privateKey: privateKey,
      warning: 'Store this private key securely. It cannot be recovered.',
    });
  } catch (error: any) {
    return c.json({ error: error.message || 'Wallet creation failed' }, 500);
  }
});

app.post('/derive-address', async (c) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  if (apiKey !== c.env.MUSCLE_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { privateKey } = body;

  if (!privateKey || typeof privateKey !== 'string' || !privateKey.startsWith('0x')) {
    return c.json({ error: 'Missing or invalid privateKey. Must start with 0x.' }, 400);
  }

  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    return c.json({ address: account.address });
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to derive address' }, 500);
  }
});

app.post('/send-raw', async (c) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  if (apiKey !== c.env.MUSCLE_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { to, value = '0', data = '0x', network = 'testnet', privateKey } = body;

  if (!to) {
    return c.json({ error: 'Missing required field: to' }, 400);
  }

  const key = privateKey || c.env.MANTLE_PRIVATE_KEY;
  if (!key) {
    return c.json({ error: 'No private key available.' }, 400);
  }

  try {
    const chain = network === 'mainnet' ? mantle : mantleSepolia;
    const rpcUrl = network === 'mainnet' ? c.env.MANTLE_RPC_MAINNET : c.env.MANTLE_RPC_TESTNET;

    const account = privateKeyToAccount(key as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const hash = await walletClient.sendTransaction({
      to: to as `0x${string}`,
      value: BigInt(value),
      data: data as `0x${string}`,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const explorerUrl = network === 'mainnet'
      ? `https://mantlescan.xyz/tx/${hash}`
      : `https://sepolia.mantlescan.xyz/tx/${hash}`;

    return c.json({
      success: true,
      txHash: hash,
      status: receipt.status === 'success' ? 'confirmed' : 'failed',
      blockNumber: Number(receipt.blockNumber),
      explorer: explorerUrl,
    });
  } catch (error: any) {
    console.error('send-raw error:', error);
    return c.json({
      success: false,
      error: error.message || 'Transaction failed',
      details: error.metaMessages?.join('\n') || undefined,
    }, 500);
  }
});

app.post('/approve', async (c) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  if (apiKey !== c.env.MUSCLE_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { token, spender, amount, network = 'testnet', privateKey } = body;

  if (!token || !spender || !amount) {
    return c.json({ error: 'Missing token, spender, or amount' }, 400);
  }

  const key = privateKey || c.env.MANTLE_PRIVATE_KEY;
  if (!key) {
    return c.json({ error: 'No private key available.' }, 400);
  }

  try {
    const chain = network === 'mainnet' ? mantle : mantleSepolia;
    const rpcUrl = network === 'mainnet' ? c.env.MANTLE_RPC_MAINNET : c.env.MANTLE_RPC_TESTNET;

    const account = privateKeyToAccount(key as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const abi = [
      {
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' }
        ],
        name: 'approve',
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'nonpayable',
        type: 'function'
      }
    ];

    const { request } = await publicClient.simulateContract({
      account,
      address: token as `0x${string}`,
      abi,
      functionName: 'approve',
      args: [spender as `0x${string}`, BigInt(amount)],
    });

    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return c.json({
      success: true,
      txHash: hash,
      status: receipt.status === 'success' ? 'confirmed' : 'failed',
    });
  } catch (error: any) {
    console.error('approve error:', error);
    return c.json({
      success: false,
      error: error.message || 'Approve failed',
    }, 500);
  }
});

app.post('/call', async (c) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  if (apiKey !== c.env.MUSCLE_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { to, data, network = 'testnet' } = body;

  if (!to || !data) {
    return c.json({ error: 'Missing to or data' }, 400);
  }

  try {
    const chain = network === 'mainnet' ? mantle : mantleSepolia;
    const rpcUrl = network === 'mainnet' ? c.env.MANTLE_RPC_MAINNET : c.env.MANTLE_RPC_TESTNET;

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const res = await publicClient.call({
      to: to as `0x${string}`,
      data: data as `0x${string}`,
    });

    return c.json({
      success: true,
      data: res.data || '0x',
    });
  } catch (error: any) {
    console.error('call error:', error);
    return c.json({
      success: false,
      error: error.message || 'Call failed',
    }, 500);
  }
});

export default app;
