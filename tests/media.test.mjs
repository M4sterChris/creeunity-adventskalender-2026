import test from 'node:test';
import assert from 'node:assert/strict';
import { safeAudioUrl, privateAudioPath, detectAudio } from '../media.js';
import { byteRange } from '../tools/send-file.mjs';
import { validateConfig } from '../script.js';
import { readFile } from 'node:fs/promises';

test('Audio-Import erhält Dateien und weist aktive oder fremde Formate ab', async () => {
  const config=JSON.parse(await readFile(new URL('../examples/doors-data.example.json',import.meta.url),'utf8'));
  config.doors[0].audio='./audio/tag1.mp3';
  assert.equal(validateConfig(config).doors[0].audio,'./audio/tag1.mp3');
  for(const value of ['javascript:alert(1)','data:audio/wav;base64,AAA','http://fremd.example/a.mp3','./secret.html']){
    config.doors[0].audio=value;assert.throws(()=>validateConfig(config),/Audio/);
    assert.equal(safeAudioUrl(value),'');
  }
  assert.equal(safeAudioUrl('https://example.com/a.mp3?version=2'),'https://example.com/a.mp3?version=2');
  for(const p of ['../audio/a.mp3','audio/../a.mp3','images/a.mp3','audio/a.html'])assert.throws(()=>privateAudioPath(p));
});
test('Audio-Upload erkennt echte Container statt nur Dateinamen',()=>{
  const wav=new Uint8Array(44);wav.set(new TextEncoder().encode('RIFF'));wav.set(new TextEncoder().encode('WAVE'),8);
  assert.equal(detectAudio(wav).mime,'audio/wav');
  assert.equal(detectAudio(new TextEncoder().encode('ID3'+'.'.repeat(20))).extension,'mp3');
  assert.throws(()=>detectAudio(new TextEncoder().encode('<script>alert(1)</script>')));
});
test('Suchleisten unterstützen Teilbereiche und Dateiende, ungültige Bereiche werden abgelehnt',()=>{
  assert.deepEqual(byteRange('bytes=0-99',1000),{start:0,end:99});
  assert.deepEqual(byteRange('bytes=100-',1000),{start:100,end:999});
  assert.deepEqual(byteRange('bytes=-20',1000),{start:980,end:999});
  assert.deepEqual(byteRange('bytes=900-2000',1000),{start:900,end:999});
  for(const range of ['bytes=1000-','bytes=10-2','bytes=-0','bytes=0-1,5-7','bad'])assert.equal(byteRange(range,1000),false);
});
