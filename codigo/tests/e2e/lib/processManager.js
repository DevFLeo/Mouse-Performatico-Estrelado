'use strict';

const { spawn, execFileSync, execSync } = require('child_process');
const path = require('path');

class ProcessManager {
  constructor(runId) {
    this.runId = runId || `${Date.now()}_${process.pid}`;
    this.trackedPids = new Set();
    this.spawnedRootPids = new Set();
    this.trackedTokens = new Set();
    this.cleanups = new Set();
    this._signalHandlersInstalled = false;
    this._needsExitCleanup = false;
  }

  installSignalHandlers() {
    if (this._signalHandlersInstalled) return;
    this._signalHandlersInstalled = true;

    const handleExit = () => {
      if (!this._needsExitCleanup) return;
      this.cleanupAllSync();
    };

    process.once('SIGINT', () => {
      this._needsExitCleanup = true;
      handleExit();
      process.exit(130);
    });
    process.once('SIGTERM', () => {
      this._needsExitCleanup = true;
      handleExit();
      process.exit(143);
    });
    process.once('exit', handleExit);
  }

  registerToken(token) {
    if (token) {
      this.trackedTokens.add(String(token));
      this._needsExitCleanup = true;
    }
  }

  registerCleanup(fn) {
    if (typeof fn === 'function') {
      this.cleanups.add(fn);
      this._needsExitCleanup = true;
    }
  }

  unregisterCleanup(fn) {
    this.cleanups.delete(fn);
  }

  trackPid(pid) {
    if (Number.isInteger(pid) && pid > 0) {
      this.trackedPids.add(pid);
      this.spawnedRootPids.add(pid);
      this._needsExitCleanup = true;
    }
  }

  spawnProcess(exe, args = [], options = {}) {
    this.installSignalHandlers();
    const child = spawn(exe, args, {
      windowsHide: options.windowsHide !== undefined ? options.windowsHide : true,
      ...options
    });
    if (child.pid) {
      this.trackPid(child.pid);
    }
    return child;
  }

  killPidTreeSync(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return;
    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 8000
      });
    } catch (_) {
      // Process may already have exited
    }
    this.trackedPids.delete(pid);
  }

  queryWin32Processes(psWhereClause = '', options = {}) {
    const cimFilter = options && options.cimFilter ? ` -Filter "${String(options.cimFilter).replace(/"/g, '`"')}"` : '';
    const filter = psWhereClause ? `| Where-Object { ${psWhereClause} }` : '';
    const includeCommandLine = !options || options.includeCommandLine !== false;
    const selectProps = includeCommandLine
      ? "ProcessId,ParentProcessId,Name,@{N='CommandLine';E={if ($null -eq $_.CommandLine) { '' } else { [regex]::Replace([string]$_.CommandLine, '[\\x00-\\x1f]', ' ') }}}"
      : 'ProcessId,ParentProcessId,Name';
    const script = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process${cimFilter} ${filter} | Select-Object ${selectProps}) | ConvertTo-Json -Compress`;
    try {
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', windowsHide: true, timeout: 10000 }
      );
      const cleaned = String(out || '')
        .replace(/^\uFEFF/, '')
        .replace(/[\x00-\x1f]/g, ' ')
        .trim();
      if (!cleaned) return [];
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      throw new Error(`Win32_Process PowerShell query failed: ${err && err.message ? err.message : err}`);
    }
  }

  queryProcessMetricsByPids(pids) {
    if (!pids || pids.length === 0) return [];
    const pidList = pids.filter((p) => Number.isInteger(p) && p > 0).join(',');
    if (!pidList) return [];
    const script = `@(Get-Process -Id ${pidList} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,@{N='CpuSec';E={if ($_.TotalProcessorTime) { $_.TotalProcessorTime.TotalSeconds } else { 0 }}},WorkingSet64) | ConvertTo-Json -Compress`;
    try {
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', windowsHide: true, timeout: 10000 }
      ).trim();
      if (!out) return [];
      const parsed = JSON.parse(out);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      throw new Error(`Get-Process PowerShell query failed: ${err && err.message ? err.message : err}`);
    }
  }

  snapshotPidsByImage(imageName) {
    const target = String(imageName || '').toLowerCase();
    const all = this.queryWin32Processes(`$_.Name -ieq '${target.replace(/'/g, "''")}'`);
    return new Set(all.map((p) => p.ProcessId).filter(Boolean));
  }

  killNewProcessesByImage(imageName, baselinePids) {
    const current = this.snapshotPidsByImage(imageName);
    let killed = 0;
    for (const pid of current) {
      if (!baselinePids.has(pid)) {
        this.killPidTreeSync(pid);
        killed++;
      }
    }
    return killed;
  }

  collectProcessTreePids(rootPid) {
    const all = this.queryWin32Processes();
    const byParent = new Map();
    for (const proc of all) {
      const ppid = proc.ParentProcessId;
      if (!byParent.has(ppid)) byParent.set(ppid, []);
      byParent.get(ppid).push(proc);
    }
    const visited = new Set();
    const list = [];
    const queue = [rootPid];
    while (queue.length > 0) {
      const pid = queue.shift();
      if (visited.has(pid)) continue;
      visited.add(pid);
      const found = all.find((p) => p.ProcessId === pid);
      if (found) list.push(found);
      const children = byParent.get(pid) || [];
      for (const ch of children) {
        if (!visited.has(ch.ProcessId)) queue.push(ch.ProcessId);
      }
    }
    return list;
  }

  getProcessTreeStats(rootPid) {
    const treeProcs = this.collectProcessTreePids(rootPid);
    const pids = treeProcs.map((p) => p.ProcessId);
    const metrics = this.queryProcessMetricsByPids(pids);
    const metricMap = new Map(metrics.map((m) => [m.Id, m]));

    let totalCpuSeconds = 0;
    let totalWorkingSetBytes = 0;
    const processes = treeProcs.map((p) => {
      const m = metricMap.get(p.ProcessId);
      const cpuSeconds = m && typeof m.CpuSec === 'number' ? m.CpuSec : 0;
      const workingSetBytes = m && typeof m.WorkingSet64 === 'number' ? m.WorkingSet64 : 0;
      totalCpuSeconds += cpuSeconds;
      totalWorkingSetBytes += workingSetBytes;
      return {
        pid: p.ProcessId,
        parentPid: p.ParentProcessId,
        name: p.Name,
        commandLine: p.CommandLine || '',
        cpuSeconds,
        workingSetBytes
      };
    });

    return {
      pids,
      totalCpuSeconds,
      totalWorkingSetBytes,
      processes
    };
  }

  sweepByRunTokens() {
    if (this.trackedTokens.size === 0) return 0;
    const tokens = Array.from(this.trackedTokens);
    const escapedTokens = tokens.map((t) => `'${String(t).replace(/'/g, "''")}'`).join(',');
    const psWhere = `$c = [string]$_.CommandLine; if ($c) { $hit = $false; foreach ($t in @(${escapedTokens})) { if ($c.Contains($t)) { $hit = $true; break } }; $hit } else { $false }`;
    const all = this.queryWin32Processes(psWhere);
    let killed = 0;
    for (const proc of all) {
      if (proc.ProcessId === process.pid) continue;
      const cmd = String(proc.CommandLine || '');
      if (tokens.some((tok) => cmd.includes(tok))) {
        this.killPidTreeSync(proc.ProcessId);
        killed++;
      }
    }
    return killed;
  }

  findOrphanProcesses(extraPids = [], extraTokens = []) {
    const pidSet = new Set(
      [...this.trackedPids, ...this.spawnedRootPids, ...extraPids].filter((p) => Number.isInteger(p) && p > 0)
    );
    const tokens = Array.from(new Set([...this.trackedTokens, ...extraTokens].filter(Boolean)));
    if (pidSet.size === 0 && tokens.length === 0) return [];

    const targetNames = ['electron.exe', 'mpehook.exe', 'python.exe', 'mpe.exe'];
    const targetNameSet = new Set(targetNames);
    const clauses = targetNames.map((n) => `Name='${n}'`);
    for (const p of pidSet) {
      clauses.push(`ProcessId=${p}`);
      clauses.push(`ParentProcessId=${p}`);
    }
    const all = this.queryWin32Processes('', { cimFilter: clauses.join(' OR ') });
    const orphans = [];

    for (const proc of all) {
      if (proc.ProcessId === process.pid) continue;
      const name = String(proc.Name || '').toLowerCase();
      if (!targetNameSet.has(name)) continue;
      const cmd = String(proc.CommandLine || '');
      const matchesPid = pidSet.has(proc.ProcessId) || pidSet.has(proc.ParentProcessId);
      const matchesToken = tokens.some((tok) => cmd.includes(tok));
      if (matchesPid || matchesToken) {
        orphans.push({
          pid: proc.ProcessId,
          parentPid: proc.ParentProcessId,
          name: proc.Name,
          commandLine: cmd
        });
      }
    }
    return orphans;
  }

  _killDescendantsOfRootsSync() {
    const roots = new Set([...this.trackedPids, ...this.spawnedRootPids].filter(Boolean));
    if (roots.size === 0) return;

    const all = this.queryWin32Processes('', { includeCommandLine: false });
    const byParent = new Map();
    const byId = new Map();
    for (const proc of all) {
      byId.set(proc.ProcessId, proc);
      const ppid = proc.ParentProcessId;
      if (!byParent.has(ppid)) byParent.set(ppid, []);
      byParent.get(ppid).push(proc);
    }

    const toKill = new Set();
    const queue = Array.from(roots);
    const visited = new Set();
    while (queue.length > 0) {
      const pid = queue.shift();
      if (visited.has(pid)) continue;
      visited.add(pid);
      if (pid !== process.pid && byId.has(pid)) {
        toKill.add(pid);
      }
      const children = byParent.get(pid) || [];
      for (const ch of children) {
        if (ch.ProcessId !== process.pid) {
          toKill.add(ch.ProcessId);
        }
        if (!visited.has(ch.ProcessId)) {
          queue.push(ch.ProcessId);
        }
      }
    }

    for (const pid of toKill) {
      this.killPidTreeSync(pid);
    }
  }

  async cleanupAll() {
    for (const fn of Array.from(this.cleanups)) {
      try {
        await fn();
      } catch (_) {}
    }
    this.cleanups.clear();

    for (const pid of Array.from(this.trackedPids)) {
      this.killPidTreeSync(pid);
    }
    this._killDescendantsOfRootsSync();
    this.sweepByRunTokens();

    const hasTrackedTargets =
      this.trackedPids.size > 0 || this.spawnedRootPids.size > 0 || this.trackedTokens.size > 0;
    if (hasTrackedTargets) {
      const deadline = Date.now() + 3000;
      while (true) {
        const remaining = this.findOrphanProcesses();
        if (remaining.length === 0) break;
        for (const proc of remaining) {
          this.killPidTreeSync(proc.pid);
        }
        if (Date.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    this.trackedPids.clear();
    this._needsExitCleanup = false;
  }

  cleanupAllSync() {
    for (const fn of Array.from(this.cleanups)) {
      try {
        const res = fn();
        if (res && typeof res.catch === 'function') res.catch(() => {});
      } catch (_) {}
    }
    this.cleanups.clear();

    for (const pid of Array.from(this.trackedPids)) {
      this.killPidTreeSync(pid);
    }
    try {
      this._killDescendantsOfRootsSync();
    } catch (_) {}
    try {
      this.sweepByRunTokens();
    } catch (_) {}
    this.trackedPids.clear();
    this._needsExitCleanup = false;
  }
}

module.exports = { ProcessManager };
