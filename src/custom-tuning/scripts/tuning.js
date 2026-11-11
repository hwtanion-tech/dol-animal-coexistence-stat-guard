/* DoL 0.5.12.13 + maplebirch 5.6.2. Experimental, explicit-source patches only. */
(function (root, factory) {
    "use strict";
    const create = factory();
    if (typeof module === "object" && module.exports) module.exports = create;
    else create(root).install();
})(typeof window === "object" ? window : globalThis, function () {
    "use strict";
    const VERSION = "0.2.0";
    const ANIMALS = Object.freeze({
        wolf: "狼", cat: "猫", cow: "牛", bird: "鹰身", fox: "狐",
        whale: "鲸", horse: "马", raven: "渡鸦"
    });
    const LEVELS = { wolf: "wolfgirl", cat: "cat", cow: "cow", bird: "harpy", fox: "fox" };
    const STATS = Object.freeze({
        purity: "纯洁", beauty: "容貌", physique: "体能", willpower: "意志力",
        awareness: "意识", promiscuity: "淫乱", exhibitionism: "暴露癖", deviancy: "异种癖", sanity: "理智"
    });

    return function create(root) {
        const warnings = new Set();
        const protectedSources = new Set();
        let installed = false;
        let renderInstalled = false;
        let coexistInstalled = false;
        let traitHookInstalled = false;
        let transformationDecayInstalled = false;
        let nativeSettingsInstalled = false;
        let lastChoices = "";
        const wrappedEvents = new WeakSet();
        let naturalSanityDepth = 0;
        const decayGates = new Map();

        function variables() { return root.V || root.SugarCube?.State?.variables || {}; }
        function setupObject() { return root.setup || root.SugarCube?.setup || {}; }
        function config() {
            const v = variables();
            if (!v.player) return { coexist: false, appearance: null, guards: {}, transformationGuards: {} };
            const c = v.DOLmodTuning ??= { version: 1, coexist: true, appearance: null, guards: {} };
            c.guards ??= {};
            // Preserve the previous version's decay behaviour on migration:
            // coexist ON used to skip all decay, coexist OFF used native decay.
            if (!c.transformationGuards || typeof c.transformationGuards !== "object") {
                c.transformationGuards = Object.fromEntries(Object.keys(ANIMALS).map(name => [name, c.coexist === true]));
            }
            c.version = 2;
            if (!Object.hasOwn(ANIMALS, c.appearance)) c.appearance = null;
            if (c.appearance && level(c.appearance) <= 0) c.appearance = null;
            return c;
        }
        function level(name) {
            const v = variables();
            return Number(LEVELS[name] ? v[LEVELS[name]] : v.maplebirch?.transformation?.[name]?.level) || 0;
        }
        function owned() { return Object.keys(ANIMALS).filter(name => level(name) > 0); }
        function guard(name) { return config().guards[name] === true; }
        function natural(name, before, proposed) {
            protectedSources.add(name);
            return guard(name) && Number.isFinite(before) && proposed < before ? before : proposed;
        }
        function amount(name, value) {
            protectedSources.add(name);
            return guard(name) && value < 0 ? 0 : value;
        }
        function appearanceLevel(name) {
            const c = config();
            return !c.coexist || c.appearance === name ? level(name) : 0;
        }
        function select(name) {
            if (name !== null && (!Object.hasOwn(ANIMALS, name) || level(name) <= 0)) {
                throw new Error("只能选择当前已拥有的动物转化，或 null（不显示）。");
            }
            config().appearance = name;
            syncSettings();
            return name;
        }
        function protect(name, enabled = true) {
            if (!Object.hasOwn(STATS, name)) throw new Error("未知属性：" + name);
            if (typeof enabled !== "boolean") throw new Error("开关必须为 true 或 false。");
            config().guards[name] = enabled;
            syncSettings();
            return enabled;
        }
        function transformationGuard(name) { return config().transformationGuards[name] === true; }
        function protectTransformation(name, enabled = true) {
            if (!Object.hasOwn(ANIMALS, name)) throw new Error("未知动物转化：" + name);
            if (typeof enabled !== "boolean") throw new Error("开关必须为 true 或 false。");
            config().transformationGuards[name] = enabled;
            syncSettings();
            return enabled;
        }

        function installDecayGates(manager) {
            if (!manager.decayConditions || typeof manager.decayConditions !== "object") return;
            for (const name of Object.keys(ANIMALS)) {
                const conditions = manager.decayConditions[name];
                if (!Array.isArray(conditions)) continue;
                if (!decayGates.has(name)) decayGates.set(name, () => !transformationGuard(name));
                const gate = decayGates.get(name);
                if (!conditions.includes(gate)) {
                    // Keep all native conditions (collars, pregnancy, etc.). Copy
                    // rather than mutate the framework's shared default arrays.
                    manager.decayConditions[name] = [...conditions, gate];
                }
            }
        }

        function installTransformationDecay(manager) {
            if (!manager.decayConditions || !manager.hooks?.update?.add || typeof manager._transform !== "function") return;
            installDecayGates(manager);
            if (transformationDecayInstalled) return;
            manager.hooks.update.add("dolTuning.animalNaturalDecay", stage => {
                if (stage === "before") installDecayGates(manager);
                if (stage !== "alter" || !manager.coexist) return;
                if (manager.protectConditions?.some(condition => condition())) return;
                // In exclusive mode the framework already runs these gated
                // conditions once. In coexist mode it skips that entire pass;
                // restore only opted-in animal decay here, before level updates.
                for (const name of Object.keys(ANIMALS)) {
                    const conditions = manager.decayConditions[name];
                    if (Array.isArray(conditions) && conditions.every(condition => condition())) {
                        manager._transform(name, -1);
                    }
                }
            }, 1000000);
            transformationDecayInstalled = true;
        }
        function filterVisible(parts) {
            const c = config();
            if (!c.coexist) return parts;
            const animalTraits = new Set();
            const visibleTraits = new Set();
            for (const tf of setupObject().transformations || []) {
                const animal = Object.hasOwn(ANIMALS, tf.name);
                for (const trait of tf.traits || []) {
                    if (animal) animalTraits.add(trait.name);
                    if ((tf.name === c.appearance || !animal) && tf.level >= trait.tfRequired) visibleTraits.add(trait.name);
                }
            }
            return Object.fromEntries(Object.entries(parts).filter(([key]) => {
                if (/^traits[A-Z]/.test(key)) {
                    const part = key[6].toLowerCase() + key.slice(7);
                    if (animalTraits.has(part)) return visibleTraits.has(part);
                }
                const owner = Object.keys(ANIMALS).find(name => key.startsWith(name) && /^[A-Z]/.test(key.slice(name.length)));
                return !owner || owner === c.appearance;
            }));
        }

        function repairSharedTraits() {
            if (!config().coexist) return;
            const traits = variables().transformationParts?.traits;
            if (!traits) return;
            const earned = new Map();
            for (const tf of setupObject().transformations || []) {
                for (const trait of tf.traits || []) {
                    if (tf.level >= trait.tfRequired) earned.set(trait.name, trait.default || "default");
                }
            }
            // Native animal widgets can disable a shared fang/eye trait while a
            // different animal still owns it. Repair only erroneous "disabled";
            // do not override explicit player choices or grant unearned traits.
            for (const [name, value] of earned) {
                if (traits[name] === "disabled") traits[name] = value;
            }
        }

        // Only renderer-local options are changed. Never change real transformation
        // levels, progress, V.transformationParts or its ability traits for appearance.
        function filterRender(options) {
            const c = config();
            if (!c.coexist || !options) return options;
            const hidden = Object.keys(ANIMALS).filter(name => name !== c.appearance);
            for (const name of hidden) {
                for (const key of Object.keys(options)) {
                    if (key.startsWith(name + "_") && key.endsWith("_type")) options[key] = "hidden";
                }
            }
            if (options.transformations && typeof options.transformations === "object") {
                const projected = { ...options.transformations };
                for (const name of hidden) {
                    if (!projected[name]) continue;
                    projected[name] = Object.fromEntries(Object.entries(projected[name]).map(([part, data]) => [
                        part, data && typeof data === "object" ? { ...data, show: false } : data
                    ]));
                }
                options.transformations = projected;
            }
            if (options.maplebirchTransformation && typeof options.maplebirchTransformation === "object") {
                const projected = { ...options.maplebirchTransformation };
                for (const name of hidden) {
                    if (projected[name]) projected[name] = { ...projected[name], level: 0, build: 0 };
                }
                options.maplebirchTransformation = projected;
            }
            // These are render-only chimera flags. Hidden horse/raven must not
            // suppress the visible divine tail/wings via a mixed-species layer.
            if (c.appearance !== "horse") options.horse_demon_tail = false;
            if (c.appearance !== "raven") options.raven_wings = "";
            return options;
        }

        function warn(message) {
            if (warnings.has(message)) return;
            warnings.add(message);
            root.console?.warn("[Animal Stat Tuning] " + message);
        }
        function framework() { return root.maplebirch; }
        function wrapPsyche() {
            const psyche = framework()?.get?.("Psyche");
            if (!psyche || typeof psyche.change !== "function") return;
            if (psyche.change.__dolTuning) return;
            const original = psyche.change;
            const wrapper = function (sanity = 0, mood = 0) {
                // Only inside an identified automatic status callback; ordinary
                // <<sanity -N>> events are deliberately left alone.
                if (naturalSanityDepth > 0 && guard("sanity") && sanity < 0) sanity = 0;
                return original.call(this, sanity, mood);
            };
            Object.defineProperty(wrapper, "__dolTuning", { value: true });
            psyche.change = wrapper;
        }
        function wrapNaturalEvents() {
            const events = framework()?.dynamic?.TimeEvents;
            if (!events) return;
            for (const [unit, registry] of Object.entries(events)) {
                if (!["onSec", "onMin", "onHour", "onDay"].includes(unit)) continue;
                const entries = registry instanceof Map ? [...registry.entries()] : Object.entries(registry || {});
                for (const [id, event] of entries) {
                    if (!event || typeof event.action !== "function" || wrappedEvents.has(event)) continue;
                    // Exact verified persistent curse timer, not every time-related
                    // event (some timers resolve intentional choices/costs).
                    if (id !== "deadwood-undead-curse") continue;
                    const source = Function.prototype.toString.call(event.action);
                    if (!source.includes('"Psyche"') && !source.includes("'Psyche'")) {
                        warn("亡灵理智计时器实现与已核实版本不同，未安装该保护。");
                        continue;
                    }
                    const original = event.action;
                    event.action = function (...args) {
                        naturalSanityDepth++;
                        try { return original.apply(this, args); }
                        finally { naturalSanityDepth--; }
                    };
                    wrappedEvents.add(event);
                    protectedSources.add("sanity");
                }
            }
        }
        function installCoexist() {
            const manager = framework()?.char?.transformation;
            if (!manager || !Array.isArray(manager.coexistConditions)) return;
            if (!coexistInstalled) {
                manager.coexistConditions.push(() => config().coexist === true);
                coexistInstalled = true;
            }
            installTransformationDecay(manager);
            if (!traitHookInstalled && manager.hooks?.update?.add) {
                manager.hooks.update.add("dolTuning.sharedTraits", stage => {
                    if (stage === "after") repairSharedTraits();
                }, 100);
                traitHookInstalled = true;
            }
            const character = framework().char;
            if (!renderInstalled && character.processors?.pre?.add) {
                // CanvasModel captured a bound process function during startup;
                // register with the shared hook registry rather than replacing it.
                character.processors.pre.add("dolTuning.appearance", (options, model, prepare) => {
                    if (typeof prepare === "function") prepare();
                    if (model?.name === "main" || model?.name === "combatMainPc") filterRender(options);
                }, 1000000);
                renderInstalled = true;
            }
        }

        function settingAPI() {
            return root.Setting || root.SugarCube?.Setting || (typeof Setting !== "undefined" ? Setting : null);
        }
        function settingValues() {
            return root.settings || root.SugarCube?.settings || (typeof settings !== "undefined" ? settings : null);
        }
        function syncSettings() {
            const S = settingAPI();
            const values = settingValues();
            if (!S || !values || !variables().player) return;
            const c = config();
            if (!nativeSettingsInstalled) {
                if (typeof S.addHeader === "function") S.addHeader("动物共存与属性保护（实验版）",
                    "配置随当前存档保存。仅阻止已适配的自然下降；事件扣除仍生效。切换外观后刷新场景生效。意识暂未发现自然下降入口。");
                S.addToggle("dolTuningCoexist", {
                    label: "允许动物转化共存", default: true,
                    onChange(event) { config().coexist = (event?.value ?? settingValues()?.dolTuningCoexist) === true; }
                });
                for (const [name, label] of Object.entries(STATS)) {
                    S.addToggle("dolTuningGuard_" + name, {
                        label: "防自然衰减：" + label + (name === "awareness" ? "（预留，无已确认衰减入口）" : name === "sanity" ? "（已适配亡灵持续消耗）" : ""),
                        default: false,
                        onChange(event) { config().guards[name] = (event?.value ?? settingValues()?.["dolTuningGuard_" + name]) === true; }
                    });
                }
                if (typeof S.addHeader === "function") S.addHeader("动物转化点数保护",
                    "开启：只阻止该转化的自然点数衰减，仍可增长。关闭：按原有条件自然衰减，即使共存开启也生效。项圈等原有保护及剧情主动扣除不变；掉点可能使阶段、部位和能力降低。");
                for (const [name, label] of Object.entries(ANIMALS)) {
                    S.addToggle("dolTuningTransformationGuard_" + name, {
                        label: "防自然衰减：" + label + "转化点数",
                        default: c.transformationGuards[name] === true,
                        onChange(event) {
                            config().transformationGuards[name] = (event?.value ?? settingValues()?.["dolTuningTransformationGuard_" + name]) === true;
                        }
                    });
                }
                nativeSettingsInstalled = true;
            }
            values.dolTuningCoexist = c.coexist;
            for (const name of Object.keys(STATS)) values["dolTuningGuard_" + name] = c.guards[name] === true;
            for (const name of Object.keys(ANIMALS)) values["dolTuningTransformationGuard_" + name] = c.transformationGuards[name] === true;
            const choices = ["不显示", ...owned().map(name => ANIMALS[name])];
            const signature = JSON.stringify(choices);
            if (signature !== lastChoices) {
                if (lastChoices && typeof S.delete === "function") S.delete("dolTuningAppearance");
                else if (lastChoices) { warn("设置接口无法更新外观列表，请使用控制台 select 接口。"); return; }
                S.addList("dolTuningAppearance", {
                    label: "动物外观（仅列出当前拥有的转化）", list: choices, default: "不显示",
                    onChange(event) {
                        const choice = event?.value ?? settingValues()?.dolTuningAppearance;
                        const name = Object.keys(ANIMALS).find(name => ANIMALS[name] === choice);
                        select(name || null);
                    }
                });
                lastChoices = signature;
            }
            values.dolTuningAppearance = c.appearance ? ANIMALS[c.appearance] : "不显示";
        }

        function refresh() {
            if (!variables().player) return;
            config();
            installCoexist();
            wrapPsyche();
            wrapNaturalEvents();
            syncSettings();
        }
        function openSettings() {
            // Reuse the engine's existing window and controls; do not navigate
            // passages or alter the user's current choices just to open it.
            refresh();
            const ui = root.SugarCube?.UI || root.UI || (typeof UI !== "undefined" ? UI : null);
            if (!nativeSettingsInstalled || typeof ui?.settings !== "function") {
                const message = "转化与属性设置暂时无法打开，请先进入存档；若仍失败，请反馈当前页面的报错。";
                warn(message);
                if (typeof root.alert === "function") root.alert(message);
                return false;
            }
            ui.settings();
            return true;
        }
        function status() {
            return {
                version: VERSION,
                config: JSON.parse(JSON.stringify(config())),
                owned: owned(), coexistInstalled, renderInstalled, nativeSettingsInstalled, transformationDecayInstalled,
                matchedNaturalSources: [...protectedSources], warnings: [...warnings],
                limitations: [
                    "意识未找到已确认的自然下降入口，其开关为预留。",
                    "理智仅保护已核实的亡灵持续消耗，不保护事件扣除。",
                    "外观按已适配的立绘及 checkTFparts 查询过滤；非标准立绘、混合部件和其他直接等级对话尚需游戏内验证。"
                ]
            };
        }
        function install() {
            if (installed || root.DOLmodTuning) return;
            installed = true;
            root.DOLmodTuning = api;
            if (typeof root.jQuery === "function") {
                root.jQuery(root.document).on(":storyready.dolTuning :passagestart.dolTuning :passageend.dolTuning", refresh);
            }
            refresh();
            root.console?.info("[Animal Stat Tuning] 实验版 " + VERSION + " 已加载。先备份存档；可点击侧栏“转化与属性设置”，亦可调用 DOLmodTuning.status()。");
        }
        const api = Object.freeze({
            version: VERSION, install, refresh, openSettings, status, config, owned, level,
            natural, amount, guard, protect, select, appearanceLevel, filterVisible, filterRender, repairSharedTraits,
            transformationGuard, protectTransformation,
            setCoexist(enabled) {
                if (typeof enabled !== "boolean") throw new Error("开关必须为 true 或 false。");
                config().coexist = enabled;
                syncSettings();
            }
        });
        return api;
    };
});
