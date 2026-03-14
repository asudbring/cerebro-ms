/**
 * Azure Blob Storage helpers for file upload and SAS URL generation.
 *
 * Requires env var: AZURE_STORAGE_CONNECTION_STRING
 */

import { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } from "@azure/storage-blob";
import { randomUUID } from "crypto";

const CONTAINER_NAME = "cerebro-files";

let blobServiceClient: BlobServiceClient | null = null;

function getClient(): BlobServiceClient {
  if (!blobServiceClient) {
    blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING!
    );
  }
  return blobServiceClient;
}

/**
 * Upload a file buffer to blob storage. Returns the blob URL.
 */
export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  contentType: string
): Promise<{ blobUrl: string; blobName: string }> {
  const client = getClient();
  const containerClient = client.getContainerClient(CONTAINER_NAME);

  const ext = originalName.includes(".") ? originalName.split(".").pop() : "bin";
  const blobName = `${randomUUID()}.${ext}`;

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return { blobUrl: blockBlobClient.url, blobName };
}

/**
 * Generate a read-only SAS URL for a blob, valid for 1 year.
 */
export function generateSasUrl(blobName: string): string {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING!;
  const accountName = connStr.match(/AccountName=([^;]+)/)?.[1] || "";
  const accountKey = connStr.match(/AccountKey=([^;]+)/)?.[1] || "";

  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const expiresOn = new Date();
  expiresOn.setFullYear(expiresOn.getFullYear() + 1);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      expiresOn,
    },
    credential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${CONTAINER_NAME}/${blobName}?${sasToken}`;
}
