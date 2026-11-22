-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "framework" TEXT,
    "language" TEXT,
    "runtime" TEXT,
    "entryPort" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "lastOpenedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "workspaceId" TEXT,
    "deletedAt" DATETIME,
    "userId" TEXT,
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "isDir" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "File_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Build" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "logs" TEXT NOT NULL DEFAULT '',
    "artifactPath" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Build_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "model" TEXT,
    "provider" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "response" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "ProjectSetting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EnvVar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT true,
    "workspaceId" TEXT,
    CONSTRAINT "EnvVar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EnvVar_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "endpoint" TEXT,
    "apiKeyEnc" TEXT,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'work',
    "category" TEXT,
    "tag" TEXT,
    "workspaceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AIProvider_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "GitHubAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "username" TEXT,
    "defaultOwner" TEXT,
    "userId" TEXT,
    "workspaceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GitHubAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "brandColor" TEXT,
    "customDomain" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'enterprise',
    "storageLimitMb" INTEGER NOT NULL DEFAULT 1000000,
    "monthlyBudgetUsd" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'developer',
    "invitedBy" TEXT,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "TeamMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'developer',
    "token" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invoiceId" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Credit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "used" REAL NOT NULL DEFAULT 0,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Credit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "dueDate" DATETIME,
    "paidAt" DATETIME,
    "lineItems" TEXT NOT NULL DEFAULT '[]',
    "pdfPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ArtifactMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buildId" TEXT NOT NULL,
    "sha256" TEXT,
    "sizeBytes" INTEGER,
    "versionTag" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "expiresAt" DATETIME,
    "sharedWith" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VisualRegressionSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "screenshotPath" TEXT NOT NULL,
    "baselinePath" TEXT,
    "diffPath" TEXT,
    "diffPercent" REAL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "viewport" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DeviceTestResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "buildId" TEXT,
    "deviceName" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "screenshots" TEXT NOT NULL DEFAULT '[]',
    "videoPath" TEXT,
    "crashLog" TEXT,
    "duration" INTEGER,
    "provider" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "agentRunId" TEXT,
    "checkpoint" TEXT,
    "maxTokens" INTEGER,
    "maxIterations" INTEGER,
    "maxFileChanges" INTEGER,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MetricPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT,
    "providerId" TEXT,
    "key" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PromptLibrary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "workspaceId" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "rating" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ModelBenchmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CustomWidget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "framework" TEXT NOT NULL,
    "codePath" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "workspaceId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AnalyticsHit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '/',
    "referrer" TEXT NOT NULL DEFAULT '',
    "ua" TEXT NOT NULL DEFAULT '',
    "day" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VersionSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'manual snapshot',
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "dir" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LockPasskey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "credentialId" TEXT NOT NULL,
    "publicKeyJwk" TEXT NOT NULL,
    "signCount" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL DEFAULT 'This device',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LockSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'Unknown device',
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UsageDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'chat',
    "requests" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'single',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "lastStatus" TEXT NOT NULL DEFAULT 'never run yet',
    "lastRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Schedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'user',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planKind" TEXT NOT NULL DEFAULT 'free',
    "planStartedAt" DATETIME,
    "planExpiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME,
    "referralCode" TEXT,
    "referredById" TEXT,
    "referredAt" DATETIME
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'Unknown device',
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'monthly',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'created',
    "method" TEXT,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'apps',
    "priceInr" INTEGER NOT NULL DEFAULT 0,
    "thumbSvg" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "installs" INTEGER NOT NULL DEFAULT 0,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketPurchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "priceInr" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProjectCollaborator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'editor',
    "status" TEXT NOT NULL DEFAULT 'active',
    "invitedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CustomDomain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME,
    "lastCheckedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Project_lastOpenedAt_idx" ON "Project"("lastOpenedAt");

-- CreateIndex
CREATE INDEX "Project_workspaceId_idx" ON "Project"("workspaceId");

-- CreateIndex
CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "Project_userId_deletedAt_lastOpenedAt_idx" ON "Project"("userId", "deletedAt", "lastOpenedAt");

-- CreateIndex
CREATE INDEX "File_projectId_idx" ON "File"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "File_projectId_path_key" ON "File"("projectId", "path");

-- CreateIndex
CREATE INDEX "Build_projectId_createdAt_idx" ON "Build"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_projectId_createdAt_idx" ON "AgentRun"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSetting_projectId_key_key" ON "ProjectSetting"("projectId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "EnvVar_projectId_key_key" ON "EnvVar"("projectId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "UserSetting_key_key" ON "UserSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "TeamMember_workspaceId_idx" ON "TeamMember"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_workspaceId_userId_key" ON "TeamMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_workspaceId_idx" ON "Invitation"("workspaceId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_idx" ON "AuditLog"("projectId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "BillingRecord_workspaceId_createdAt_idx" ON "BillingRecord"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Credit_workspaceId_type_key" ON "Credit"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactMetadata_buildId_key" ON "ArtifactMetadata"("buildId");

-- CreateIndex
CREATE INDEX "VisualRegressionSnapshot_projectId_createdAt_idx" ON "VisualRegressionSnapshot"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "DeviceTestResult_projectId_createdAt_idx" ON "DeviceTestResult"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentTask_projectId_status_priority_idx" ON "AgentTask"("projectId", "status", "priority");

-- CreateIndex
CREATE INDEX "AgentTask_workspaceId_status_idx" ON "AgentTask"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "MetricPoint_key_createdAt_idx" ON "MetricPoint"("key", "createdAt");

-- CreateIndex
CREATE INDEX "MetricPoint_workspaceId_key_idx" ON "MetricPoint"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "PromptLibrary_category_isPublic_idx" ON "PromptLibrary"("category", "isPublic");

-- CreateIndex
CREATE INDEX "PromptLibrary_workspaceId_idx" ON "PromptLibrary"("workspaceId");

-- CreateIndex
CREATE INDEX "ModelBenchmark_task_score_idx" ON "ModelBenchmark"("task", "score");

-- CreateIndex
CREATE UNIQUE INDEX "ModelBenchmark_providerId_model_task_key" ON "ModelBenchmark"("providerId", "model", "task");

-- CreateIndex
CREATE INDEX "CustomWidget_framework_idx" ON "CustomWidget"("framework");

-- CreateIndex
CREATE INDEX "CustomWidget_workspaceId_idx" ON "CustomWidget"("workspaceId");

-- CreateIndex
CREATE INDEX "AnalyticsHit_projectId_day_idx" ON "AnalyticsHit"("projectId", "day");

-- CreateIndex
CREATE INDEX "AnalyticsHit_projectId_createdAt_idx" ON "AnalyticsHit"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "VersionSnapshot_projectId_createdAt_idx" ON "VersionSnapshot"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LockPasskey_credentialId_key" ON "LockPasskey"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "LockSession_tokenHash_key" ON "LockSession"("tokenHash");

-- CreateIndex
CREATE INDEX "LockSession_lastSeenAt_idx" ON "LockSession"("lastSeenAt");

-- CreateIndex
CREATE INDEX "UsageDaily_day_idx" ON "UsageDaily"("day");

-- CreateIndex
CREATE UNIQUE INDEX "UsageDaily_day_provider_model_kind_key" ON "UsageDaily"("day", "provider", "model", "kind");

-- CreateIndex
CREATE INDEX "Schedule_projectId_idx" ON "Schedule"("projectId");

-- CreateIndex
CREATE INDEX "Schedule_nextRunAt_idx" ON "Schedule"("nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthUser_email_key" ON "AuthUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthUser_referralCode_key" ON "AuthUser"("referralCode");

-- CreateIndex
CREATE INDEX "AuthUser_email_idx" ON "AuthUser"("email");

-- CreateIndex
CREATE INDEX "AuthUser_plan_status_idx" ON "AuthUser"("plan", "status");

-- CreateIndex
CREATE INDEX "AuthUser_referredById_idx" ON "AuthUser"("referredById");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketListing_status_createdAt_idx" ON "MarketListing"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketListing_sellerId_idx" ON "MarketListing"("sellerId");

-- CreateIndex
CREATE INDEX "MarketPurchase_buyerId_idx" ON "MarketPurchase"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPurchase_listingId_buyerId_key" ON "MarketPurchase"("listingId", "buyerId");

-- CreateIndex
CREATE INDEX "ProjectCollaborator_projectId_idx" ON "ProjectCollaborator"("projectId");

-- CreateIndex
CREATE INDEX "ProjectCollaborator_userId_idx" ON "ProjectCollaborator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCollaborator_projectId_userId_key" ON "ProjectCollaborator"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomDomain_domain_key" ON "CustomDomain"("domain");

-- CreateIndex
CREATE INDEX "CustomDomain_userId_idx" ON "CustomDomain"("userId");

-- CreateIndex
CREATE INDEX "CustomDomain_projectId_idx" ON "CustomDomain"("projectId");

