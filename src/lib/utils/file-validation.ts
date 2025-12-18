/**
 * File upload validation utilities
 * Prevents security issues from malicious file uploads
 */

import { REPLAY_VALIDATION } from './constants';

const ALLOWED_EXTENSIONS = REPLAY_VALIDATION.ALLOWED_EXTENSIONS;
const MAX_FILE_SIZE = REPLAY_VALIDATION.MAX_FILE_SIZE_BYTES;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate uploaded replay file
 *
 * @param file - File object from upload
 * @returns Validation result
 */
export function validateReplayFile(file: File): ValidationResult {
  // Check file extension
  const fileName = file.name.toLowerCase();
  const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) => fileName.endsWith(ext));

  if (!hasValidExtension) {
    return {
      valid: false,
      error: `Invalid file type. Only .osr files are allowed.`,
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
    };
  }

  // Check if file is empty
  if (file.size === 0) {
    return {
      valid: false,
      error: 'File is empty.',
    };
  }

  return { valid: true };
}

/**
 * Validate file path (server-side)
 * Prevents directory traversal attacks
 */
export function validateFilePath(filePath: string): ValidationResult {
  // Check for directory traversal attempts
  if (filePath.includes('..') || filePath.includes('~')) {
    return {
      valid: false,
      error: 'Invalid file path: directory traversal detected.',
    };
  }

  // Check for absolute paths (should be relative)
  if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) {
    return {
      valid: false,
      error: 'Invalid file path: absolute paths not allowed.',
    };
  }

  // Check extension
  const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) => filePath.toLowerCase().endsWith(ext));

  if (!hasValidExtension) {
    return {
      valid: false,
      error: `Invalid file type. Only ${ALLOWED_EXTENSIONS.join(', ')} files are allowed.`,
    };
  }

  return { valid: true };
}

/**
 * Sanitize filename for safe storage
 * Removes special characters and limits length
 */
export function sanitizeFilename(filename: string): string {
  // Remove path components
  const basename = filename.split(/[/\\]/).pop() || 'replay';

  // Remove special characters except dots, hyphens, underscores
  const sanitized = basename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .toLowerCase();

  // Limit length (preserve extension)
  const maxLength = REPLAY_VALIDATION.MAX_FILENAME_LENGTH;
  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  const ext = sanitized.slice(sanitized.lastIndexOf('.'));
  const nameWithoutExt = sanitized.slice(0, sanitized.lastIndexOf('.'));
  return nameWithoutExt.slice(0, maxLength - ext.length) + ext;
}

/**
 * Generate safe file path for replay storage
 *
 * @param attemptId - Attempt ID
 * @param originalFilename - Original uploaded filename
 * @returns Safe file path relative to uploads directory
 */
export function generateReplayPath(attemptId: number, originalFilename: string): string {
  const sanitized = sanitizeFilename(originalFilename);
  const timestamp = Date.now();

  // Structure: uploads/replays/{attemptId}_{timestamp}_{filename}.osr
  return `replays/${attemptId}_${timestamp}_${sanitized}`;
}
