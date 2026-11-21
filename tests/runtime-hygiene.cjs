#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// The browser's window.name is a real mutable global. Pattern substitution
// must not overwrite it while iterating over the supplied replacement data.
const generatorContext = vm.createContext({
  console,
  Math,
  name: 'window-name-sentinel'
});
vm.runInContext(read('generators/genutil.js'), generatorContext, {filename:'generators/genutil.js'});
const generatedPattern = vm.runInContext(
  "GenUtil.generatePattern('{world} of {world}', {world:['Aster']})",
  generatorContext
);
assert.equal(generatedPattern, 'Aster of Aster');
assert.equal(generatorContext.name, 'window-name-sentinel', 'generatePattern must not overwrite the browser global window.name.');

// Fake XHR gives the test deterministic control over asynchronous completion
// order without changing TextLoad's production implementation.
const requests = [];
class FakeXMLHttpRequest {
  constructor() { this.listeners = {}; this.responseText = ''; this.target = this; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  open(method, url) { this.method = method; this.url = url; }
  overrideMimeType() {}
  send() { requests.push(this); }
  respond(text) {
    this.responseText = text;
    assert.equal(typeof this.listeners.load, 'function', 'A load handler must be registered.');
    this.listeners.load({target:this});
  }
  fail() {
    assert.equal(typeof this.listeners.error, 'function', 'An error handler must be registered.');
    this.listeners.error({target:this});
  }
}

const loaderContext = vm.createContext({
  console: {warn(){}},
  XMLHttpRequest: FakeXMLHttpRequest,
  key: 'global-key-sentinel',
  callback: 'global-callback-sentinel'
});
vm.runInContext(read('textload.js'), loaderContext, {filename:'textload.js'});
const TextLoad = vm.runInContext('TextLoad', loaderContext);

const data = {first:'/first.txt', second:'/second.txt'};
TextLoad.massLoad(data);
assert.equal(requests.length, 2, 'massLoad must start one request per data entry.');
assert.deepEqual(requests.map(request => request.url).sort(), ['/first.txt','/second.txt']);

let firstBatchComplete = 0;
let followupComplete = 0;
let followupValue = null;
TextLoad.onAllLoad(() => {
  firstBatchComplete++;
  // Starting a new batch inside an onAllLoad callback must not be erased by
  // the completion bookkeeping for the batch that just finished.
  TextLoad.load('/followup.txt', result => { followupValue = result; });
  TextLoad.onAllLoad(() => { followupComplete++; });
});

// Complete out of order to detect a shared iterator captured by callbacks.
requests[1].respond('Second line 1\nSecond line 2');
assert.deepEqual(JSON.parse(JSON.stringify(data.second)), ['Second line 1','Second line 2'], 'The second request must update only its own property.');
assert.equal(data.first, '/first.txt', 'An unfinished request must leave its property unchanged.');
assert.equal(firstBatchComplete, 0);
requests[0].respond('First line 1\nFirst line 2');
assert.deepEqual(JSON.parse(JSON.stringify(data.first)), ['First line 1','First line 2']);
assert.deepEqual(JSON.parse(JSON.stringify(data.second)), ['Second line 1','Second line 2']);
assert.equal(firstBatchComplete, 1, 'The first onAllLoad callback must run exactly once.');
assert.equal(requests.length, 3, 'The completion callback must be able to start a follow-up load.');

requests[2].respond('Follow-up data');
assert.deepEqual(JSON.parse(JSON.stringify(followupValue)), ['Follow-up data']);
assert.equal(followupComplete, 1, 'The follow-up completion callback must survive the prior completion cycle.');

assert.equal(loaderContext.key, 'global-key-sentinel', 'massLoad must not leak or overwrite a global key variable.');
assert.equal(loaderContext.callback, 'global-callback-sentinel', 'Completion iteration must not leak or overwrite a global callback variable.');

let errorResult = null;
let errorCompletion = 0;
TextLoad.load('/unavailable.txt', result => { errorResult = result; });
TextLoad.onAllLoad(() => { errorCompletion++; });
assert.equal(requests.length, 4);
requests[3].fail();
assert.deepEqual(JSON.parse(JSON.stringify(errorResult)), [], 'A failed text request must resolve its callback with an empty array.');
assert.equal(errorCompletion, 1, 'A failed request must still release the completion callback queue.');

console.log('PASS: runtime hygiene — generator global isolation, independent async massLoad keys, out-of-order responses, reentrant completion cycles, and failed-request completion.');
