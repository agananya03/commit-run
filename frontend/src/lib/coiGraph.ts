import walletsData from "@/data/wallets.json";
import transfersData from "@/data/transfers.json";
import type { CoiReport, WalletLink } from "@/types/shared";

// 80 Deterministic Hardhat Accounts derived from standard mnemonic
export const HARDHAT_ADDRESSES: Record<number, string> = {
  0: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  1: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  2: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  3: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  4: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  5: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  6: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  7: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  8: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  9: "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
  10: "0xBcd4042DE499D14e55001CcbB24a551F3b954096",
  11: "0x71bE63f3384f5fb98995898A86B02Fb2426c5788",
  12: "0xFABB0ac9d68B0B445fB7357272Ff202C5651694a",
  13: "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec",
  14: "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097",
  15: "0xcd3B766CCDd6AE721141F452C550Ca635964ce71",
  16: "0x2546BcD3c84621e976D8185a91A922aE77ECEc30",
  17: "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E",
  18: "0xdD2FD4581271e230360230F9337D5c0430Bf44C0",
  19: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
  20: "0x09DB0a93B389bEF724429898f539AEB7ac2Dd55f",
  21: "0x02484cb50AAC86Eae85610D6f4Bf026f30f6627D",
};

// Inverted lookup map (all lowercase)
export const ADDRESS_TO_INDEX: Record<string, number> = Object.entries(
  HARDHAT_ADDRESSES
).reduce((acc, [idx, addr]) => {
  acc[addr.toLowerCase()] = Number(idx);
  return acc;
}, {} as Record<string, number>);

export type NodeRole = "proposer" | "disclosed" | "recipient" | "voter" | "hub";

export const ROLE_COLORS: Record<NodeRole, string> = {
  proposer: "#f59e0b", // Amber
  disclosed: "#10b981", // Emerald
  recipient: "#06b6d4", // Cyan
  voter: "#8b5cf6", // Purple / Violet
  hub: "#64748b", // Slate Grey (drawn small)
};

export interface GraphNode {
  id: string; // unique lowercase address or index string
  index: number;
  address: string;
  name: string;
  roleName: string;
  role: NodeRole;
  color: string;
  radius: number;
  isHub: boolean;
  isUndisclosed: boolean;
  mrdBalance: number;
  x?: number;
  y?: number;
  [key: string]: any;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  isUndisclosed: boolean;
  pLink?: number;
  reasons?: string[];
  amount?: string;
  token?: string;
  width: number;
  color: string;
  [key: string]: any;
}

export interface CoiGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function formatAddress(addr: string): string {
  if (!addr) return "";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatTokenAmount(amountBase: string, token: string): string {
  const num = Number(amountBase);
  if (isNaN(num)) return amountBase;
  if (token === "ETH") {
    const eth = num / 1e18;
    return `${eth.toFixed(eth >= 1 ? 1 : 2)} ETH`;
  }
  if (token === "USDC") {
    const usdc = num / 1e6;
    return `$${usdc.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC`;
  }
  if (token === "MRD") {
    const mrd = num / 1e18;
    return `${(mrd / 1e6).toFixed(1)}M MRD`;
  }
  return `${amountBase} ${token}`;
}

export function buildCoiGraph(
  coi: CoiReport | null | undefined,
  proposalId: string
): CoiGraphData {
  const walletList = (walletsData as any).wallets || [];
  const transferList = (transfersData as any).transfers || [];

  const isMIP21 = proposalId === "MIP-21";
  const isMIP17 = proposalId === "MIP-17";
  const isMIP12 = proposalId === "MIP-12";

  const focusIndices = new Set<number>();

  if (isMIP21) {
    [13, 14, 15, 17, 18, 19, 20, 21, 2, 3, 4, 7].forEach((i) => focusIndices.add(i));
  } else if (isMIP17) {
    [10, 11, 12, 15, 18, 19, 20, 2, 3, 4].forEach((i) => focusIndices.add(i));
  } else if (isMIP12) {
    [8, 9, 15, 2, 3, 7].forEach((i) => focusIndices.add(i));
  } else {
    [13, 14, 15, 17, 18, 19].forEach((i) => focusIndices.add(i));
  }

  // Normalize proposer and disclosed addresses
  const proposerAddr = (coi?.proposer || "").toLowerCase().trim();
  const disclosedAddrs = new Set((coi?.disclosed || []).map((a) => a.toLowerCase().trim()));

  const undisclosedFromToAddrs = new Set<string>();
  const undisclosedPathPairs: Array<{
    source: string;
    target: string;
    pLink: number;
    reasons: string[];
  }> = [];

  (coi?.undisclosedLinks || []).forEach((link) => {
    undisclosedFromToAddrs.add(link.from.toLowerCase().trim());
    undisclosedFromToAddrs.add(link.to.toLowerCase().trim());

    const path = link.path || [link.from, link.to];
    for (let i = 0; i < path.length - 1; i++) {
      undisclosedPathPairs.push({
        source: path[i].toLowerCase().trim(),
        target: path[i + 1].toLowerCase().trim(),
        pLink: link.pLink,
        reasons: link.reasons || [],
      });
    }

    path.forEach((p) => {
      const pClean = p.toLowerCase().trim();
      const pNum = Number(pClean);
      if (!isNaN(pNum) && pNum >= 0 && pNum < 80) {
        focusIndices.add(pNum);
      } else if (ADDRESS_TO_INDEX[pClean] !== undefined) {
        focusIndices.add(ADDRESS_TO_INDEX[pClean]);
      }
    });
  });

  // Resolve proposer index
  let proposerIndex = isMIP21 ? 13 : isMIP17 ? 10 : isMIP12 ? 8 : 13;
  if (proposerAddr && ADDRESS_TO_INDEX[proposerAddr] !== undefined) {
    proposerIndex = ADDRESS_TO_INDEX[proposerAddr];
    focusIndices.add(proposerIndex);
  }

  // Construct Nodes
  const nodes: GraphNode[] = [];
  const nodeIndexToId = new Map<number, string>();
  const nodeAddressToId = new Map<string, string>();

  // Layout anchors so nodes are well-distributed
  const initialPositions: Record<number, { x: number; y: number }> = {
    13: { x: -140, y: -40 },  // MIP-21 Proposer
    14: { x: -50, y: -70 },   // MIP-21 Alt
    17: { x: -60, y: 30 },    // MIP-21 Secondary
    15: { x: 50, y: 0 },      // CEX Hub
    18: { x: 140, y: -60 },   // Whale 18
    19: { x: 150, y: 20 },    // Whale 19
    20: { x: 90, y: 80 },     // Whale 20
    21: { x: 130, y: 90 },    // Whale 21
    2: { x: -120, y: 90 },    // Aria
    3: { x: -10, y: 110 },    // Bo
    4: { x: -160, y: 40 },    // Chen
    7: { x: 30, y: -100 },    // Farid
    10: { x: -130, y: -30 },  // MIP-17 Proposer
    11: { x: -50, y: -20 },   // MIP-17 Intermediary
    12: { x: 30, y: -60 },    // MIP-17 Recipient
    8: { x: -120, y: -10 },   // MIP-12 Proposer
    9: { x: 20, y: -30 },     // MIP-12 Recipient
  };

  focusIndices.forEach((idx) => {
    const rawWallet = walletList.find((w: any) => w.index === idx) || {
      index: idx,
      role: "holder",
      label: `Wallet ${idx}`,
      mrd: 0,
    };

    const checksummedAddress = HARDHAT_ADDRESSES[idx] || `0x${idx.toString(16).padStart(40, "0")}`;
    const normalizedAddr = checksummedAddress.toLowerCase();
    const id = normalizedAddr; // standard lowercase ID

    nodeIndexToId.set(idx, id);
    nodeAddressToId.set(normalizedAddr, id);

    // Determine role: 'proposer' | 'disclosed' | 'recipient' | 'voter' | 'hub'
    let role: NodeRole = "voter";
    const isHub = idx === 15 || idx === 11 || rawWallet.role.includes("hub") || rawWallet.role.includes("intermediary");
    const isProposer = idx === proposerIndex || rawWallet.role.includes("proposer");
    const isDisclosed =
      disclosedAddrs.has(normalizedAddr) ||
      (coi?.disclosed || []).some(
        (d) => d.toLowerCase().includes(`index ${idx}`) || d.toLowerCase() === normalizedAddr
      );
    const isRecipient = (isMIP12 && idx === 9) || (isMIP17 && idx === 12) || rawWallet.role.includes("recipient");

    if (isProposer) {
      role = "proposer";
    } else if (isDisclosed) {
      role = "disclosed";
    } else if (isRecipient) {
      role = "recipient";
    } else if (isHub) {
      role = "hub";
    } else {
      role = "voter";
    }

    const isUndisclosedTarget = undisclosedFromToAddrs.has(normalizedAddr) && !isProposer;
    const radius = isHub ? 4.5 : isProposer ? 9.5 : isRecipient || isDisclosed ? 8.5 : 7;

    // Display labels from wallets.json
    let displayName = rawWallet.label || `Wallet #${idx}`;
    if (idx === 13) displayName = "kestrel.eth (Proposer #13)";
    else if (idx === 14) displayName = "Alt Wallet #14 (Benchmark)";
    else if (idx === 15) displayName = "CEX Hub #15";
    else if (idx === 17) displayName = "Secondary Wallet #17";
    else if (idx === 10) displayName = "Orion DAO (Proposer #10)";
    else if (idx === 11) displayName = "Intermediary #11";
    else if (idx === 12) displayName = "Nexus Labs (Recipient #12)";
    else if (idx === 8) displayName = "Ecosystem Lead (Proposer #8)";
    else if (idx === 9) displayName = "Dev Studio (Recipient #9)";
    else if (idx >= 18 && idx <= 21) displayName = `Whale #${idx} (${rawWallet.mrd ? (rawWallet.mrd / 1e6).toFixed(0) : 15}M MRD)`;
    else if (idx >= 2 && idx <= 7) displayName = `${rawWallet.label?.split(" ")[0]} (Delegate #${idx})`;

    const pos = initialPositions[idx] || { x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200 };

    nodes.push({
      id,
      index: idx,
      address: checksummedAddress,
      name: displayName,
      roleName: rawWallet.role,
      role,
      color: ROLE_COLORS[role],
      radius,
      isHub,
      isUndisclosed: isUndisclosedTarget,
      mrdBalance: rawWallet.mrd || 0,
      x: pos.x,
      y: pos.y,
    });
  });

  // Construct Links
  const links: GraphLink[] = [];
  const linkKeySet = new Set<string>();

  // Helper to resolve an endpoint (address or index) to node ID
  const resolveToNodeId = (endpoint: string): string | null => {
    const clean = endpoint.toLowerCase().trim();
    if (nodeAddressToId.has(clean)) return nodeAddressToId.get(clean)!;

    const num = Number(clean);
    if (!isNaN(num) && nodeIndexToId.has(num)) return nodeIndexToId.get(num)!;

    if (ADDRESS_TO_INDEX[clean] !== undefined) {
      const idx = ADDRESS_TO_INDEX[clean];
      if (nodeIndexToId.has(idx)) return nodeIndexToId.get(idx)!;
    }

    return null;
  };

  // 1. Add Undisclosed Links (highlighted in red with pLink labels)
  undisclosedPathPairs.forEach((pair, i) => {
    const srcId = resolveToNodeId(pair.source);
    const dstId = resolveToNodeId(pair.target);

    if (!srcId || !dstId || srcId === dstId) return;

    const linkKey = `${srcId}-${dstId}`;
    linkKeySet.add(linkKey);

    const srcIdx = ADDRESS_TO_INDEX[srcId];
    const dstIdx = ADDRESS_TO_INDEX[dstId];

    const matchingTx = transferList.find(
      (tx: any) => tx.fromIndex === srcIdx && tx.toIndex === dstIdx
    );

    const amountFormatted = matchingTx
      ? formatTokenAmount(matchingTx.amount, matchingTx.token)
      : isMIP21 && srcIdx === 13 && dstIdx === 14
      ? "2.0 ETH"
      : isMIP21 && srcIdx === 14 && dstIdx === 17
      ? "1.0 ETH"
      : isMIP17 && srcIdx === 10 && dstIdx === 11
      ? "25.0 ETH"
      : isMIP17 && srcIdx === 11 && dstIdx === 12
      ? "20.0 ETH"
      : "Undisclosed";

    const token = matchingTx ? matchingTx.token : "ETH";

    links.push({
      id: `undisclosed-${i}-${srcIdx}-${dstIdx}`,
      source: srcId,
      target: dstId,
      isUndisclosed: true,
      pLink: pair.pLink,
      reasons: pair.reasons,
      amount: amountFormatted,
      token,
      width: 4, // thick red link
      color: "#ef4444",
    });
  });

  // 2. Add other transfers between selected nodes
  transferList.forEach((tx: any, idx: number) => {
    if (focusIndices.has(tx.fromIndex) && focusIndices.has(tx.toIndex)) {
      const srcId = nodeIndexToId.get(tx.fromIndex);
      const dstId = nodeIndexToId.get(tx.toIndex);
      if (!srcId || !dstId) return;

      const linkKey = `${srcId}-${dstId}`;
      if (linkKeySet.has(linkKey)) return;
      linkKeySet.add(linkKey);

      let baseVal = 1;
      if (tx.token === "ETH") baseVal = Number(tx.amount) / 1e18;
      else if (tx.token === "USDC") baseVal = Number(tx.amount) / 1e6;
      else baseVal = Number(tx.amount) / 1e18;

      const thickness = Math.max(1.5, Math.min(6, 1.2 + Math.log10(Math.max(1, baseVal)) * 1.2));

      links.push({
        id: `tx-${tx.id || idx}`,
        source: srcId,
        target: dstId,
        isUndisclosed: false,
        amount: formatTokenAmount(tx.amount, tx.token),
        token: tx.token,
        width: thickness,
        color: "#475569",
      });
    }
  });

  // 3. Connect MIP-21 alt wallet / secondary to CEX Hub so whole graph is unified
  if (isMIP21) {
    const hubId = nodeIndexToId.get(15);
    const altId = nodeIndexToId.get(14);
    if (hubId && altId && !linkKeySet.has(`${altId}-${hubId}`)) {
      links.push({
        id: "tx-alt-hub-bridge",
        source: altId,
        target: hubId,
        isUndisclosed: false,
        amount: "15,000 USDC",
        token: "USDC",
        width: 2,
        color: "#334155",
      });
    }
  }

  return { nodes, links };
}
