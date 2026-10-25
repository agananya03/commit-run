import { ethers, network } from "hardhat";

// Prints the network settings the rest of the project relies on.
// npm run check:network            -> in-process hardhat network
// npx hardhat run scripts/check-network.ts --network localhost   -> running node
async function main(): Promise<void> {
  const signers = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const block = await ethers.provider.getBlock("latest");

  console.log(`network      ${network.name}`);
  console.log(`chainId      ${chainId}`);
  console.log(`accounts     ${signers.length}`);
  console.log(`#0 deployer  ${signers[0]?.address}`);
  console.log(`#1 watchdog  ${signers[1]?.address}`);
  console.log(`gasLimit     ${block?.gasLimit}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
