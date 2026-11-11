"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const create = require("../src/custom-tuning/scripts/tuning.js");

// Exercise the user's actual framework algorithm (local reference only, not
// redistributed in the mod ZIP). Host APIs and native widgets remain mocked.
const reference = path.join(__dirname, "../work/reference/inject_early.js");
function frameworkFixture() {
    const source = fs.readFileSync(reference, "utf8");
    const start = source.indexOf("let Transformation=class Transformation");
    const end = source.indexOf(";let sh=", start);
    assert.ok(start > 0 && end > start, "Known framework class boundary must match exactly");
    class Hooks {
        constructor() { this.items = new Map(); }
        add(name, fn) { this.items.set(name, fn); }
        execute(...args) { return [...this.items.values()].map(fn => fn(...args)); }
    }
    const v = {
        player: {}, settings: { transformDivineEnabled: false, transformAnimalEnabled: true },
        wolfgirl: 6, cat: 6, cow: 6, harpy: 6, fox: 6,
        wolfbuild: 30, catbuild: 30, cowbuild: 30, birdbuild: 30, foxbuild: 30,
        physicalTransform: 1, maplebirch: { transformation: {} }, worn: { neck: { name: "none", cursed: 0 } },
        transformationParts: { traits: {} }, timeMessages: []
    };
    const setup = { transformations: [] };
    const gameMath = Object.create(Math);
    gameMath.clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const context = { aH: Hooks, sn: {}, ss: {}, sp: {}, so: [], sl: {}, sc: [], aX: { variables: v, setup }, Math: gameMath };
    const Manager = vm.runInNewContext(source.slice(start, end) + ";Transformation", context);
    const manager = new Manager({ core: { tool: { define() {}, defineS() {} } } });
    const invoked = [];
    manager.wikifier = (...args) => invoked.push(args);
    const native = { wolf: "wolfgirl", cat: "cat", cow: "cow", bird: "harpy", fox: "fox" };
    for (const [name, key] of Object.entries(native)) {
        manager.animalTransforms.push({ name, level: () => v[key], build: () => v[name + "build"] });
        manager.animalMacros[name] = [name + "Transform", () => v[key]];
        manager.suppressConditions[name] = [source => source !== name];
        manager.buildUpdaters[name] = amount => { v[name + "build"] += amount; };
        manager.decayConditions[name] = [() => v[name + "build"] >= 1];
    }
    for (const name of ["whale", "horse", "raven"]) {
        v.maplebirch.transformation[name] = { level: 1, build: 10 };
        v.transformationParts[name] = {};
        manager.config.set(name, { type: "physical", level: 6, build: 100, update: [5, 10, 15, 20, 25, 30], parts: [], traits: [] });
        manager.suppressConditions[name] = [source => source !== name];
        manager.decayConditions[name] = [() => v.maplebirch.transformation[name].build >= 1];
    }
    const root = {
        V: v, setup,
        maplebirch: { char: { transformation: manager }, get: () => null, dynamic: { TimeEvents: {} } },
        console: { info() {}, warn() {} }
    };
    const api = create(root);
    return { api, manager, v, root, invoked };
}

test("actual framework updates eight animals and suppresses none when coexist is enabled", { skip: !fs.existsSync(reference) }, () => {
    const { api, manager, v, invoked } = frameworkFixture(); api.install();
    manager._transformationAlteration();
    assert.equal(invoked.length, 5);
    for (const name of ["whale", "horse", "raven"]) assert.equal(v.maplebirch.transformation[name].level, 2);
    manager._transform("cat", 1);
    assert.equal(v.catbuild, 31);
    assert.equal(v.wolfbuild, 30);
    assert.equal(v.maplebirch.transformation.whale.build, 10);
    api.setCoexist(false);
    invoked.length = 0;
    manager._transformationAlteration();
    assert.equal(invoked.length, 1, "Original exclusive algorithm must resume");
});

test("actual framework applies opted-in natural decay once in both exclusive and coexist modes", { skip: !fs.existsSync(reference) }, () => {
    for (const coexist of [true, false]) {
        const { api, manager, v } = frameworkFixture();
        api.install(); api.setCoexist(coexist);
        // Explicit settings, independent of coexist, apply to native and added animals.
        for (const name of ["wolf", "cat", "cow", "bird", "fox", "whale", "horse", "raven"]) api.protectTransformation(name, true);
        api.protectTransformation("cat", false);
        api.protectTransformation("whale", false);
        manager._transformationStateUpdate();
        assert.equal(v.catbuild, 29, "Cat decays exactly once");
        assert.equal(v.wolfbuild, 30, "Wolf stays protected");
        assert.equal(v.maplebirch.transformation.whale.build, 9, "Added whale decays exactly once");
        assert.equal(v.maplebirch.transformation.horse.build, 10, "Horse stays protected");
        manager._transformationStateUpdate();
        assert.equal(v.catbuild, 28);
        assert.equal(v.maplebirch.transformation.whale.build, 8);
    }
});

test("actual framework keeps collar and per-animal decay exemptions, without modifying curse decay", { skip: !fs.existsSync(reference) }, () => {
    const { api, manager, v } = frameworkFixture();
    let exempt = true;
    manager.decayConditions.cat.push(() => !exempt);
    manager.decayConditions.undead = [() => true];
    let curseChanges = 0;
    manager.buildUpdaters.undead = change => { curseChanges += change; };
    api.install(); api.protectTransformation("cat", false);
    manager._transformationStateUpdate();
    assert.equal(v.catbuild, 30, "Per-animal exemption still wins");
    assert.equal(curseChanges, 0, "Coexist pass restores only requested animal decay");
    exempt = false;
    v.worn.neck = { name: "familiar collar", cursed: 1 };
    manager._transformationStateUpdate();
    assert.equal(v.catbuild, 30, "Global original collar protection still wins");
    v.worn.neck = { name: "none", cursed: 0 };
    manager._transformationStateUpdate();
    assert.equal(v.catbuild, 29);
});

test("actual framework growth and explicit negative transforms bypass the natural-decay guard", { skip: !fs.existsSync(reference) }, () => {
    const { api, manager, v } = frameworkFixture();
    api.install(); api.protectTransformation("cat", true);
    manager._transform("cat", 5);
    assert.equal(v.catbuild, 35);
    manager._transform("cat", -5);
    assert.equal(v.catbuild, 30, "An intentional negative action must still work");
    manager._transformationStateUpdate();
    assert.equal(v.catbuild, 30);
    assert.equal(v.maplebirch.transformation.horse.level, 2, "Protecting progress must not stop stage growth");
});

test("actual framework lets opted-in decline remove earned parts and invalidates appearance after losing a transformation", { skip: !fs.existsSync(reference) }, () => {
    const { api, manager, v } = frameworkFixture();
    const whale = manager.config.get("whale");
    whale.parts = [{ name: "tail", tfRequired: 6 }];
    v.maplebirch.transformation.whale = { level: 6, build: 30 };
    v.transformationParts.whale.tail = "default";
    api.install(); api.select("whale"); api.protectTransformation("whale", false);
    manager._transformationStateUpdate();
    assert.equal(v.maplebirch.transformation.whale.level, 5);
    assert.equal(v.transformationParts.whale.tail, "disabled");
    assert.equal(api.config().appearance, "whale", "A partial transformation is still owned");
    v.maplebirch.transformation.whale = { level: 1, build: 5 };
    manager._transformationStateUpdate();
    assert.equal(v.maplebirch.transformation.whale.level, 0);
    assert.equal(api.config().appearance, null);
    assert.equal(api.owned().includes("whale"), false);
});
