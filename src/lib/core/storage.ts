/**
 * Storage Abstraction Layer
 * Decouples filesystem access to enable cloud storage providers (S3, R2, etc.)
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Generic storage provider interface
 * Implementations: LocalStorageProvider, S3StorageProvider (future)
 */
export interface StorageProvider {
  /**
   * Read file content as Buffer
   * @throws Error if file doesn't exist or read fails
   */
  read(key: string): Promise<Buffer>;

  /**
   * Read file content as string
   * @throws Error if file doesn't exist or read fails
   */
  readText(key: string): Promise<string>;

  /**
   * Write file content
   * @throws Error if write fails
   */
  write(key: string, data: Buffer | string): Promise<void>;

  /**
   * Check if file exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Delete file
   * @throws Error if delete fails
   */
  delete(key: string): Promise<void>;

  /**
   * Ensure parent directory exists (no-op for cloud providers)
   */
  ensureDir(key: string): Promise<void>;
}

/**
 * Local filesystem storage provider
 * Uses a base directory path (configurable via env)
 */
export class LocalStorageProvider implements StorageProvider {
  private basePath: string;

  constructor(basePath: string) {
    // Resolve to absolute path
    this.basePath = path.resolve(basePath);
  }

  /**
   * Get full absolute path for a storage key
   */
  private getFullPath(key: string): string {
    const normalizedKey = path.normalize(key).replace(/^([/\\])+/, '');

    // Resolve under basePath and verify the result stays within basePath.
    const resolved = path.resolve(this.basePath, normalizedKey);
    const basePrefix = this.basePath.endsWith(path.sep)
      ? this.basePath
      : this.basePath + path.sep;

    if (resolved !== this.basePath && !resolved.startsWith(basePrefix)) {
      throw new Error('Invalid storage key (path traversal detected)');
    }

    return resolved;
  }

  async read(key: string): Promise<Buffer> {
    const fullPath = this.getFullPath(key);
    return await fs.readFile(fullPath);
  }

  async readText(key: string): Promise<string> {
    const fullPath = this.getFullPath(key);
    return await fs.readFile(fullPath, 'utf-8');
  }

  async write(key: string, data: Buffer | string): Promise<void> {
    const fullPath = this.getFullPath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data, typeof data === 'string' ? 'utf-8' : undefined);
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.getFullPath(key);
    return existsSync(fullPath);
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    await fs.unlink(fullPath);
  }

  async ensureDir(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
  }
}

/**
 * Factory function to get the configured storage provider
 * Reads from environment variables:
 * - STORAGE_PROVIDER: "local" | "s3" (default: "local")
 * - STORAGE_BASE_DIR: Base directory for local storage (default: "./cache")
 */
export function getStorageProvider(): StorageProvider {
  const providerType = process.env.STORAGE_PROVIDER || 'local';

  switch (providerType) {
    case 'local': {
      const baseDir = process.env.STORAGE_BASE_DIR || './cache';
      return new LocalStorageProvider(baseDir);
    }

    case 's3': {
      // TODO: Implement S3StorageProvider when needed
      throw new Error('S3 storage provider not yet implemented. Use STORAGE_PROVIDER=local');
    }

    default: {
      throw new Error(`Unknown storage provider: ${providerType}. Supported: local, s3`);
    }
  }
}

/**
 * Singleton storage provider instance
 * Call getStorageProvider() once during initialization
 */
let storageInstance: StorageProvider | null = null;

/**
 * Get or create the singleton storage provider
 */
export function getStorage(): StorageProvider {
  if (!storageInstance) {
    storageInstance = getStorageProvider();
  }
  return storageInstance;
}
