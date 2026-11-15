import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipFixtureEntry {
  name: string;
  text?: string;
  mode?: number;
  localName?: string;
  flags?: number;
}
/** Tiny independent ZIP fixture writer; fixtures contain inert text only. */
export function updateZip(entries: ZipFixtureEntry[]) {
  const local: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name),
      localName = Buffer.from(item.localName ?? item.name);
    const text = Buffer.from(item.text ?? '');
    const compressed = deflateRawSync(text),
      header = Buffer.alloc(30),
      central = Buffer.alloc(46);
    const flags = item.flags ?? 0x800;
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(text), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(text.length, 22);
    header.writeUInt16LE(localName.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(text), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(text.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((item.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    local.push(header, localName, compressed);
    directory.push(central, name);
    offset += header.length + localName.length + compressed.length;
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}
export const windowsEntries: ZipFixtureEntry[] = [
  { name: 'Pi Studio/Pi Studio.exe', text: 'Inert test fixture, never executable.' },
  { name: 'Pi Studio/resources/app/package.json', text: '{"version":"0.2.0-alpha.76"}' },
];
