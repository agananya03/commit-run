-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'INGESTED', 'COMMITTED', 'ACTIVE', 'QUEUED', 'HALTED', 'EXECUTED', 'DEFEATED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('forum', 'pdf', 'social', 'onchain', 'disclosure');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('info', 'low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "FindingCategory" AS ENUM ('recipient_mismatch', 'amount_mismatch', 'undeclared_action', 'ownership_change', 'unlimited_approval', 'new_privileged_function', 'coi', 'unsupported_claim', 'contradiction');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskAction" AS ENUM ('none', 'review', 'halt');

-- CreateEnum
CREATE TYPE "SimulationSource" AS ENUM ('PROPOSED', 'QUEUED');

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "proposer" VARCHAR(42) NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "governorProposalId" TEXT,
    "operationId" VARCHAR(66),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVersion" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "canonicalJson" JSONB NOT NULL,
    "versionHash" VARCHAR(66) NOT NULL,
    "prevHash" VARCHAR(66) NOT NULL,
    "evidenceRoot" VARCHAR(66) NOT NULL,
    "commitTxHash" VARCHAR(66),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceFile" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "proposalVersionId" TEXT,
    "type" "EvidenceType" NOT NULL,
    "uri" TEXT NOT NULL,
    "sha256" VARCHAR(66) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Summary" (
    "id" TEXT NOT NULL,
    "proposalVersionId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "tldr" TEXT NOT NULL,
    "amountUsd" DECIMAL(20,2),
    "pctOfTreasury" DOUBLE PRECISION,
    "unsupportedClaims" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntentSpecRecord" (
    "id" TEXT NOT NULL,
    "proposalVersionId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "actionCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentSpecRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "proposalVersionId" TEXT,
    "source" "SimulationSource" NOT NULL DEFAULT 'PROPOSED',
    "operationId" VARCHAR(66),
    "forkBlock" INTEGER,
    "data" JSONB NOT NULL,
    "success" BOOLEAN NOT NULL,
    "simHash" VARCHAR(66) NOT NULL,
    "bytecodeHash" VARCHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoiReportRecord" (
    "id" TEXT NOT NULL,
    "proposalVersionId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "pCoi" DOUBLE PRECISION NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "undisclosedLinks" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoiReportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "simulationRunId" TEXT,
    "findingKey" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "category" "FindingCategory" NOT NULL,
    "said" TEXT NOT NULL,
    "does" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "simRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskChainRecord" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "simulationRunId" TEXT,
    "data" JSONB NOT NULL,
    "prior" DOUBLE PRECISION NOT NULL,
    "posterior" DOUBLE PRECISION NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "action" "RiskAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskChainRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT,
    "blockNumber" INTEGER NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "contract" TEXT NOT NULL,
    "address" VARCHAR(42) NOT NULL,
    "name" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "address" VARCHAR(42) NOT NULL,
    "label" TEXT,
    "role" TEXT,
    "hardhatIndex" INTEGER,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "token" VARCHAR(42),
    "from" VARCHAR(42) NOT NULL,
    "to" VARCHAR(42) NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_slug_key" ON "Proposal"("slug");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalVersion_proposalId_version_key" ON "ProposalVersion"("proposalId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalVersion_proposalId_versionHash_key" ON "ProposalVersion"("proposalId", "versionHash");

-- CreateIndex
CREATE INDEX "EvidenceFile_proposalId_idx" ON "EvidenceFile"("proposalId");

-- CreateIndex
CREATE INDEX "EvidenceFile_sha256_idx" ON "EvidenceFile"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceFile_proposalVersionId_type_uri_key" ON "EvidenceFile"("proposalVersionId", "type", "uri");

-- CreateIndex
CREATE UNIQUE INDEX "Summary_proposalVersionId_key" ON "Summary"("proposalVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "IntentSpecRecord_proposalVersionId_key" ON "IntentSpecRecord"("proposalVersionId");

-- CreateIndex
CREATE INDEX "SimulationRun_proposalId_createdAt_idx" ON "SimulationRun"("proposalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoiReportRecord_proposalVersionId_key" ON "CoiReportRecord"("proposalVersionId");

-- CreateIndex
CREATE INDEX "Finding_proposalId_severity_idx" ON "Finding"("proposalId", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_simulationRunId_findingKey_key" ON "Finding"("simulationRunId", "findingKey");

-- CreateIndex
CREATE INDEX "RiskChainRecord_proposalId_createdAt_idx" ON "RiskChainRecord"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "ChainEvent_proposalId_idx" ON "ChainEvent"("proposalId");

-- CreateIndex
CREATE INDEX "ChainEvent_blockNumber_idx" ON "ChainEvent"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ChainEvent_txHash_logIndex_key" ON "ChainEvent"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_hardhatIndex_key" ON "Wallet"("hardhatIndex");

-- CreateIndex
CREATE INDEX "Transfer_from_idx" ON "Transfer"("from");

-- CreateIndex
CREATE INDEX "Transfer_to_idx" ON "Transfer"("to");

-- CreateIndex
CREATE INDEX "Transfer_blockNumber_idx" ON "Transfer"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_txHash_logIndex_key" ON "Transfer"("txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_proposalVersionId_fkey" FOREIGN KEY ("proposalVersionId") REFERENCES "ProposalVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_proposalVersionId_fkey" FOREIGN KEY ("proposalVersionId") REFERENCES "ProposalVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntentSpecRecord" ADD CONSTRAINT "IntentSpecRecord_proposalVersionId_fkey" FOREIGN KEY ("proposalVersionId") REFERENCES "ProposalVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationRun" ADD CONSTRAINT "SimulationRun_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationRun" ADD CONSTRAINT "SimulationRun_proposalVersionId_fkey" FOREIGN KEY ("proposalVersionId") REFERENCES "ProposalVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoiReportRecord" ADD CONSTRAINT "CoiReportRecord_proposalVersionId_fkey" FOREIGN KEY ("proposalVersionId") REFERENCES "ProposalVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_simulationRunId_fkey" FOREIGN KEY ("simulationRunId") REFERENCES "SimulationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskChainRecord" ADD CONSTRAINT "RiskChainRecord_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskChainRecord" ADD CONSTRAINT "RiskChainRecord_simulationRunId_fkey" FOREIGN KEY ("simulationRunId") REFERENCES "SimulationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainEvent" ADD CONSTRAINT "ChainEvent_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
