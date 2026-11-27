-- Vortex Cloud Agent backend FULL dump (generated 2026-11-27T21:54:56.221Z)
-- Restore: sqlite3 custom.db < data.sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=OFF;
BEGIN;
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
CREATE TABLE "AnalyticsHit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '/',
    "referrer" TEXT NOT NULL DEFAULT '',
    "ua" TEXT NOT NULL DEFAULT '',
    "day" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
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
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "to" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);
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
CREATE TABLE "LockSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'Unknown device',
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
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
CREATE TABLE "MarketPurchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "priceInr" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "MetricPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT,
    "providerId" TEXT,
    "key" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
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
    "utr" TEXT,
    "screenshot" TEXT,
    "aiScore" INTEGER,
    "aiVerdict" TEXT,
    "aiReason" TEXT,
    "adminNote" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "targets" TEXT NOT NULL DEFAULT '["web"]',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "currentStage" TEXT NOT NULL DEFAULT 'plan',
    "summary" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "runId" TEXT,
    "agentRunId" TEXT,
    "deployApproval" BOOLEAN NOT NULL DEFAULT true,
    "autoDebug" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PipelineRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "agent" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',
    "logs" TEXT NOT NULL DEFAULT '',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "PipelineStage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
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
CREATE TABLE "ProjectSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "ProjectSetting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
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
CREATE TABLE "UserSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
);
CREATE TABLE "VersionSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'manual snapshot',
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "dir" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
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
INSERT INTO "AIProvider" ("id","name","kind","endpoint","apiKeyEnc","model","systemPrompt","temperature","maxTokens","isDefault","role","category","tag","workspaceId","createdAt","updatedAt") VALUES ('cmwzihpch0000rkxgtsafjykq','GLM 5.3 Flash','zai',NULL,NULL,'glm-5.3-flash',NULL,0.7,NULL,1,'work','free',NULL,NULL,1795816020113,1795816020113);
INSERT INTO "AIProvider" ("id","name","kind","endpoint","apiKeyEnc","model","systemPrompt","temperature","maxTokens","isDefault","role","category","tag","workspaceId","createdAt","updatedAt") VALUES ('cmwzihpci0001rkxgcpt1k5wd','GLM 5.3','zai',NULL,NULL,'glm-5.3',NULL,0.7,NULL,0,'work','free',NULL,NULL,1795816020114,1795816020114);
INSERT INTO "AIProvider" ("id","name","kind","endpoint","apiKeyEnc","model","systemPrompt","temperature","maxTokens","isDefault","role","category","tag","workspaceId","createdAt","updatedAt") VALUES ('cmwzihpcj0002rkxg6curqdg2','GLM 4.6','zai',NULL,NULL,'glm-4.6',NULL,0.7,NULL,0,'work','free',NULL,NULL,1795816020115,1795816020115);
INSERT INTO "AuthUser" ("id","email","passwordHash","name","role","plan","planKind","planStartedAt","planExpiresAt","status","createdAt","lastLoginAt","referralCode","referredById","referredAt") VALUES ('cmwzihpdm0003rkxglk1maghc','qa-admin115@qa.local','970722211cb632b3b07cfc78c024ed4f:d40a2951d359ad6c6d415c9d7399a031fa841e5ef8ad826f28ed6198b8977081a18c60ee8393920b7329b446c997d81b5deb5045d2cdb7ba7acc5db5f907fce4','QA Admin 115','admin','ultra_pro_max','free',NULL,NULL,'active',1795816020155,NULL,NULL,NULL,NULL);
INSERT INTO "AuthUser" ("id","email","passwordHash","name","role","plan","planKind","planStartedAt","planExpiresAt","status","createdAt","lastLoginAt","referralCode","referredById","referredAt") VALUES ('cmwzihpen0004rkxgetcrwxwy','mdhonabali61@gmail.com','946f05152d85179330313dbe511713c6:36ad33c2e2860b7ea6de6b3da4a5af195c58c9f7d7d4d0d178a687e7d2ed2ff1a00893fdcf33720d8d518a2d154ca39d2875ef0339ecec9cca2d62cb010dabc4','Md Honabali','admin','ultra_pro_max','admin',NULL,NULL,'active',1795816020191,NULL,NULL,NULL,NULL);
INSERT INTO "UserSetting" ("id","key","value") VALUES ('cmwzihpeq0005rkxgywvd35z0','platform_gate_key_v1','CA-X-MONA-9173');
COMMIT;
