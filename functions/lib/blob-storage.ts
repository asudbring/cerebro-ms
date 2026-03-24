import {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';

const CONTAINER_NAME = 'cerebro-files';

let containerClient: ContainerClient | null = null;

function getContainerClient(): ContainerClient {
  if (!containerClient) {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
    }
    const serviceClient = BlobServiceClient.fromConnectionString(connStr);
    containerClient = serviceClient.getContainerClient(CONTAINER_NAME);
  }
  return containerClient;
}

function parseConnectionString(connStr: string): { accountName: string; accountKey: string } {
  const parts = new Map<string, string>();
  for (const segment of connStr.split(';')) {
    const idx = segment.indexOf('=');
    if (idx > 0) {
      parts.set(segment.slice(0, idx), segment.slice(idx + 1));
    }
  }

  const accountName = parts.get('AccountName');
  const accountKey = parts.get('AccountKey');
  if (!accountName || !accountKey) {
    throw new Error('Connection string missing AccountName or AccountKey');
  }
  return { accountName, accountKey };
}

export async function uploadFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  prefix: string = 'teams/'
): Promise<string> {
  const blobPath = `${prefix}${Date.now()}-${fileName}`;
  const client = getContainerClient();
  const blockBlobClient = client.getBlockBlobClient(blobPath);

  try {
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType },
    });
    return blobPath;
  } catch (err) {
    console.error('Failed to upload file to blob storage:', err);
    throw err;
  }
}

export async function generateSasUrl(blobPath: string): Promise<string> {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
  }

  const { accountName, accountKey } = parseConnectionString(connStr);
  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const client = getContainerClient().getBlobClient(blobPath);

  // 1-year expiry for long-lived file references
  const expiresOn = new Date();
  expiresOn.setFullYear(expiresOn.getFullYear() + 1);

  const sasParams = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn,
    },
    credential
  );

  return `${client.url}?${sasParams.toString()}`;
}
