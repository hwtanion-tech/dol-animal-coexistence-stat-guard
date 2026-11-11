"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const create = require("../src/custom-tuning/scripts/tuning.js");
const file = path.join(__dirname, "../work/validation/time.js");
const available = fs.existsSync(file);

test("patched physique if/else preserves both farm branches and guards only negative changes", { skip: !available }, () => {
    const source = fs.readFileSync(file, "utf8");
    const start = source.indexOf("if (V.physique >= 1000)");
    const end = source.indexOf("V.hairlength += 3;", start);
    assert.ok(start > 0 && end > start);
    const snippet = source.slice(start, end);
    for (const farm of [0, 6]) {
        const V = { player: {}, physique: 10000, farm_stage: farm };
        const root = { V };
        const api = create(root); root.DOLmodTuning = api;
        const context = { V, window: root, maplebirch: { get: () => null }, Math };
        vm.runInNewContext(snippet, context);
        assert.equal(V.physique, 10000 - 10000 / (farm >= 6 ? 3000 : 2500));
        V.physique = 10000; api.protect("physique");
        vm.runInNewContext(snippet, context);
        assert.equal(V.physique, 10000);
    }
});

test("patched sources remain safe if runtime has not loaded yet", { skip: !available }, () => {
    const source = fs.readFileSync(file, "utf8");
    const line = source.split("\n").find(line => line.includes('natural("willpower"'));
    const V = { willpower: 100 };
    vm.runInNewContext(line, { V, window: {} });
    assert.equal(V.willpower, 99);
});

test("patched beauty statement preserves positive gains but drops a guarded negative tick", { skip: !available }, () => {
    const source = fs.readFileSync(file, "utf8");
    const line = source.split("\n").find(line => line.includes('amount("beauty"'));
    const V = { player: {}, trauma: 0, traumamax: 100 };
    const root = { V }; const api = create(root); root.DOLmodTuning = api;
    const amounts = [];
    const context = { V, window: root, statChange: { skill(name, amount) { amounts.push([name, amount]); } } };
    api.protect("beauty");
    vm.runInNewContext(line, context);
    V.trauma = 100;
    vm.runInNewContext(line, context);
    api.protect("beauty", false);
    vm.runInNewContext(line, context);
    assert.deepEqual(amounts, [["beauty", 100], ["beauty", 0], ["beauty", -100]]);
});
