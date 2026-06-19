import { Client } from 'minio'
import { env } from '@/env'

// Create and configure the MinIO client
export const minioClient = new Client({
  endPoint: env.MINIO_ENDPOINT,
  useSSL: env.MINIO_USE_SSL === 'true',
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
})

// Function to check if bucket exists and create it if it doesn't
export async function ensureBucketExists(bucketName = env.MINIO_BUCKET_NAME) {
  const bucketExists = await minioClient.bucketExists(bucketName)
  if (!bucketExists) {
    await minioClient.makeBucket(bucketName, 'us-east-1')
  }
}

export function getObjectUrl(
  objectName: string,
  bucketName = env.MINIO_BUCKET_NAME
) {
  const protocol = env.MINIO_USE_SSL === 'true' ? 'https' : 'http'
  return `${protocol}://${env.MINIO_ENDPOINT}/${bucketName}/${objectName}`
}

export function getHashedObjectName(fileHash: string) {
  return fileHash
}

export function getObjectNameFromUrl(
  fileUrl: string,
  bucketName = env.MINIO_BUCKET_NAME
) {
  try {
    const url = new URL(fileUrl)
    const prefix = `/${bucketName}/`

    if (!url.pathname.startsWith(prefix)) {
      return null
    }

    return decodeURIComponent(url.pathname.slice(prefix.length))
  } catch {
    return null
  }
}

export async function objectExists(
  objectName: string,
  bucketName = env.MINIO_BUCKET_NAME
) {
  const bucketExists = await minioClient.bucketExists(bucketName)
  if (!bucketExists) {
    return false
  }

  try {
    await minioClient.statObject(bucketName, objectName)
    return true
  } catch {
    return false
  }
}

// Function to upload a file to MinIO and return the URL
export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  bucketName = env.MINIO_BUCKET_NAME,
  options?: {
    objectName?: string
  }
) {
  await ensureBucketExists(bucketName)

  // Generate a unique object name to avoid collisions
  const objectName = options?.objectName ?? `${Date.now()}-${fileName}`

  // Upload the file to MinIO
  await minioClient.putObject(bucketName, objectName, file, file.length, {
    'Content-Type': contentType,
  })

  return getObjectUrl(objectName, bucketName)
}
