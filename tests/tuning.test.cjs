"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const create = require("../src/custom-tuning/scripts/tuning.js");

function fixture({ settings = false } = {}) {
    const actions = new Map();
    const hooks = new Map();
    const events = { onSec: new Map(), onDay: new Map() };
    const processCalls = [];
    const renderHooks = new Map();
    const psyche = {
        change(sanity = 0, mood = 0) {
            root.V.Psyche.sanity += sanity;
            root.V.Psyche.mood += mood;
        }
    };
    const manager = { coexistConditions: [], hooks: { update: { add(name, fn) { hooks.set(name, fn); } } } };
    const root = {
        V: {
            player: {}, wolfgirl: 6, cat: 6, cow: 0, harpy: 0, fox: 0,
            maplebirch: { transformation: { whale: { level: 6, build: 30 }, horse: { level: 0, build: 0 }, raven: { level: 4, build: 20 } } },
            transformationParts: { traits: { fangs: "default", ravenFeathers: "default", hooves: "disabled" }, cat: { ears: "default", tail: "default" } },
            Psyche: { sanity: 500, mood: 0 }, pain: 20, stress: 0
        },
        setup: { transformations: [
            { name: "cat", get level() { return root.V.cat; }, traits: [{ name: "fangs", tfRequired: 2 }] },
            { name: "horse", get level() { return root.V.maplebirch.transformation.horse.level; }, traits: [{ name: "hooves", tfRequired: 2 }] }
        ] },
        maplebirch: {
            char: {
                transformation: manager,
                processors: { pre: { add(name, fn) { renderHooks.set(name, fn); } } },
                process(stage, options, model) {
                    processCalls.push([stage, options, model]);
                    if (stage === "pre") for (const fn of renderHooks.values()) fn(options, model);
                }
            },
            dynamic: { TimeEvents: events },
            get(name) { return name === "Psyche" ? psyche : null; }
        },
        console: { info() {}, warn() {} }, document: {},
        jQuery: () => ({ on(name, fn) { actions.set(name, fn); } })
    };
    const definitions = new Map();
    if (settings) {
        root.settings = {};
        root.Setting = {
            addHeader() {},
            addToggle(name, def) { definitions.set(name, def); root.settings[name] = def.default; },
            addList(name, def) { definitions.set(name, def); root.settings[name] = def.default; },
            delete(name) { definitions.delete(name); }
        };
    }
    const api = create(root);
    return { root, api, psyche, manager, hooks, events, definitions, actions, processCalls };
}

test("nine guards are independent and never suppress positive growth", () => {
    const { api } = fixture();
    for (const name of ["purity", "beauty", "physique", "willpower", "awareness", "promiscuity", "exhibitionism", "deviancy", "sanity"]) {
        assert.equal(api.natural(name, 50, 49), 49);
        api.protect(name, true);
        assert.equal(api.natural(name, 50, 49), 50);
        assert.equal(api.natural(name, 50, 51), 51);
        assert.equal(api.amount(name, -5), 0);
        assert.equal(api.amount(name, 5), 5);
        api.protect(name, false);
    }
    assert.throws(() => api.protect("money", true));
});

test("only owned animals appear; losing selected animal falls back to none", () => {
    const { root, api } = fixture();
    assert.deepEqual(api.owned(), ["wolf", "cat", "whale", "raven"]);
    assert.throws(() => api.select("horse"));
    assert.throws(() => api.select("undead"));
    api.select("cat");
    assert.equal(api.appearanceLevel("cat"), 6);
    assert.equal(api.appearanceLevel("wolf"), 0);
    root.V.cat = 0;
    assert.equal(api.config().appearance, null);
});

test("appearance filtering leaves real levels, body parts, ability traits and progress untouched", () => {
    const { root, api } = fixture();
    api.select("cat");
    const before = JSON.stringify(root.V);
    const visible = { wolfEars: true, catEars: true, whaleTail: true, ravenWings: true, demonTail: true, traitsFangs: true };
    assert.deepEqual(api.filterVisible(visible), { catEars: true, demonTail: true, traitsFangs: true });
    const options = {
        wolf_ears_type: "default", cat_ears_type: "default", demon_tail_type: "default",
        maplebirchTransformation: root.V.maplebirch.transformation,
        transformations: { whale: { tail: { show: true } }, demon: { tail: { show: true } } }
    };
    api.filterRender(options);
    assert.equal(options.wolf_ears_type, "hidden");
    assert.equal(options.cat_ears_type, "default");
    assert.equal(options.demon_tail_type, "default");
    assert.equal(options.transformations.whale.tail.show, false);
    assert.equal(options.transformations.demon.tail.show, true);
    assert.equal(options.maplebirchTransformation.whale.level, 0);
    assert.equal(root.V.maplebirch.transformation.whale.level, 6);
    assert.equal(JSON.stringify(root.V), before);
});

test("hiding all animal appearance removes visible fang query but not the real fang ability", () => {
    const { root, api } = fixture();
    api.select(null);
    assert.deepEqual(api.filterVisible({ traitsFangs: true, catEars: true, demonTail: true }), { demonTail: true });
    assert.equal(root.V.transformationParts.traits.fangs, "default");
    api.select("cat");
    assert.equal(api.filterVisible({ traitsFangs: true }).traitsFangs, true);
});

test("registered curse consumption is blocked but event cost, mood, pain and stress effects remain", () => {
    const { root, api, psyche, events } = fixture();
    events.onSec.set("deadwood-undead-curse", {
        action() {
            root.V.pain = 0;
            root.maplebirch.get("Psyche").change(-2, 3);
            root.V.stress += 1;
        }
    });
    api.install();
    api.protect("sanity", true);
    events.onSec.get("deadwood-undead-curse").action();
    assert.equal(root.V.Psyche.sanity, 500);
    assert.equal(root.V.Psyche.mood, 3);
    assert.equal(root.V.pain, 0);
    assert.equal(root.V.stress, 1);
    psyche.change(-30, 2);
    assert.equal(root.V.Psyche.sanity, 470);
    assert.equal(root.V.Psyche.mood, 5);
    psyche.change(10);
    assert.equal(root.V.Psyche.sanity, 480);
    api.protect("sanity", false);
    events.onSec.get("deadwood-undead-curse").action();
    assert.equal(root.V.Psyche.sanity, 478);
});

test("curse callback throwing does not leave ordinary sanity events protected", () => {
    const { root, api, psyche, events } = fixture();
    events.onSec.set("deadwood-undead-curse", {
        action() { root.maplebirch.get("Psyche"); throw new Error("curse failure"); }
    });
    api.install(); api.protect("sanity", true);
    assert.throws(() => events.onSec.get("deadwood-undead-curse").action());
    psyche.change(-10);
    assert.equal(root.V.Psyche.sanity, 490);
});

test("coexist and render hooks are idempotent, can be disabled, and preserve other processors", () => {
    const { root, api, manager, processCalls } = fixture();
    api.install(); api.refresh(); api.refresh();
    assert.equal(manager.coexistConditions.length, 1);
    assert.equal(manager.coexistConditions[0](), true);
    api.select("cat");
    const options = { wolf_ears_type: "default" };
    root.maplebirch.char.process("pre", options, { name: "main" });
    assert.equal(options.wolf_ears_type, "hidden");
    assert.equal(processCalls.length, 1);
    api.setCoexist(false);
    assert.equal(manager.coexistConditions[0](), false);
    assert.equal(api.appearanceLevel("wolf"), 6);
    const next = { wolf_ears_type: "default" };
    api.filterRender(next);
    assert.equal(next.wolf_ears_type, "default");
});

test("native settings control individual guards and refresh choices after earning or losing transformations", () => {
    const { root, api, definitions } = fixture({ settings: true });
    api.install();
    assert.equal(definitions.size, 19);
    assert.deepEqual(definitions.get("dolTuningAppearance").list, ["不显示", "狼", "猫", "鲸", "渡鸦"]);
    root.settings.dolTuningGuard_beauty = true;
    definitions.get("dolTuningGuard_beauty").onChange();
    assert.equal(api.guard("beauty"), true);
    assert.equal(api.guard("willpower"), false);
    root.settings.dolTuningAppearance = "猫";
    definitions.get("dolTuningAppearance").onChange();
    assert.equal(api.config().appearance, "cat");
    root.V.cat = 0;
    root.V.maplebirch.transformation.horse.level = 1;
    api.refresh();
    assert.deepEqual(definitions.get("dolTuningAppearance").list, ["不显示", "狼", "鲸", "马", "渡鸦"]);
    assert.equal(api.config().appearance, null);
    assert.equal(root.settings.dolTuningAppearance, "不显示");
});

test("settings follow the loaded save, not stale values from the previous save", () => {
    const { root, api } = fixture({ settings: true });
    api.install(); api.protect("beauty", true); api.select("cat");
    const old = root.V;
    root.V = { ...old, DOLmodTuning: { coexist: false, appearance: null, guards: { willpower: true } } };
    api.refresh();
    assert.equal(root.settings.dolTuningGuard_beauty, false);
    assert.equal(root.settings.dolTuningGuard_willpower, true);
    assert.equal(root.settings.dolTuningCoexist, false);
    assert.equal(old.DOLmodTuning.guards.beauty, true);
});

test("settings callbacks use the current engine result after the settings object is replaced", () => {
    const { root, api, definitions } = fixture({ settings: true });
    api.install();
    root.settings = { ...root.settings, dolTuningGuard_beauty: true };
    definitions.get("dolTuningGuard_beauty").onChange({ value: true });
    assert.equal(api.guard("beauty"), true);
    root.settings.dolTuningGuard_beauty = false;
    definitions.get("dolTuningGuard_beauty").onChange({ value: false });
    assert.equal(api.guard("beauty"), false);
});

test("shared traits are repaired only when earned and disabled, not when explicitly hidden", () => {
    const { root, api, hooks } = fixture();
    api.install();
    root.V.transformationParts.traits.fangs = "disabled";
    hooks.get("dolTuning.sharedTraits")("after");
    assert.equal(root.V.transformationParts.traits.fangs, "default");
    assert.equal(root.V.transformationParts.traits.hooves, "disabled");
    root.V.transformationParts.traits.fangs = "hidden";
    api.repairSharedTraits();
    assert.equal(root.V.transformationParts.traits.fangs, "hidden");
});

test("sidebar action opens native settings without changing saved appearance or guards", () => {
    const { root, api } = fixture({ settings: true });
    let opened = 0;
    root.SugarCube = { UI: { settings() { opened++; } } };
    api.install(); api.select("cat"); api.protect("willpower", true);
    const before = JSON.stringify(root.V);
    assert.equal(api.openSettings(), true);
    assert.equal(opened, 1);
    assert.equal(JSON.stringify(root.V), before);
    assert.equal(api.openSettings(), true);
    assert.equal(opened, 2);
});

test("sidebar action reports missing settings without crashing the current passage", () => {
    const { root, api } = fixture();
    const alerts = [];
    root.alert = message => alerts.push(message);
    api.install();
    assert.equal(api.openSettings(), false);
    assert.equal(alerts.length, 1);
    assert.ok(api.status().warnings.length > 0);
});

test("migration preserves all old guards and appearance and defaults decay to the previous coexist mode", () => {
    for (const coexist of [true, false]) {
        const { root, api } = fixture();
        root.V.DOLmodTuning = { version: 1, coexist, appearance: "cat", guards: { willpower: true } };
        const c = api.config();
        assert.equal(c.version, 2);
        assert.equal(c.appearance, "cat");
        assert.equal(c.guards.willpower, true);
        for (const name of ["wolf", "cat", "cow", "bird", "fox", "whale", "horse", "raven"]) {
            assert.equal(api.transformationGuard(name), coexist);
        }
    }
});

test("animal decay protection is independent, persisted, and can be set through native controls", () => {
    const { root, api, definitions } = fixture({ settings: true });
    api.install();
    assert.equal(api.transformationGuard("cat"), true);
    root.settings.dolTuningTransformationGuard_cat = false;
    definitions.get("dolTuningTransformationGuard_cat").onChange({ value: false });
    assert.equal(api.transformationGuard("cat"), false);
    assert.equal(api.transformationGuard("wolf"), true);
    api.protectTransformation("wolf", false);
    assert.equal(root.settings.dolTuningTransformationGuard_wolf, false);
    api.protectTransformation("cat", true);
    assert.equal(root.V.DOLmodTuning.transformationGuards.cat, true);
    assert.equal(api.guard("willpower"), false);
    assert.throws(() => api.protectTransformation("angel", true));
    assert.throws(() => api.protectTransformation("undead", true));
    assert.throws(() => api.protectTransformation("cat", 1));
});

test("decay gates retain original protections and are not duplicated by refresh", () => {
    const { api, manager } = fixture();
    const native = () => true;
    const original = Object.freeze([native]);
    manager.decayConditions = { cat: original };
    manager._transform = () => {};
    api.install(); api.refresh(); api.refresh();
    assert.equal(manager.decayConditions.cat.length, 2);
    assert.equal(original.length, 1);
    assert.equal(manager.decayConditions.cat[0], native);
    assert.equal(manager.decayConditions.cat.every(fn => fn()), false);
    api.protectTransformation("cat", false);
    assert.equal(manager.decayConditions.cat.every(fn => fn()), true);
});
