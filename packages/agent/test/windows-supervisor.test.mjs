import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installService } from '../dist/service.js';

test('Windows service is one hidden persistent supervisor with no periodic watchdog task', { skip: process.platform !== 'win32' }, () => {
  const dir=mkdtempSync(path.join(tmpdir(),'brc-service-'));
  const old=process.env.BRC_HOME;
  const calls=[];
  try {
    process.env.BRC_HOME=dir;
    mock.method(childProcess,'execFileSync',(cmd,args)=>{ calls.push([cmd,args]); return Buffer.from(''); });
    syncBuiltinESMExports();
    installService([]);

    const supervisor=path.join(dir,'supervise-agent.ps1');
    const taskXml=path.join(dir,'agent-task.xml');
    assert.ok(existsSync(supervisor));
    assert.ok(existsSync(taskXml));
    assert.equal(existsSync(path.join(dir,'start-agent.cmd')),false);
    assert.equal(existsSync(path.join(dir,'start-agent.vbs')),false);

    const ps=readFileSync(supervisor,'utf8');
    assert.match(ps,/System\.Threading\.Mutex/);
    assert.match(ps,/while \(\$true\)/);
    assert.match(ps,/Start-Sleep -Seconds 5/);

    const xml=readFileSync(taskXml,'utf16le');
    assert.match(xml,/<LogonTrigger>/);
    assert.match(xml,/<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
    assert.match(xml,/<RestartOnFailure>/);
    assert.match(xml,/-WindowStyle Hidden/);
    assert.doesNotMatch(xml,/<Repetition>|<CalendarTrigger>|PT1M<\/Interval>/);

    const create=calls.find(([cmd,args])=>String(cmd).toLowerCase()==='schtasks'&&args.includes('/Create'));
    assert.ok(create,'register one logon supervisor task');
  } finally {
    process.env.BRC_HOME=old;
    mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(dir,{recursive:true,force:true});
  }
});
