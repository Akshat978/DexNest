/**
 * Rules for attached files. The host copies, hashes, opens and deletes; this
 * file decides names, types and what is allowed. Contents are never parsed:
 * the type comes from the extension alone.
 */

export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_NAME_LENGTH = 120;

/** Segments of an object's folder under the data root: files/objects/<id>. */
export const objectFolderSegments = (objectId: string) => ['files', 'objects', objectId] as const;

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * A safe file name from whatever the owner's file was called: no folders, no
 * characters Windows refuses, no trailing dots or spaces, no reserved device
 * names, at most MAX_NAME_LENGTH characters with the extension kept.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  let clean = base
    .replace(/[\u0000-\u001F\u007F<>:"|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!clean || /^\.+$/.test(clean)) clean = 'file';
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  let safeStem = RESERVED.test(stem) ? `_${stem}` : stem;
  const room = MAX_NAME_LENGTH - ext.length;
  if (safeStem.length > room) safeStem = safeStem.slice(0, Math.max(1, room));
  return `${safeStem}${ext.length < MAX_NAME_LENGTH ? ext : ''}`;
}

/** The name inside the object's folder: unique by file id, readable by name. */
export function storedFileName(fileId: string, name: string): string {
  return `${fileId}-${sanitizeFileName(name)}`;
}

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  stl: 'model/stl',
  '3mf': 'model/3mf',
  obj: 'model/obj',
  step: 'model/step',
  stp: 'model/step',
  gcode: 'text/x-gcode',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  bin: 'application/octet-stream',
};

export function fileTypeOf(name: string): string {
  return TYPES[extensionOf(name)] ?? 'application/octet-stream';
}

export function isImageName(name: string): boolean {
  return fileTypeOf(name).startsWith('image/') && extensionOf(name) !== 'svg';
}

/**
 * Extensions the system would run rather than show. "Open" never hands these
 * to the default app; it shows them in their folder instead.
 */
export const EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'msi', 'msix', 'appx', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'hta', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe',
  'js', 'jse', 'wsf', 'wsh', 'lnk', 'url', 'reg', 'jar', 'msc', 'gadget', 'application', 'sh', 'bash', 'command',
  'app', 'dll', 'sys', 'drv', 'ocx', 'inf', 'chm', 'iso', 'img', 'vhd', 'vhdx', 'appref-ms', 'library-ms', 'settingcontent-ms',
]);

export function isExecutableName(name: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(extensionOf(name));
}

export type AttachRefusal = 'inside_data_root' | 'too_large' | 'not_a_file' | 'empty';

export const ATTACH_REFUSAL_TEXT: Record<AttachRefusal, string> = {
  inside_data_root: "That file is inside DexNest's data. Attach the original, not a copy DexNest keeps.",
  too_large: `That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
  not_a_file: 'That is not a file.',
  empty: 'That file is empty.',
};

/**
 * Whether a source may be attached, from what the host found out about it
 * (without reading it): where it really is and how big it is.
 */
export function attachRefusal(source: { insideDataRoot: boolean; isFile: boolean; sizeBytes: number }): AttachRefusal | null {
  if (source.insideDataRoot) return 'inside_data_root';
  if (!source.isFile) return 'not_a_file';
  if (source.sizeBytes <= 0) return 'empty';
  if (source.sizeBytes > MAX_FILE_BYTES) return 'too_large';
  return null;
}

export const SHA256 = /^[0-9a-f]{64}$/;
