import { describe, expect, it } from 'vitest';
import { attachRefusal, fileTypeOf, isExecutableName, isImageName, MAX_FILE_BYTES, objectFolderSegments, sanitizeFileName, storedFileName } from '../domain/index.ts';

describe('file names', () => {
  it('keep only the name, and nothing Windows refuses', () => {
    expect(sanitizeFileName('C:\\Users\\me\\Manual.pdf')).toBe('Manual.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt');
    expect(sanitizeFileName('trailing. . ')).toBe('trailing');
    expect(sanitizeFileName('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFileName('lpt1')).toBe('_lpt1');
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('...')).toBe('file');
    expect(sanitizeFileName('tab\there.pdf')).toBe('tab_here.pdf');
    const long = sanitizeFileName(`${'x'.repeat(300)}.stl`);
    expect(long.length).toBe(120);
    expect(long.endsWith('.stl')).toBe(true);
  });

  it('are stored under the object folder, unique by file id', () => {
    expect(storedFileName('fil_12345678', 'My Manual.pdf')).toBe('fil_12345678-My Manual.pdf');
    expect(objectFolderSegments('7K3F9QXM')).toEqual(['files', 'objects', '7K3F9QXM']);
  });
});

describe('file types', () => {
  it('come from the extension only', () => {
    expect(fileTypeOf('manual.PDF')).toBe('application/pdf');
    expect(fileTypeOf('benchy.stl')).toBe('model/stl');
    expect(fileTypeOf('no-extension')).toBe('application/octet-stream');
    expect(fileTypeOf('.hidden')).toBe('application/octet-stream');
    expect(isImageName('photo.JPG')).toBe(true);
    expect(isImageName('logo.svg')).toBe(false);
  });

  it('executables are recognised, whatever the case', () => {
    for (const n of ['setup.exe', 'RUN.BAT', 'x.ps1', 'link.lnk', 'script.js', 'tool.msi', 'a.url']) expect(isExecutableName(n), n).toBe(true);
    for (const n of ['manual.pdf', 'model.stl', 'profile.ini', 'firmware.bin']) expect(isExecutableName(n), n).toBe(false);
  });
});

describe('attaching', () => {
  const ok = { insideDataRoot: false, isFile: true, sizeBytes: 1024 };
  it('refuses a source inside the data root, folders, empty and oversized files', () => {
    expect(attachRefusal(ok)).toBeNull();
    expect(attachRefusal({ ...ok, insideDataRoot: true })).toBe('inside_data_root');
    expect(attachRefusal({ ...ok, isFile: false })).toBe('not_a_file');
    expect(attachRefusal({ ...ok, sizeBytes: 0 })).toBe('empty');
    expect(attachRefusal({ ...ok, sizeBytes: MAX_FILE_BYTES })).toBeNull();
    expect(attachRefusal({ ...ok, sizeBytes: MAX_FILE_BYTES + 1 })).toBe('too_large');
    // Inside the data root is refused first, whatever else is true.
    expect(attachRefusal({ insideDataRoot: true, isFile: false, sizeBytes: 0 })).toBe('inside_data_root');
  });
});
