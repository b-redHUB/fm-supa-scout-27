"""Resolve MSVC x64 RTTI type names in a PE file to vtable RVAs.

usage: python rtti.py <dll> <regex on class name>
"""
import re
import struct
import sys


class PE:
    def __init__(self, path):
        self.d = open(path, 'rb').read()
        pe = struct.unpack_from('<I', self.d, 0x3c)[0]
        nsec, optsz = struct.unpack_from('<H', self.d, pe + 6)[0], struct.unpack_from('<H', self.d, pe + 20)[0]
        self.base = struct.unpack_from('<Q', self.d, pe + 24 + 24)[0]
        self.secs = []
        for i in range(nsec):
            o = pe + 24 + optsz + i * 40
            name = self.d[o:o + 8].rstrip(b'\0').decode()
            vsz, va, rsz, raw = struct.unpack_from('<IIII', self.d, o + 8)
            self.secs.append((name, va, vsz, raw, rsz))

    def off2rva(self, off):
        for _, va, vsz, raw, rsz in self.secs:
            if raw <= off < raw + rsz:
                return off - raw + va

    def rva2off(self, rva):
        for _, va, vsz, raw, rsz in self.secs:
            if va <= rva < va + rsz:
                return rva - va + raw

    def sec(self, name):
        return next(s for s in self.secs if s[0] == name)


def vtables(pe, names_rx):
    """Yield (class_name, vtable_rva, col_offset) for classes matching regex."""
    d = pe.d  # ponytail: whole-file scans; RTTI is spread over odd section names in this DLL
    for m in re.finditer(rb'\.\?AV([A-Za-z0-9_@]+?)@@\0', d):
        name = m.group(1).decode()
        if not re.search(names_rx, name):
            continue
        td_rva = pe.off2rva(m.start() - 16)
        # COL: u32 sig=1, u32 offset, u32 cdOffset, u32 pTypeDescriptor, u32 pClassDescriptor, u32 pSelf
        for c in re.finditer(re.escape(struct.pack('<I', td_rva)), d):
            col = c.start() - 12
            if col < 0 or struct.unpack_from('<I', d, col)[0] != 1:
                continue
            col_rva = pe.off2rva(col)
            if struct.unpack_from('<I', d, col + 20)[0] != col_rva:
                continue
            off = struct.unpack_from('<I', d, col + 4)[0]
            for v in re.finditer(re.escape(struct.pack('<Q', pe.base + col_rva)), d):
                if v.start() % 8 == 0:
                    yield name, pe.off2rva(v.start()) + 8, off


if __name__ == '__main__':
    pe = PE(sys.argv[1])
    for name, vt, off in vtables(pe, sys.argv[2]):
        print(f'{name:50s} vtable_rva=0x{vt:x} offset={off}')
