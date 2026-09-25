CREATE TABLE "NumberRegulatoryDocument" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "requirementName" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "supportingDocumentSid" TEXT,
    "providerStatus" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberRegulatoryDocument_pkey"
        PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX
    "NumberRegulatoryDocument_supportingDocumentSid_key"
    ON "NumberRegulatoryDocument"("supportingDocumentSid");

CREATE UNIQUE INDEX
    "NumberRegulatoryDocument_profileId_requirementName_key"
    ON "NumberRegulatoryDocument"("profileId", "requirementName");

CREATE INDEX
    "NumberRegulatoryDocument_profileId_idx"
    ON "NumberRegulatoryDocument"("profileId");

CREATE INDEX
    "NumberRegulatoryDocument_providerStatus_idx"
    ON "NumberRegulatoryDocument"("providerStatus");

ALTER TABLE "NumberRegulatoryDocument"
    ADD CONSTRAINT "NumberRegulatoryDocument_profileId_fkey"
    FOREIGN KEY ("profileId")
    REFERENCES "NumberRegulatoryProfile"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
