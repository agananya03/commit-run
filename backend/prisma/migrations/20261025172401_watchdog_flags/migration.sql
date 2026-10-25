-- CreateTable
CREATE TABLE "WatchdogFlagRecord" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "simulationRunId" TEXT NOT NULL,
    "operationId" VARCHAR(66) NOT NULL,
    "findingsHash" VARCHAR(66) NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchdogFlagRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchdogFlagRecord_simulationRunId_key" ON "WatchdogFlagRecord"("simulationRunId");

-- CreateIndex
CREATE INDEX "WatchdogFlagRecord_proposalId_idx" ON "WatchdogFlagRecord"("proposalId");

-- CreateIndex
CREATE INDEX "WatchdogFlagRecord_operationId_idx" ON "WatchdogFlagRecord"("operationId");

-- AddForeignKey
ALTER TABLE "WatchdogFlagRecord" ADD CONSTRAINT "WatchdogFlagRecord_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchdogFlagRecord" ADD CONSTRAINT "WatchdogFlagRecord_simulationRunId_fkey" FOREIGN KEY ("simulationRunId") REFERENCES "SimulationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
