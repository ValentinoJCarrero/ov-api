-- CreateEnum
CREATE TYPE "AiCallType" AS ENUM ('PARSE_INTENT', 'PARSE_STAFF_INTENT', 'ANSWER_QUESTION');

-- CreateTable
CREATE TABLE "token_usage_logs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "callType" "AiCallType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "token_usage_logs_createdAt_idx" ON "token_usage_logs"("createdAt");

-- CreateIndex
CREATE INDEX "token_usage_logs_businessId_createdAt_idx" ON "token_usage_logs"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "token_usage_logs" ADD CONSTRAINT "token_usage_logs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
