/**
 * Allowed document MIME types
 */
import type {FileType} from '@types';
const DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/html',
  'text/css',
  'application/xhtml+xml'
] as const;

/**
 * File type categories
 */

/**
 * Check if a MIME type is valid for the specified file type category
 * 
 * @param mime - MIME type to validate (e.g., 'image/png', 'video/mp4')
 * @param type - File type category ('image', 'video', 'document')
 * @returns true if the MIME type matches the category, false otherwise
 * 
 * @example
 * checkFileType('image/png', 'image') // returns true
 * checkFileType('video/mp4', 'image') // returns false
 * checkFileType('application/pdf', 'document') // returns true
 */
export function checkFileType(mime: string, type: FileType): boolean {
  if (type === 'image') {
    return mime.startsWith('image/');
  }
  
  if (type === 'video') {
    return mime.startsWith('video/');
  }
  
  if (type === 'document') {
    // Allow any 'text/*' MIME types
    if (mime.startsWith('text/')) {
      return true;
    }
    
    // Check against allowed document types
    return DOCUMENT_TYPES.includes(mime as typeof DOCUMENT_TYPES[number]);
  }
  
  return false;
}