const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const baseChunks = [
  {
    id: 'MIP-21:forum:0',
    proposalId: 'MIP-21',
    sourceType: 'forum',
    sourceUri: 'forum://MIP-21/forum_thread.json#post=1',
    text: '[MIP-21] VaultV2: storage packing and gas optimisation, posted by kestrel.eth. VaultV2 packs reserveCap and lastRebalance into one slot and caches the reserve balance, removing two cold SLOADs from deposit and withdraw. Net effect: ~1% cheaper user operations.'
  },
  {
    id: 'MIP-21:forum:1',
    proposalId: 'MIP-21',
    sourceType: 'forum',
    sourceUri: 'forum://MIP-21/forum_thread.json#post=1',
    text: 'This is purely a gas optimisation, with no change to ownership. Storage layout is preserved and the Timelock stays in control of the Vault.'
  },
  {
    id: 'MIP-21:forum:2',
    proposalId: 'MIP-21',
    sourceType: 'forum',
    sourceUri: 'forum://MIP-21/forum_thread.json#post=6',
    text: 'auditooor: Can we see the actual VaultV2 diff before voting? kestrel.eth: Everything is in the spec PDF, and the implementation was reviewed internally by the core team.'
  },
  {
    id: 'MIP-21:pdf:0',
    proposalId: 'MIP-21',
    sourceType: 'pdf',
    sourceUri: 'pdf://MIP-21/proposal.pdf#page=3',
    page: 3,
    text: '3. Scope. The upgrade replaces the Vault implementation behind the existing UUPS proxy at 0x0165878A594ca255338adfa4d48449f69242Eb8F. Changes are limited to slot packing and EIP-2929 warm-access savings. The Timelock remains the sole owner of the Vault.'
  },
  {
    id: 'MIP-21:pdf:1',
    proposalId: 'MIP-21',
    sourceType: 'pdf',
    sourceUri: 'pdf://MIP-21/proposal.pdf#page=4',
    page: 4,
    text: '4. Benchmarks. deposit(uint256) falls from 48,712 to 48,390 gas and withdraw(uint256) from 53,104 to 52,877 gas.'
  },
  {
    id: 'MIP-21:social:0',
    proposalId: 'MIP-21',
    sourceType: 'social',
    sourceUri: 'social://MIP-21/social.json#msg=4',
    text: '@kestrel_builds: MIP-21 is up for vote, a small gas win for every Meridian depositor. Big thanks to 0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097 for running the benchmarks.'
  },
  {
    id: 'MIP-21:onchain:0',
    proposalId: 'MIP-21',
    sourceType: 'onchain',
    sourceUri: 'onchain://MIP-21/onchain_actions.json',
    text: 'ProposalCreated proposalId=95770418730186424211874856728532228392459849764019463351709297748745394921355 proposer=0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec targets=[0x0165878A594ca255338adfa4d48449f69242Eb8F,0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9] values=[0,0] calldatas=[0x4f1ef28600000000000000000000000017f24d3b8bc1150553b54da30b4d993acb88921200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000024be6b99e3000000000000000000000000df3e18d64bc6a983f673ab319ccae4f1a57c709700000000000000000000000000000000000000000000000000000000,0xe1f21c67000000000000000000000000e7f1725e7734ce288f8367e1bb143e90bb3f0512000000000000000000000000df3e18d64bc6a983f673ab319ccae4f1a57c7097ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff] description=\"# MIP-21: VaultV2 storage packing and gas optimisation\"'
  }
];

const computedChunks = baseChunks.map(c => {
  const hash = '0x' + crypto.createHash('sha256').update(c.text, 'utf8').digest('hex');
  return { ...c, sha256: hash };
});

// Add one deliberately tampered chunk to demo the red cross
computedChunks.push({
  id: 'MIP-21:tampered:0',
  proposalId: 'MIP-21',
  sourceType: 'forum',
  sourceUri: 'forum://MIP-21/forum_thread.json#post=99',
  text: '[TAMPERED] This chunk text was secretly modified after submission to claim 100% savings, but the cryptographic SHA-256 hash was not updated.',
  sha256: '0xdeadbeefbadc0de0000000000000000000000000000000000000000000000000'
});

const localPath = path.resolve(__dirname, '../public/mocks-local/chunks.json');
const mockPath = path.resolve(__dirname, '../public/mocks/chunks.json');

fs.mkdirSync(path.dirname(localPath), { recursive: true });
fs.mkdirSync(path.dirname(mockPath), { recursive: true });

fs.writeFileSync(localPath, JSON.stringify(computedChunks, null, 2), 'utf8');
fs.writeFileSync(mockPath, JSON.stringify(computedChunks, null, 2), 'utf8');
console.log('Successfully generated chunks.json with', computedChunks.length, 'chunks (including 1 tampered chunk).');
