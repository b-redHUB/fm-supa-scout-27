"""Read-only access to a running fm.exe's memory (Windows, ctypes, no deps)."""
import ctypes as C
import ctypes.wintypes as W
import re
import subprocess

PROCESS_VM_READ, PROCESS_QUERY_INFORMATION = 0x10, 0x400
MEM_COMMIT, MEM_PRIVATE = 0x1000, 0x20000
READABLE = {0x02, 0x04, 0x20, 0x40}  # R, RW, RX, RWX (no guard/noaccess)

k32 = C.WinDLL('kernel32', use_last_error=True)
k32.OpenProcess.restype = W.HANDLE
k32.ReadProcessMemory.argtypes = [W.HANDLE, C.c_void_p, C.c_void_p, C.c_size_t, C.POINTER(C.c_size_t)]
k32.VirtualQueryEx.argtypes = [W.HANDLE, C.c_void_p, C.c_void_p, C.c_size_t]


class MBI(C.Structure):
    _fields_ = [('BaseAddress', C.c_void_p), ('AllocationBase', C.c_void_p), ('AllocationProtect', W.DWORD),
                ('PartitionId', W.WORD), ('RegionSize', C.c_size_t), ('State', W.DWORD),
                ('Protect', W.DWORD), ('Type', W.DWORD)]


def find_pid(name='fm.exe'):
    out = subprocess.run(['tasklist', '/FI', f'IMAGENAME eq {name}', '/FO', 'CSV', '/NH'],
                         capture_output=True, text=True).stdout
    m = re.search(r'"[^"]+","(\d+)"', out)
    if not m:
        raise LookupError(f'{name} not running')
    return int(m.group(1))


class Proc:
    def __init__(self, pid=None):
        self.pid = pid or find_pid()
        self.h = k32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, self.pid)
        if not self.h:
            raise OSError(C.get_last_error(), 'OpenProcess failed (try running as admin)')

    def regions(self, private_only=True):
        addr, mbi = 0, MBI()
        while k32.VirtualQueryEx(self.h, C.c_void_p(addr), C.byref(mbi), C.sizeof(mbi)):
            base, size = mbi.BaseAddress or 0, mbi.RegionSize
            if mbi.State == MEM_COMMIT and mbi.Protect in READABLE and (not private_only or mbi.Type == MEM_PRIVATE):
                yield base, size
            addr = base + size

    def module(self, name):
        """(base address, full path) of a loaded module."""
        psapi = C.WinDLL('psapi')
        mods, need = (C.c_void_p * 2048)(), W.DWORD()
        psapi.EnumProcessModulesEx(self.h, mods, C.sizeof(mods), C.byref(need), 3)
        buf = C.create_unicode_buffer(1024)
        for m in mods[:need.value // 8]:
            psapi.GetModuleBaseNameW(self.h, C.c_void_p(m), buf, 1024)
            if buf.value.lower() == name.lower():
                psapi.GetModuleFileNameExW(self.h, C.c_void_p(m), buf, 1024)
                return m, buf.value
        raise LookupError(f'{name} not loaded -- is a save game open?')

    def module_base(self, name):
        return self.module(name)[0]

    def read(self, addr, n):
        buf, got = C.create_string_buffer(n), C.c_size_t()
        if not k32.ReadProcessMemory(self.h, C.c_void_p(addr), buf, n, C.byref(got)):
            return b''
        return buf.raw[:got.value]

    def u64(self, addr):
        b = self.read(addr, 8)
        return int.from_bytes(b, 'little') if len(b) == 8 else None

    def find_u64(self, values):
        """Addresses of every 8-aligned u64 in private memory equal to one of `values`: {value: [addr]}."""
        import numpy as np
        keys = np.array(sorted(values), dtype=np.uint64)
        out = {v: [] for v in values}
        for base, size in self.regions():
            for off in range(0, size, 64 << 20):
                buf = self.read(base + off, min(64 << 20, size - off))
                a = np.frombuffer(buf[:len(buf) // 8 * 8], np.uint64)
                for i in np.nonzero(np.isin(a, keys))[0]:
                    out[int(a[i])].append(base + off + int(i) * 8)
        return out
