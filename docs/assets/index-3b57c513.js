const styles = "";
let batchQueue = null;
let batchDepth = 0;
function startBatch() {
  if (batchDepth === 0) {
    batchQueue = [];
  }
  batchDepth++;
}
function finishBatch() {
  batchDepth--;
  if (batchDepth > 0) {
    return;
  }
  batchDepth++;
  const prev = Listener;
  try {
    for (let i = 0; i < batchQueue.length; i++) {
      const node = batchQueue[i];
      Listener = node.isStatic ? null : node;
      node.fn();
      node.needUpdate = false;
    }
  } finally {
    Listener = prev;
    batchQueue = null;
    batchDepth = 0;
  }
}
let Listener = null;
function readNode() {
  if (Listener) {
    Listener.sources.push(this, this.observers.length);
    this.observers.push(Listener);
  }
  return this.value;
}
function notifyNode(node) {
  const obs = node.observers;
  const length = obs.length;
  if (length === 0) {
    return;
  }
  startBatch();
  for (let i = 0; i < length; i++) {
    obs[i].notify();
  }
  finishBatch();
}
function writeNode(newVal) {
  if (newVal !== this.value) {
    this.value = newVal;
    notifyNode(this);
  }
}
function updateNode(node) {
  const prev = Listener;
  Listener = node.isStatic ? null : node;
  try {
    const newVal = node.fn();
    node.needUpdate = false;
    return newVal;
  } finally {
    Listener = prev;
  }
}
function cleanupNode(node, destroy = false) {
  const length = node.sources.length;
  for (let i = 0; i < length; i += 2) {
    const source = node.sources[i];
    const sourceSlot = node.sources[i + 1];
    const observers = source.observers;
    const obs = observers.pop();
    if (sourceSlot < observers.length) {
      observers[sourceSlot] = obs;
    }
  }
  if (destroy) {
    node.sources = null;
    return;
  }
  if (length > 0) {
    node.sources.splice(0);
  }
}
function createNode(value, fn, name) {
  return {
    name,
    fn,
    needUpdate: false,
    value,
    notify: void 0,
    observers: void 0,
    sources: void 0,
    isStatic: false
  };
}
function signal(initial, name = null) {
  const node = createNode(initial, void 0, name);
  node.observers = [];
  return [readNode.bind(node), writeNode.bind(node)];
}
function voidSignal(name = null) {
  const node = createNode(void 0, void 0, name);
  node.observers = [];
  return [
    (value) => (readNode.call(node), value),
    () => notifyNode(node)
  ];
}
function notifyEffect() {
  if (this.needUpdate) {
    return;
  }
  this.needUpdate = true;
  if (batchQueue) {
    batchQueue.push(this);
  } else {
    updateNode(this);
  }
}
function destroyEffect() {
  if (!this.sources) {
    return;
  }
  cleanupNode(this, true);
}
function untrack(fn) {
  if (Listener === null) {
    return fn();
  }
  const prev = Listener;
  Listener = null;
  try {
    return fn();
  } finally {
    Listener = prev;
  }
}
function createSubscribeEffect(fn, name, once) {
  const node = createNode(void 0, fn, name);
  if (once) {
    node.fn = function() {
      fn();
      destroyEffect();
    };
  }
  node.sources = [];
  node.notify = notifyEffect;
  return node;
}
function subscribe(getters, fn, options = {}) {
  let node;
  let defer = options.defer;
  const name = options.name || null;
  const once = options.once && defer;
  if (Array.isArray(getters)) {
    node = createSubscribeEffect(function() {
      const length = getters.length;
      const values = Array(length);
      for (let i = 0; i < length; i++) {
        values[i] = getters[i]();
      }
      Listener = null;
      if (!defer) {
        fn.apply(null, values);
      }
    }, name, once);
  } else {
    node = createSubscribeEffect(function() {
      const value = getters();
      Listener = null;
      if (!defer) {
        fn(value);
      }
    }, name, once);
  }
  updateNode(node);
  defer = false;
  node.isStatic = true;
  return destroyEffect.bind(node);
}
function readMemo() {
  if (this.needUpdate) {
    const newVal = updateNode(this);
    writeNode.call(this, newVal);
  }
  return readNode.call(this);
}
function readMemoUntracked() {
  if (this.needUpdate) {
    const newVal = updateNode(this);
    writeNode.call(this, newVal);
  }
  return this.value;
}
function notifyMemo() {
  if (this.needUpdate) {
    return;
  }
  this.needUpdate = true;
  notifyNode(this);
}
function memo(fn, options = {}) {
  let node;
  const name = options.name || null;
  if (options.isStatic) {
    node = createNode(NaN, function() {
      if (!node.isStatic) {
        node.isStatic = true;
      }
      return fn();
    }, name);
  } else {
    node = createNode(NaN, function() {
      cleanupNode(node);
      return fn();
    }, name);
  }
  node.observers = [];
  node.sources = [];
  node.notify = notifyMemo;
  node.needUpdate = true;
  return options.untracked ? readMemoUntracked.bind(node) : readMemo.bind(node);
}
function sMemo(fn) {
  return memo(fn, { isStatic: true, untracked: true });
}
function render(app, el, props = void 0) {
  el.replaceWith(app(props));
}
function h(type, props = null, children = null) {
  if (typeof type === "function") {
    const componentProps = children ? Object.assign({ children }, props || {}) : props;
    return type(componentProps);
  }
  const el = type === "" ? document.createDocumentFragment() : document.createElement(type);
  for (let prop in props) {
    const value = props[prop];
    if (prop === "on") {
      for (let eventType in value) {
        el.addEventListener(eventType, value[eventType]);
      }
      continue;
    }
    if (prop === "ref") {
      value(el);
      continue;
    }
    if (prop === "show") {
      $bindShow(el, value);
      continue;
    }
    if (prop === "style" && typeof value === "object" && value !== null) {
      $bindStyle(el, value);
      continue;
    }
    if (prop === "classList") {
      $bindClassList(el, value);
      continue;
    }
    if (value === void 0) {
      continue;
    }
    if (prop === "innerHTML") {
      typeof value === "function" ? $bindAttrDirect(el, prop, value) : el.innerHTML = value;
      continue;
    }
    typeof value === "function" ? $bindAttr(el, prop, value) : el.setAttribute(prop, value);
  }
  if (children) {
    const length = children.length;
    for (let i = 0; i < length; i++) {
      let child = children[i];
      if (typeof child === "function") {
        const getter = child;
        child = document.createTextNode("");
        $bindText(child, getter);
      } else if (typeof child !== "object") {
        if (typeof child !== "string") {
          child = child.toString();
        }
        child = document.createTextNode(child);
      }
      el.appendChild(child);
    }
  }
  return el;
}
function $bindText(el, getter) {
  subscribe(getter, function(value) {
    el.nodeValue = value;
  });
}
function $bindAttr(el, attrName, getter) {
  subscribe(getter, function(value) {
    if (value === void 0) {
      el.removeAttribute(attrName);
    } else {
      el.setAttribute(attrName, value);
    }
  });
}
function $bindAttrDirect(el, attrName, getter) {
  subscribe(getter, function(value) {
    el[attrName] = value;
  });
}
function $bindClassList(el, classList) {
  for (const className in classList) {
    const hasClass = classList[className];
    const applyClass = function(hasClass2) {
      if (hasClass2) {
        el.classList.add(className);
      } else {
        el.classList.remove(className);
      }
    };
    typeof hasClass === "function" ? subscribe(hasClass, applyClass) : applyClass(hasClass);
  }
}
function $bindShow(el, getter) {
  const applyStyle = function(isShow) {
    el.style.display = isShow ? "" : "none";
  };
  typeof getter === "function" ? subscribe(getter, applyStyle) : applyStyle(getter);
}
function $bindStyle(el, styles2) {
  for (const propName in styles2) {
    const value = styles2[propName];
    const applyStyle = propName.startsWith("--") ? function(value2) {
      el.style.setProperty(propName, value2);
    } : function(value2) {
      el.style[propName] = value2;
    };
    typeof value === "function" ? subscribe(value, applyStyle) : applyStyle(value);
  }
}
const OR = "OR";
const AND = "AND";
const NO = "NO";
const Color = [
  void 0,
  // 0
  "#17933c",
  // unit - green
  "#5174ff",
  // worker - blue
  "#2a45b1",
  // '#5174ff', // economy (gas) - blue
  "#2a45b1",
  // '#5174ff', // resource center - dark blue
  "#9097a0",
  // supply - ...
  "#a349a4",
  // production - pink
  "#ffd700",
  // tech structure - yellow
  "#ffd700",
  // addon - yellow
  "#00ac8c",
  // #b90d28 // defence - cyan
  "#ff7f27"
  // upgrade - orange
];
const DragMode = {
  Single: 1,
  // drag single item
  Multiple: 2,
  // drag multiple items
  SingleWithSecondary: 3,
  // drag single item with secondary column
  MultipleWithSecondary: 4,
  // drag multiple items with secondary column
  Column: 5
  // drag only column
};
const Category = {
  UNIT: 1,
  // army
  WORKER: 2,
  // economy
  ECONOMY: 3,
  // economy
  RESOURCE_CENTER: 4,
  // economy
  SUPPLY: 5,
  PRODUCTION: 6,
  TECH_STRUCTURE: 7,
  ADDON: 8,
  DEFENCE: 9,
  UPGRADE: 10
};
const BuildType = {
  NoWorker: 0,
  WorkerBuild: 1,
  WorkerMorph: 2
};
const ButtonCategories = [
  {
    title: "Экономика",
    categories: [Category.RESOURCE_CENTER, Category.WORKER, Category.ECONOMY]
  },
  {
    title: "Юниты",
    categories: [Category.UNIT]
  },
  {
    title: "Строения",
    categories: [Category.PRODUCTION, Category.TECH_STRUCTURE, Category.SUPPLY, Category.DEFENCE]
  },
  {
    title: "Улучшения",
    categories: [Category.UPGRADE]
  },
  {
    title: "Пристройки",
    categories: [Category.ADDON]
  }
];
const EMPTY = "EMPTY";
const COL_PRIMARY = "COL_PRIMARY";
const COL_SECONDARY = "COL_SECONDARY";
const STRUCTURES = [
  OR,
  Category.ECONOMY,
  Category.RESOURCE_CENTER,
  Category.SUPPLY,
  Category.PRODUCTION,
  Category.TECH_STRUCTURE,
  Category.DEFENCE
];
const UnitsData = {
  Terran: [
    // economy
    {
      name: "Command center",
      icon: "building-terran-commandcenter.png",
      category: Category.RESOURCE_CENTER,
      requirement: [AND, [NO, STRUCTURES], COL_PRIMARY],
      buildTime: 71,
      mineralCost: 400,
      provideSupply: 15,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "SCV",
      icon: "unit-terran-scv.png",
      category: Category.WORKER,
      requirement: "Command center",
      buildTime: 12,
      mineralCost: 50,
      supply: 1,
      mineralIncome: 60,
      gasIncome: "?"
      // 60 минералов в минуту, 1 минерал в секунду
    },
    {
      name: "Refinery",
      icon: "building-terran-refinery.png",
      category: Category.ECONOMY,
      requirement: [OR, EMPTY, "Refinery"],
      buildTime: 21,
      mineralCost: 75,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "MULE",
      icon: "unit-terran-mule.png",
      category: Category.ECONOMY,
      requirement: "Orbital station",
      visible: [AND, "Command center", [NO, "Planetary fortress"]],
      buildTime: 0,
      mineralCost: 0,
      mineralIncome: 225,
      lifeTime: 60,
      buildTime: 60
      /* buildTime - time to next mule */
      /* actually lifetime is 64 but we tweak it so we have pretty numbers */
    },
    // extra-supply
    // scan
    {
      name: "Orbital station",
      icon: "building-terran-orbitalstation.png",
      category: Category.ECONOMY,
      requirement: [AND, "Command center", [NO, "Orbital station"], [NO, "Planetary fortress"]],
      buildTime: 25,
      mineralCost: 150
    },
    {
      name: "Planetary fortress",
      icon: "building-terran-planetaryfortress.png",
      category: Category.ECONOMY,
      requirement: [AND, "Command center", [NO, "Orbital station"], [NO, "Planetary fortress"]],
      buildTime: 36,
      mineralCost: 150,
      gasCost: 150
    },
    // structures
    {
      name: "Barracks",
      icon: "building-terran-barracks.png",
      category: Category.PRODUCTION,
      requirement: [AND, [NO, STRUCTURES], COL_PRIMARY],
      buildTime: 46,
      mineralCost: 150,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Factory",
      icon: "building-terran-factory.png",
      category: Category.PRODUCTION,
      requirement: [AND, [NO, STRUCTURES], COL_PRIMARY],
      buildTime: 43,
      mineralCost: 150,
      gasCost: 100,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Starport",
      icon: "building-terran-starport.png",
      category: Category.PRODUCTION,
      requirement: [AND, [NO, STRUCTURES], COL_PRIMARY],
      buildTime: 36,
      mineralCost: 150,
      gasCost: 100,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Engineering bay",
      icon: "building-terran-engineeringbay.png",
      category: Category.TECH_STRUCTURE,
      requirement: [AND, [NO, STRUCTURES], COL_PRIMARY],
      buildTime: 25,
      mineralCost: 125,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Armory",
      icon: "building-terran-armory.png",
      category: Category.TECH_STRUCTURE,
      requirement: [AND, [NO, STRUCTURES], COL_PRIMARY],
      buildTime: 46,
      mineralCost: 150,
      gasCost: 100,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Ghost academy",
      icon: "building-terran-ghostacademy.png",
      category: Category.TECH_STRUCTURE,
      requirement: [AND, [NO, STRUCTURES], COL_PRIMARY],
      buildTime: 29,
      mineralCost: 150,
      gasCost: 50,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Fusion core",
      icon: "building-terran-fusioncore.png",
      category: Category.TECH_STRUCTURE,
      requirement: [AND, [NO, STRUCTURES], COL_PRIMARY],
      buildTime: 46,
      mineralCost: 150,
      gasCost: 150,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Supply depot",
      icon: "building-terran-supplydepot.png",
      category: Category.SUPPLY,
      requirement: [OR, EMPTY, "Supply depot"],
      buildTime: 21,
      mineralCost: 100,
      provideSupply: 8,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Bunker",
      icon: "building-terran-bunker.png",
      category: Category.DEFENCE,
      requirement: [OR, EMPTY, "Bunker"],
      buildTime: 29,
      mineralCost: 100,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Missile turret",
      icon: "building-terran-missileturret.png",
      category: Category.DEFENCE,
      requirement: [OR, EMPTY, "Missile turret"],
      buildTime: 18,
      mineralCost: 100,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Sensor tower",
      icon: "building-terran-sensordome.png",
      category: Category.DEFENCE,
      requirement: [OR, EMPTY, "Sensor tower"],
      buildTime: 18,
      mineralCost: 125,
      gasCost: 100,
      buildType: BuildType.WorkerBuild
    },
    {
      name: "Techlab",
      icon: "building-terran-techlab.png",
      isWide: true,
      category: Category.ADDON,
      requirement: [AND, Category.PRODUCTION, [NO, Category.ADDON]],
      buildTime: 18,
      mineralCost: 50,
      gasCost: 25
    },
    {
      name: "Reactor",
      icon: "building-terran-reactor.png",
      isWide: true,
      category: Category.ADDON,
      requirement: [AND, Category.PRODUCTION, [NO, Category.ADDON]],
      buildTime: 36,
      mineralCost: 50,
      gasCost: 50
    },
    {
      name: "Lift",
      icon: "ability-terran-liftoff.png",
      isWide: true,
      category: Category.ADDON,
      requirement: Category.ADDON,
      visible: Category.PRODUCTION,
      buildTime: 5
    },
    // units
    {
      name: "Marine",
      icon: "unit-terran-marine.png",
      category: Category.UNIT,
      requirement: [AND, "Barracks", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 18,
      mineralCost: 50,
      supply: 1
    },
    {
      name: "Reaper",
      icon: "unit-terran-reaper.png",
      category: Category.UNIT,
      requirement: [AND, "Barracks", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 32,
      mineralCost: 50,
      gasCost: 50,
      supply: 1
    },
    {
      name: "Marauder",
      icon: "unit-terran-marauder.png",
      category: Category.UNIT,
      requirement: [AND, "Barracks", "Techlab", COL_PRIMARY],
      visible: [AND, "Barracks", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 21,
      mineralCost: 100,
      gasCost: 25,
      supply: 2
    },
    {
      name: "Ghost",
      icon: "unit-terran-ghost.png",
      category: Category.UNIT,
      requirement: [AND, "Barracks", "Techlab", COL_PRIMARY],
      visible: [AND, "Barracks", [OR, COL_PRIMARY, "Reactor"]],
      // globalReq: 'Ghost academy',
      buildTime: 29,
      mineralCost: 150,
      gasCost: 125,
      supply: 2
    },
    {
      name: "Hellion",
      icon: "unit-terran-hellion.png",
      category: Category.UNIT,
      requirement: [AND, "Factory", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 21,
      mineralCost: 100,
      supply: 2
    },
    {
      name: "Widow mine",
      icon: "unit-terran-widowmine.png",
      category: Category.UNIT,
      requirement: [AND, "Factory", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 21,
      mineralCost: 75,
      gasCost: 25,
      supply: 2
    },
    {
      name: "Cyclone",
      icon: "unit-terran-cyclone.png",
      category: Category.UNIT,
      requirement: [AND, "Factory", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 32,
      mineralCost: 125,
      gasCost: 50,
      supply: 2
    },
    {
      name: "Siege tank",
      icon: "unit-terran-siegetank.png",
      category: Category.UNIT,
      requirement: [AND, "Factory", "Techlab", COL_PRIMARY],
      visible: [AND, "Factory", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 32,
      mineralCost: 150,
      gasCost: 125,
      supply: 3
    },
    {
      name: "Hellion",
      icon: "unit-terran-hellionbattlemode.png",
      category: Category.UNIT,
      requirement: [AND, "Factory", [OR, COL_PRIMARY, "Reactor"]],
      // globalReq: 'Armory',
      buildTime: 21,
      mineralCost: 100,
      supply: 2
    },
    {
      name: "Thor",
      icon: "unit-terran-thor.png",
      category: Category.UNIT,
      requirement: [AND, "Factory", "Techlab", COL_PRIMARY],
      visible: [AND, "Factory", [OR, COL_PRIMARY, "Reactor"]],
      // globalReq: 'Armory',
      buildTime: 42,
      mineralCost: 300,
      gasCost: 200,
      supply: 6
    },
    {
      name: "Viking",
      icon: "unit-terran-vikingfighter.png",
      category: Category.UNIT,
      requirement: [AND, "Starport", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 30,
      mineralCost: 150,
      gasCost: 75,
      supply: 2
    },
    {
      name: "Medivac",
      icon: "unit-terran-medivac.png",
      category: Category.UNIT,
      requirement: [AND, "Starport", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 30,
      mineralCost: 100,
      gasCost: 100,
      supply: 2
    },
    {
      name: "Liberator",
      icon: "unit-terran-liberator.png",
      category: Category.UNIT,
      requirement: [AND, "Starport", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 43,
      mineralCost: 150,
      gasCost: 125,
      supply: 3
    },
    {
      name: "Raven",
      icon: "unit-terran-raven.png",
      category: Category.UNIT,
      requirement: [AND, "Starport", "Techlab", COL_PRIMARY],
      visible: [AND, "Starport", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 43,
      mineralCost: 100,
      gasCost: 150,
      supply: 2
    },
    {
      name: "Banshee",
      icon: "unit-terran-banshee.png",
      category: Category.UNIT,
      requirement: [AND, "Starport", "Techlab", COL_PRIMARY],
      visible: [AND, "Starport", [OR, COL_PRIMARY, "Reactor"]],
      buildTime: 43,
      mineralCost: 150,
      gasCost: 100,
      supply: 3
    },
    {
      name: "Battlecruiser",
      icon: "unit-terran-battlecruiser.png",
      category: Category.UNIT,
      requirement: [AND, "Starport", "Techlab", COL_PRIMARY],
      visible: [AND, "Starport", [OR, COL_PRIMARY, "Reactor"]],
      // globalReq: 'Fusion core',
      buildTime: 64,
      mineralCost: 400,
      gasCost: 300,
      supply: 6
    },
    // upgrades
    {
      name: "Stimpack",
      icon: "ability-terran-stimpack-color.png",
      category: Category.UPGRADE,
      requirement: [AND, "Barracks", "Techlab", COL_SECONDARY],
      buildTime: 100,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Combat shields",
      icon: "techupgrade-terran-combatshield-color.png",
      category: Category.UPGRADE,
      requirement: [AND, "Barracks", "Techlab", COL_SECONDARY],
      buildTime: 79,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Concussive shells",
      icon: "ability-terran-punishergrenade-color.png",
      category: Category.UPGRADE,
      requirement: [AND, "Barracks", "Techlab", COL_SECONDARY],
      buildTime: 43,
      mineralCost: 50,
      gasCost: 50
    },
    {
      name: "Infernal preigniter",
      icon: "upgrade-terran-infernalpreigniter.png",
      category: Category.UPGRADE,
      requirement: [AND, "Factory", "Techlab", COL_SECONDARY],
      buildTime: 79,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Hurricane trusters",
      icon: "upgrade-terran-jotunboosters.png",
      category: Category.UPGRADE,
      requirement: [AND, "Factory", "Techlab", COL_SECONDARY],
      buildTime: 100,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Drilling claws",
      icon: "upgrade-terran-researchdrillingclaws.png",
      category: Category.UPGRADE,
      requirement: [AND, "Factory", "Techlab", COL_SECONDARY],
      // globalReq: 'Armory',
      buildTime: 79,
      mineralCost: 75,
      gasCost: 75
    },
    {
      name: "Smart servos",
      icon: "upgrade-terran-transformationservos.png",
      category: Category.UPGRADE,
      requirement: [AND, "Factory", "Techlab", COL_SECONDARY],
      // globalReq: 'Armory',
      buildTime: 79,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Cloaking field",
      icon: "ability-terran-cloak-color.png",
      category: Category.UPGRADE,
      requirement: [AND, "Starport", "Techlab", COL_SECONDARY],
      buildTime: 79,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Hyperflight rotors",
      icon: "upgrade-terran-hyperflightrotors.png",
      category: Category.UPGRADE,
      requirement: [AND, "Starport", "Techlab", COL_SECONDARY],
      buildTime: 100,
      mineralCost: 125,
      gasCost: 125
    },
    {
      name: "Interference matrix",
      icon: "upgrade-terran-interferencematrix.png",
      category: Category.UPGRADE,
      requirement: [AND, "Starport", "Techlab", COL_SECONDARY],
      buildTime: 57,
      mineralCost: 50,
      gasCost: 50
    },
    {
      name: "Personal cloak",
      icon: "ability-terran-cloak-color.png",
      category: Category.UPGRADE,
      requirement: "Ghost academy",
      buildTime: 86,
      mineralCost: 150,
      gasCost: 150
    },
    {
      name: "Nuke",
      icon: "ability-terran-armnuke.png",
      category: Category.UPGRADE,
      requirement: [AND, "Ghost academy", [NO, "Nuke"]],
      visible: "Ghost academy",
      // globalReq: 'Factory'
      buildTime: 43,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Weapon systems (Yamato)",
      icon: "ability-terran-yamatogun-color.png",
      category: Category.UPGRADE,
      requirement: "Fusion core",
      buildTime: 100,
      mineralCost: 150,
      gasCost: 150
    },
    {
      name: "Caduceus reactor",
      icon: "upgrade-terran-caduceusreactor.png",
      category: Category.UPGRADE,
      requirement: "Fusion core",
      buildTime: 50,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Advanced ballistics",
      icon: "upgrade-terran-advanceballistics.png",
      category: Category.UPGRADE,
      requirement: "Fusion core",
      buildTime: 79,
      mineralCost: 150,
      gasCost: 150
    },
    {
      name: "Infantry weapons 1",
      icon: "upgrade-terran-infantryweaponslevel1.png",
      category: Category.UPGRADE,
      requirement: "Engineering bay",
      buildTime: 114,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Infantry weapons 2",
      icon: "upgrade-terran-infantryweaponslevel2.png",
      category: Category.UPGRADE,
      requirement: "Engineering bay",
      buildTime: 136,
      mineralCost: 175,
      gasCost: 175
    },
    {
      name: "Infantry weapons 3",
      icon: "upgrade-terran-infantryweaponslevel3.png",
      category: Category.UPGRADE,
      requirement: "Engineering bay",
      buildTime: 157,
      mineralCost: 250,
      gasCost: 250
    },
    {
      name: "Infantry armor 1",
      icon: "upgrade-terran-infantryarmorlevel1.png",
      category: Category.UPGRADE,
      requirement: "Engineering bay",
      buildTime: 114,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Infantry armor 2",
      icon: "upgrade-terran-infantryarmorlevel2.png",
      category: Category.UPGRADE,
      requirement: "Engineering bay",
      buildTime: 136,
      mineralCost: 175,
      gasCost: 175
    },
    {
      name: "Infantry armor 3",
      icon: "upgrade-terran-infantryarmorlevel3.png",
      category: Category.UPGRADE,
      requirement: "Engineering bay",
      buildTime: 157,
      mineralCost: 250,
      gasCost: 250
    },
    {
      name: "Vehicle weapons 1",
      icon: "upgrade-terran-vehicleweaponslevel1.png",
      category: Category.UPGRADE,
      requirement: "Armory",
      buildTime: 114,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Vehicle weapons 2",
      icon: "upgrade-terran-vehicleweaponslevel2.png",
      category: Category.UPGRADE,
      requirement: "Armory",
      buildTime: 136,
      mineralCost: 175,
      gasCost: 175
    },
    {
      name: "Vehicle weapons 3",
      icon: "upgrade-terran-vehicleweaponslevel3.png",
      category: Category.UPGRADE,
      requirement: "Armory",
      buildTime: 157,
      mineralCost: 250,
      gasCost: 250
    },
    {
      name: "Vehicle platting 1",
      icon: "upgrade-terran-vehicleplatinglevel1.png",
      category: Category.UPGRADE,
      requirement: "Armory",
      buildTime: 114,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Vehicle platting 2",
      icon: "upgrade-terran-vehicleplatinglevel2.png",
      category: Category.UPGRADE,
      requirement: "Armory",
      buildTime: 136,
      mineralCost: 175,
      gasCost: 175
    },
    {
      name: "Vehicle platting 3",
      icon: "upgrade-terran-vehicleplatinglevel3.png",
      category: Category.UPGRADE,
      requirement: "Armory",
      buildTime: 157,
      mineralCost: 250,
      gasCost: 250
    },
    {
      name: "Ship weapons 1",
      icon: "upgrade-terran-shipweaponslevel1.png",
      category: Category.UPGRADE,
      requirement: "Armory",
      buildTime: 114,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Ship weapons 2",
      icon: "upgrade-terran-shipweaponslevel2.png",
      category: Category.UPGRADE,
      requirement: "Armory",
      buildTime: 136,
      mineralCost: 175,
      gasCost: 175
    },
    {
      name: "Ship weapons 3",
      icon: "upgrade-terran-shipweaponslevel3.png",
      category: Category.UPGRADE,
      requirement: "Armory",
      buildTime: 157,
      mineralCost: 250,
      gasCost: 250
    },
    {
      name: "Targeting systems",
      icon: "upgrade-terran-hisecautotracking.png",
      category: Category.UPGRADE,
      requirement: "Engineering bay",
      buildTime: 57,
      mineralCost: 100,
      gasCost: 100
    },
    {
      name: "Neosteel armor",
      icon: "upgrade-terran-buildingarmor.png",
      category: Category.UPGRADE,
      requirement: "Engineering bay",
      buildTime: 100,
      mineralCost: 150,
      gasCost: 150
    }
  ]
};
function delegateEvent(containerEl, selector, eventType, fn) {
  containerEl.addEventListener(eventType, function(event) {
    const el = event.target.closest(selector);
    if (el) {
      fn(el, event);
    }
  });
}
function divideInt(x, y) {
  return ~~(x / y);
}
const $RAW = Symbol("pozitron-raw");
const $TRACK = Symbol("pozitron-track");
function isWrappable(value) {
  return value !== null && typeof value === "object";
}
function unwrap(value) {
  if (!isWrappable(value)) {
    return value;
  }
  return value[$RAW] || value;
}
function notifiableStore(fn) {
  const [track, notify] = voidSignal();
  return [fn(track), notify, track];
}
function Comment() {
  return document.createComment("");
}
const emptyItem = {};
const noopFn$1 = () => {
};
const defaultKeyFn = (item) => item;
function StaticFor(props) {
  const renderItem = props.children[0];
  const el = document.createDocumentFragment();
  for (const item of props.each) {
    el.appendChild(renderItem(item));
  }
  return el;
}
function Index(props) {
  const { each, key } = props;
  const getter = typeof each === "function" ? each : () => each;
  const keyFn = typeof key === "string" ? (item) => item[key] : key || defaultKeyFn;
  const ref = props.ref || noopFn$1;
  const renderFn = props.children[0];
  const items = getter();
  let unwrappedItems = unwrap(items);
  const isNotStore = unwrappedItems === items;
  let prevItems, elements;
  subscribe(
    () => {
      const items2 = getter();
      items2[$TRACK];
      return items2;
    },
    (items2) => {
      if (isNotStore) {
        unwrappedItems = items2;
      }
      let length2 = unwrappedItems.length;
      const prevLength = prevItems.length;
      const parentEl = elements[0].parentNode;
      if (length2 <= 1 && parentEl.firstChild === elements[0] && parentEl.lastChild === elements[prevLength - 1]) {
        let newEl;
        if (length2 > 0) {
          if (keyFn(unwrappedItems[0]) === keyFn(prevItems[0])) {
            return;
          }
          newEl = renderFn(items2[0], 0);
          prevItems = [unwrappedItems[0]];
        } else {
          newEl = Comment();
          prevItems = [emptyItem];
        }
        parentEl.textContent = "";
        parentEl.appendChild(newEl);
        elements = [newEl];
        ref(length2 > 0 ? elements : []);
        return;
      }
      if (length2 === 0) {
        length2 = 1;
        const newEl = Comment();
        elements[0].replaceWith(newEl);
        elements[0] = newEl;
      } else {
        if (length2 > prevLength) {
          elements.length = length2;
        }
        for (let i = 0; i < length2; i++) {
          const prevItem = prevItems[i];
          if (!prevItem || keyFn(unwrappedItems[i]) !== keyFn(prevItem)) {
            const newEl = renderFn(items2[i], i);
            if (!prevItem) {
              parentEl.insertBefore(newEl, elements[i - 1].nextSibling);
            } else {
              elements[i].replaceWith(newEl);
            }
            elements[i] = newEl;
          }
        }
      }
      if (prevLength > length2) {
        for (let i = prevLength - 1; i >= length2; i--) {
          elements[i].remove();
        }
        elements.splice(length2);
      }
      prevItems = unwrappedItems.length > 0 ? unwrappedItems.slice(0) : [emptyItem];
      ref(length2 > 0 ? elements : []);
    },
    { defer: true }
  );
  const length = unwrappedItems.length;
  if (length > 0) {
    prevItems = unwrappedItems.slice(0);
    const el = document.createDocumentFragment();
    elements = new Array(length);
    for (let i = 0; i < length; i++) {
      el.appendChild(elements[i] = renderFn(items[i]));
    }
    ref(elements);
    return el;
  } else {
    prevItems = [emptyItem];
    elements = [Comment()];
    ref([]);
    return elements[0];
  }
}
const itemsMap = /* @__PURE__ */ new Map();
function For(props) {
  const { each, key } = props;
  const getter = typeof each === "function" ? each : () => each;
  const keyFn = typeof key === "string" ? (item) => item[key] : key || defaultKeyFn;
  const ref = props.ref || noopFn$1;
  const renderFn = props.children[0];
  const items = getter();
  let unwrappedItems = unwrap(items);
  const isNotStore = unwrappedItems === items;
  let prevItems, elements;
  subscribe(
    () => {
      const items2 = getter();
      items2[$TRACK];
      return items2;
    },
    (items2) => {
      if (isNotStore) {
        unwrappedItems = items2;
      }
      let length2 = unwrappedItems.length;
      const prevLength = prevItems.length;
      const parentEl = elements[0].parentNode;
      if (length2 <= 1 && parentEl.firstChild === elements[0] && parentEl.lastChild === elements[prevLength - 1]) {
        let newEl;
        if (length2 > 0) {
          if (keyFn(unwrappedItems[0]) === keyFn(prevItems[0])) {
            return;
          }
          newEl = renderFn(items2[0]);
          prevItems = [unwrappedItems[0]];
        } else {
          newEl = Comment();
          prevItems = [emptyItem];
        }
        parentEl.textContent = "";
        parentEl.appendChild(newEl);
        elements = [newEl];
        ref(length2 > 0 ? elements : []);
        return;
      }
      if (length2 === 0) {
        const newEl = Comment();
        elements[0].replaceWith(newEl);
        for (let i = prevLength - 1; i >= 1; i--) {
          elements[i].remove();
        }
        elements = [newEl];
      } else {
        let start = 0;
        const minLength = Math.min(length2, prevLength);
        while (start < minLength && keyFn(prevItems[start]) === keyFn(unwrappedItems[start])) {
          start++;
        }
        if (start >= length2 && length2 >= prevLength) {
          return;
        }
        let end = length2;
        let prevEnd = prevLength;
        while (end > start && prevEnd > start && keyFn(prevItems[prevEnd - 1]) === keyFn(unwrappedItems[end - 1])) {
          end--;
          prevEnd--;
        }
        const needInsert = end > start;
        const prevDiffLength = prevEnd - start;
        let anchorEl = void 0;
        if (needInsert) {
          anchorEl = prevEnd > 0 ? elements[prevEnd - 1].nextSibling : elements[prevEnd];
        }
        let prevDiffElements;
        if (needInsert && prevDiffLength > 0) {
          prevDiffElements = elements.slice(start, prevEnd);
          for (let i = prevEnd - 1; i >= start; i--) {
            elements[i].remove();
            itemsMap.set(keyFn(prevItems[i]), i - start);
          }
        } else {
          for (let i = prevEnd - 1; i >= start; i--) {
            elements[i].remove();
          }
        }
        if (prevLength > length2) {
          elements.splice(end, prevLength - length2);
        }
        if (needInsert) {
          if (prevLength < length2) {
            elements.length = length2;
            elements.copyWithin(end, prevEnd, prevLength);
          }
          const insertFragment = document.createDocumentFragment();
          for (let i = start; i < end; i++) {
            const itemKey = keyFn(unwrappedItems[i]);
            let newEl;
            if (prevDiffLength > 0 && itemsMap.has(itemKey)) {
              const prevIndex = itemsMap.get(itemKey);
              newEl = prevDiffElements[prevIndex];
              prevDiffElements[prevIndex] = void 0;
            } else {
              newEl = renderFn(items2[i]);
            }
            insertFragment.appendChild(newEl);
            elements[i] = newEl;
          }
          for (let i = 0; i < prevDiffLength; i++) {
            if (!prevDiffElements[i])
              ;
          }
          parentEl.insertBefore(insertFragment, anchorEl);
          if (prevDiffLength > 0) {
            itemsMap.clear();
          }
        }
      }
      prevItems = unwrappedItems.length > 0 ? unwrappedItems.slice(0) : [emptyItem];
      ref(length2 > 0 ? elements : []);
    },
    { defer: true }
  );
  const length = unwrappedItems.length;
  if (length > 0) {
    prevItems = unwrappedItems.slice(0);
    const el = document.createDocumentFragment();
    elements = new Array(length);
    for (let i = 0; i < length; i++) {
      el.appendChild(elements[i] = renderFn(items[i]));
    }
    ref(elements);
    return el;
  } else {
    prevItems = [emptyItem];
    elements = [Comment()];
    ref([]);
    return elements[0];
  }
}
let current;
function updatePosition(drag, event) {
  drag.x = event.clientX - drag.startX;
  drag.y = event.clientY - drag.startY;
  if (drag.move) {
    drag.move(drag);
  } else {
    drag.el.style.left = drag.x + "px";
    drag.el.style.top = drag.y + "px";
  }
}
document.addEventListener("mouseup", function(event) {
  if (!current) {
    return;
  }
  if (current.finished) {
    current.finished(current.el, current.x, current.y);
  }
  current = void 0;
});
document.addEventListener("mousemove", function(event) {
  if (!current) {
    return;
  }
  updatePosition(current, event);
});
const MOUSE_BUTTON_LEFT = 0;
function Draggable(el, options = {}) {
  const { grabEl = el, started, finished, move, buttons = [MOUSE_BUTTON_LEFT] } = options;
  const drag = {
    el,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    finished,
    move
  };
  grabEl.addEventListener("mousedown", function(event) {
    if (buttons && !buttons.includes(event.button)) {
      return;
    }
    event.preventDefault();
    current = drag;
    current.startX = event.clientX - el.offsetLeft;
    current.startY = event.clientY - el.offsetTop;
    if (started) {
      started(el);
    }
    updatePosition(current, event);
  });
}
function DelegateDraggable(containerEl, selector, options = {}) {
  const { started, finished, move, buttons = [MOUSE_BUTTON_LEFT], placeholder = false } = options;
  let placeholderEl;
  const drag = {
    el: void 0,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    finished(el, x, y) {
      if (placeholder) {
        placeholderEl.remove();
        placeholderEl = void 0;
      }
      if (finished) {
        finished(el, x, y);
      }
    },
    move
  };
  delegateEvent(containerEl, selector, "mousedown", (el, event) => {
    if (buttons && !buttons.includes(event.button)) {
      return;
    }
    event.preventDefault();
    current = drag;
    current.el = el;
    current.startX = event.clientX - el.offsetLeft;
    current.startY = event.clientY - el.offsetTop;
    if (started) {
      started(el, event);
    }
    updatePosition(current, event);
    if (placeholder) {
      placeholderEl = document.createElement("div");
      placeholderEl.style.height = el.offsetHeight + "px";
      el.insertAdjacentElement("beforebegin", placeholderEl);
    }
  });
}
function ProductionColumn({
  column,
  getPrimaryColumn,
  removeItem,
  dragStartItem,
  dragMoveItem,
  dragFinishItem,
  setSelectedColumn
}) {
  let columnEl, itemsEl;
  const primaryCol = column.isSecondary ? getPrimaryColumn(column) : column;
  function clickAppendItem() {
    setSelectedColumn(column, columnEl);
  }
  function updateDrag(maxY) {
    let i = 0;
    for (const itemEl of itemsEl) {
      const item = column.viewItems[i];
      if (item.dragging) {
        itemEl.style.top = maxY - item.height - item.y + "px";
        itemEl.style.left = "0px";
      }
      i++;
    }
  }
  function updateDragStart() {
    let i = 0;
    for (const itemEl of itemsEl) {
      const item = column.viewItems[i];
      if (item.dragging) {
        itemEl.classList.add("dragging");
      }
      i++;
    }
  }
  function updateDragFinish() {
    let i = 0;
    for (const itemEl of itemsEl) {
      const item = column.viewItems[i];
      if (item.dragging) {
        itemEl.classList.remove("dragging");
        itemEl.style.top = "";
        itemEl.style.left = "";
      }
      i++;
    }
  }
  function setup(el) {
    columnEl = el;
    columnEl.updateDrag = updateDrag;
    columnEl.updateDragStart = updateDragStart;
    columnEl.updateDragFinish = updateDragFinish;
    let maxY, dragElHeight, dragMode, dragItem, columnEl2;
    DelegateDraggable(columnEl, ".production-item", {
      // placeholder: true,
      move: ({
        el: el2,
        x,
        y
      }) => {
        if (dragMode === DragMode.Column) {
          return;
        }
        if (dragMode === DragMode.Single) {
          let [newX, newY] = el2.handleDragMoveItem(column, dragItem, x, maxY - dragElHeight - y);
          newY = maxY - dragElHeight - newY;
          el2.style.top = newY + "px";
          el2.style.left = newX + "px";
        } else if (dragMode === DragMode.SingleWithSecondary) {
          el2.handleDragMoveItem(primaryCol, dragItem, x, maxY - dragElHeight - y);
          updateDrag(maxY);
          columnEl2.updateDrag(maxY);
        } else if (dragMode === DragMode.Multiple || dragMode === DragMode.MultipleWithSecondary) {
          el2.handleDragMoveItem(column, dragItem, x, maxY - dragElHeight - y);
          updateDrag(maxY);
          if (dragMode === DragMode.MultipleWithSecondary) {
            columnEl2.updateDrag(maxY);
          }
        }
      },
      started: (el2, event) => {
        [dragMode, dragItem] = el2.handleDragStartItem(event);
        if (dragMode === DragMode.Column) {
          return;
        }
        maxY = columnEl.offsetHeight;
        dragElHeight = el2.offsetHeight;
        if (dragMode === DragMode.Single) {
          el2.classList.add("dragging");
        } else if (dragMode === DragMode.SingleWithSecondary) {
          updateDragStart();
          columnEl2 = column.isSecondary ? columnEl.previousElementSibling : columnEl.nextElementSibling;
          columnEl2.updateDragStart();
        } else if (dragMode === DragMode.Multiple || dragMode === DragMode.MultipleWithSecondary) {
          updateDragStart();
          if (dragMode === DragMode.MultipleWithSecondary) {
            columnEl2 = columnEl.nextElementSibling;
            columnEl2.updateDragStart();
          }
        }
      },
      finished: (el2) => {
        if (dragMode === DragMode.Column) {
          return;
        }
        if (dragMode === DragMode.Single) {
          el2.classList.remove("dragging");
          el2.style.top = "";
          el2.style.left = "";
          el2.handleDragFinishItem(column, dragItem);
        } else if (dragMode === DragMode.SingleWithSecondary) {
          updateDragFinish();
          columnEl2.updateDragFinish();
          el2.handleDragFinishItem(primaryCol, dragItem);
        } else if (dragMode === DragMode.Multiple || dragMode === DragMode.MultipleWithSecondary) {
          updateDragFinish();
          if (dragMode === DragMode.MultipleWithSecondary) {
            columnEl2.updateDragFinish();
          }
          el2.handleDragFinishItem(column, dragItem);
        }
      }
    });
  }
  function displayTime(time) {
    const sec = time % 60;
    const min = ~~((time - sec) / 60);
    return ("0" + min).slice(-2) + ":" + ("0" + sec).slice(-2);
  }
  function setupItems(els) {
    itemsEl = els;
    let i = 0;
    for (const itemEl of itemsEl) {
      const item = column.viewItems[i];
      if (!item.spacing) {
        const titleText = displayTime(item.time) + "  –  " + item.name;
        itemEl.setAttribute("title", titleText);
        if (item.roundedTop) {
          itemEl.classList.add("border-top-round");
        } else {
          itemEl.classList.remove("border-top-round");
        }
        if (item.roundedBottom) {
          itemEl.classList.add("border-bottom-round");
        } else {
          itemEl.classList.remove("border-bottom-round");
        }
      }
      i++;
    }
  }
  return h("div", {
    "class": "production-column",
    "ref": (el) => setup(el)
  }, [h(For, {
    "each": column.getItems,
    "key": "id",
    "ref": (els) => setupItems(els)
  }, [(item) => {
    if (item.draggingPlaceholder || item.hidden) {
      return h("div", {
        "class": "production-item-placeholder",
        "style": {
          "min-height": item.height + "px"
        }
      }, []);
    } else if (item.spacing) {
      return h("div", {
        "class": "production-item-space",
        "style": {
          "min-height": item.height + "px"
        }
      }, []);
    } else {
      let clickRemoveItem2 = function(event) {
        event.preventDefault();
        removeItem(column, item);
      }, handleDragStartItem2 = function(event) {
        return dragStartItem(column, item, event);
      }, handleDragMoveItem2 = function(col, item2, x, y) {
        return dragMoveItem(col, item2, x, y);
      }, handleDragFinishItem2 = function(col, item2) {
        return dragFinishItem(col, item2);
      };
      var clickRemoveItem = clickRemoveItem2, handleDragStartItem = handleDragStartItem2, handleDragMoveItem = handleDragMoveItem2, handleDragFinishItem = handleDragFinishItem2;
      return h("div", {
        "class": "production-item",
        "classList": {
          "production-item-wide": item.isWide,
          "production-item-fixed": item.fixed
        },
        "ref": (el) => (el.clickRemoveItem = clickRemoveItem2, el.handleDragStartItem = handleDragStartItem2, el.handleDragMoveItem = handleDragMoveItem2, el.handleDragFinishItem = handleDragFinishItem2),
        "style": {
          "min-height": item.fixed ? "" : item.height + "px",
          "--cl-bg": item.color
        }
      }, [h("div", {
        "class": "production-icon",
        "style": {
          "background-image": `url('/resources/${item.icon}')`
        }
      }, [])]);
    }
  }]), h("button", {
    "class": "production-button-add-item",
    "ref": (el) => el.clickAppendItem = clickAppendItem
  }, [h("i", {
    "class": "mdi mdi-plus"
  }, [])])]);
}
function ProductionColumns({
  columns,
  getPrimaryColumn,
  removeItem,
  dragStartItem,
  dragMoveItem,
  dragFinishItem,
  setSelectedColumn
}) {
  return h(For, {
    "each": columns,
    "key": "id"
  }, [(column) => h(ProductionColumn, {
    "column": column,
    "getPrimaryColumn": getPrimaryColumn,
    "removeItem": removeItem,
    "dragStartItem": dragStartItem,
    "dragMoveItem": dragMoveItem,
    "dragFinishItem": dragFinishItem,
    "setSelectedColumn": setSelectedColumn
  }, [])]);
}
function PanelItemsPalette({
  buttonCategories,
  appendItem,
  isShow,
  onClose
}) {
  let titleEl, itemsPaletteEl;
  let [dragging, setDragging] = signal(false);
  function setup(el) {
    Draggable(el, {
      grabEl: titleEl,
      started: () => setDragging(true),
      finished: () => setDragging(false)
    });
    delegateEvent(itemsPaletteEl, ".items-palette-button", "click", (el2) => el2.clickAddItem());
  }
  return h("div", {
    "ref": (el) => setup(el),
    "style": {
      top: "100px",
      left: "913px"
    },
    "show": isShow,
    "id": "panel-items-palette",
    "class": "modal",
    "classList": {
      dragging
    }
  }, [h("div", {
    "class": "modal-header"
  }, [h("div", {
    "class": "modal-header-title",
    "ref": (el) => titleEl = el
  }, ["Панель производства"]), h("button", {
    "class": "modal-header-button button-close",
    "on": {
      "click": onClose
    }
  }, [h("i", {
    "class": "mdi mdi-close"
  }, [])])]), h("div", {
    "class": "modal-content",
    "ref": (el) => itemsPaletteEl = el
  }, [h(StaticFor, {
    "each": buttonCategories
  }, [(buttonCategory) => h("div", {
    "class": "items-palette-section",
    "show": buttonCategory.hasButtons
  }, [h("div", {
    "class": "items-palette-section-title"
  }, [buttonCategory.title]), h(For, {
    "each": buttonCategory.getButtons,
    "key": "key"
  }, [(button) => {
    const clickAddItem = () => appendItem(button.typeId);
    return h("button", {
      "title": button.name,
      "class": "items-palette-button",
      "ref": (el) => el.clickAddItem = clickAddItem,
      "disabled": button.isDisabled ? "" : void 0
    }, [h("div", {
      "style": {
        "background-image": `url('/resources/${button.icon}')`
      },
      "class": "production-icon"
    }, [])]);
  }])])])])]);
}
function PanelIncome({
  getEconomyItems
}) {
  let economyItems;
  function setupItems(itemsEl) {
    let i = 0;
    for (const itemEl of itemsEl) {
      const item = economyItems[i];
      if (item.spendingHigher) {
        itemEl.classList.add("spending-item-higher");
      } else {
        itemEl.classList.remove("spending-item-higher");
      }
      if (item.spendingPrevHigher) {
        itemEl.classList.add("spending-item-prev-higher");
      } else {
        itemEl.classList.remove("spending-item-prev-higher");
      }
      i++;
    }
  }
  const _economyItems = () => economyItems = getEconomyItems();
  return h("div", {
    "id": "panel-income"
  }, [h(Index, {
    "each": _economyItems,
    "ref": (els) => setupItems(els)
  }, [(item) => {
    if (item.isLast) {
      return h("div", {
        "class": "spending-item-space-infinite",
        "style": {
          flex: "1",
          width: item.width + "px"
        }
      }, []);
    } else {
      return h("div", {
        "class": "spending-item-space",
        "style": {
          "min-height": item.height + "px",
          width: item.width + "px",
          "--cl-bg": item.color ? item.color : ""
        }
      }, []);
    }
  }])]);
}
const noopFn = () => {
};
const trueFn = () => true;
const INITIAL_WORKERS = 12;
const INITIAL_MINERALS = 50;
const INCOME_SCALE_DIV = 60;
function ProductionColumnsData(validateRequirement, columnRemoved, getUnitData, getTimeScale, data) {
  let nextColumnId = 1, nextItemId = 1;
  const [trackColumns, notifyColumns] = voidSignal();
  const [trackColumnsData, notifyColumnsData] = voidSignal();
  let incomeItems;
  function getEconomyItems() {
    trackColumnsData();
    const timeScale = getTimeScale();
    const incomeWidthScale = 4;
    const workerIncome = 60;
    incomeItems = [{
      time: 0,
      endTime: 0,
      incomeDelta: INITIAL_WORKERS * workerIncome,
      incomePerMin: 0,
      width: 0,
      height: 0,
      color: void 0,
      id: void 0,
      isSpent: false,
      reminder: INITIAL_MINERALS * INCOME_SCALE_DIV
      // spendingHigher: true, spendingPrevHigher: false,
      // key: '', itemsId: ['I'],
    }];
    function insertIncomeDelta(time, incomeDelta, itemId) {
      let incomeIndex = 0;
      while (incomeIndex < incomeItems.length && incomeItems[incomeIndex].time < time) {
        incomeIndex++;
      }
      if (incomeIndex < incomeItems.length && incomeItems[incomeIndex].time === time) {
        incomeItems[incomeIndex].incomeDelta += incomeDelta;
      } else {
        incomeItems.splice(incomeIndex, 0, {
          time,
          endTime: 0,
          incomeDelta,
          incomePerMin: 0,
          width: 0,
          height: 0,
          color: void 0,
          id: void 0,
          isSpent: false,
          reminder: 0
          // spendingHigher: false, spendingPrevHigher: false,
          // key: '', itemsId: [itemId],
        });
      }
    }
    function insertSpending(time, cost, itemId, color) {
      let remaining = cost * INCOME_SCALE_DIV;
      let insertTimeEnd = time;
      for (let i = incomeItems.length - 1; i >= 0; i--) {
        const incomeItem = incomeItems[i];
        if (incomeItem.time > insertTimeEnd) {
          continue;
        }
        if (incomeItem.reminder > 0) {
          const spentReminder = Math.min(remaining, incomeItem.reminder);
          incomeItem.reminder -= spentReminder;
          remaining -= spentReminder;
          if (remaining === 0) {
            break;
          }
        }
        if (incomeItem.isSpent) {
          insertTimeEnd = incomeItem.time;
          continue;
        }
        const incomePerMin = incomeItem.incomePerMin;
        const available = incomePerMin * (insertTimeEnd - incomeItem.time);
        let insertTime, unspentReminder = 0;
        if (remaining >= available) {
          insertTime = incomeItem.time;
          remaining -= available;
        } else {
          const timeHeight = Math.ceil(remaining / incomePerMin);
          insertTime = insertTimeEnd - timeHeight;
          unspentReminder = timeHeight * incomePerMin - remaining;
          remaining = 0;
        }
        const replaceItems = [];
        if (insertTime > incomeItem.time) {
          replaceItems.push({
            time: incomeItem.time,
            endTime: insertTime,
            incomePerMin,
            // unspent: incomePerMin * (insertTime - incomeItem.time),
            width: 0,
            height: 0,
            color: void 0,
            id: void 0,
            isSpent: false,
            reminder: 0
          });
        }
        replaceItems.push({
          time: insertTime,
          endTime: insertTimeEnd,
          incomePerMin,
          width: 0,
          height: 0,
          color,
          id: itemId,
          isSpent: true,
          reminder: unspentReminder
        });
        const isLast = i === incomeItems.length - 1;
        if (isLast || incomeItem.endTime > insertTimeEnd) {
          replaceItems.push({
            time: insertTimeEnd,
            endTime: incomeItem.endTime,
            incomePerMin,
            // unspent: incomePerMin * (incomeItem.endTime - insertTimeEnd),
            width: 0,
            height: 0,
            color: void 0,
            id: void 0,
            isSpent: false,
            reminder: 0
          });
        }
        insertTimeEnd = insertTime;
        incomeItems.splice(i, 1, ...replaceItems);
        if (insertTime > incomeItem.time) {
          i++;
        }
        if (remaining === 0) {
          break;
        }
      }
      if (remaining > 0) {
        console.log(`Not enough minerals! ${-remaining}`);
      }
    }
    for (const column of columns) {
      for (const item of column.items) {
        const unitData = getUnitData(item.typeId);
        if (unitData.mineralIncome > 0) {
          if (unitData.lifeTime > 0) {
            insertIncomeDelta(item.time, unitData.mineralIncome, item.id);
            insertIncomeDelta(item.endTime, -unitData.mineralIncome, -item.id);
          } else {
            insertIncomeDelta(item.endTime, unitData.mineralIncome, item.id);
          }
        }
        if (unitData.buildType === BuildType.WorkerBuild) {
          insertIncomeDelta(item.time, -workerIncome, -item.id);
          insertIncomeDelta(item.endTime, workerIncome, item.id);
        } else if (unitData.buildType === BuildType.WorkerMorph) {
          insertIncomeDelta(item.time, -workerIncome, -item.id);
        }
      }
    }
    let lastItem, incomeValue = 0;
    for (const income of incomeItems) {
      if (lastItem) {
        lastItem.endTime = income.time;
      }
      incomeValue += income.incomeDelta;
      income.incomePerMin = incomeValue;
      lastItem = income;
    }
    lastItem.endTime = lastItem.time;
    for (const column of columns) {
      for (const item of column.items) {
        if (item.fixed) {
          continue;
        }
        const unitData = getUnitData(item.typeId);
        if (unitData.mineralCost > 0) {
          insertSpending(item.time, unitData.mineralCost, item.id, Color[unitData.category]);
        }
      }
    }
    for (const income of incomeItems) {
      income.height = (income.endTime - income.time) * timeScale;
      income.width = divideInt(income.incomePerMin * incomeWidthScale, INCOME_SCALE_DIV);
    }
    incomeItems[incomeItems.length - 1].isLast = true;
    incomeItems[0].spendingHigher = true;
    incomeItems[0].spendingPrevHigher = false;
    return incomeItems;
  }
  function initColumnItems(columnItems) {
    let endTime = 0;
    const items = columnItems.map((item) => {
      const unitData = getUnitData(item.typeId);
      endTime = item.time + (item.fixed ? 0 : unitData.buildTime);
      item.id = nextItemId;
      item.productionTypeId = void 0;
      item.endTime = endTime;
      item.dragging = false;
      item.visible = true;
      item.fixed = item.fixed || false;
      nextItemId++;
      return item;
    });
    return items;
  }
  function getColumnEndTime(column) {
    const length = column.items.length;
    return length > 0 ? column.items[length - 1].endTime : 0;
  }
  function getViewItems(column) {
    const timeScale = getTimeScale();
    const viewItems = [];
    const draggingItems = [];
    let lastTime = 0;
    let i = 0;
    for (const item of column.items) {
      const unitData = getUnitData(item.typeId);
      let addSpacing = item.time > lastTime;
      if (addSpacing) {
        viewItems.push({
          id: "s:" + lastTime + ":" + item.time,
          spacing: true,
          height: (item.time - lastTime) * timeScale
        });
      }
      lastTime = item.time + (item.fixed ? 0 : unitData.buildTime);
      if (!item.visible) {
        viewItems.push({
          id: item.id,
          hidden: true,
          height: unitData.buildTime * timeScale
        });
      } else {
        let text = unitData.name;
        if (item.fixed && unitData.category === Category.RESOURCE_CENTER) {
          text += ` +${INITIAL_WORKERS} workers`;
        }
        const nextItem = column.items[i + 1];
        const viewItem = {
          id: item.id,
          name: text,
          time: item.time,
          typeId: item.typeId,
          icon: unitData.icon,
          color: Color[unitData.category],
          y: item.time * timeScale,
          height: unitData.buildTime * timeScale,
          isWide: unitData.isWide || false,
          fixed: item.fixed,
          dragging: item.dragging,
          roundedTop: !item.fixed && (!nextItem || nextItem.time > lastTime),
          roundedBottom: false
        };
        if (item.dragging) {
          viewItem.roundedBottom = addSpacing || i === 0;
          viewItems.push({
            id: "d:" + item.id,
            draggingPlaceholder: true,
            height: unitData.buildTime * timeScale
          });
          draggingItems.push(viewItem);
        } else {
          viewItems.push(viewItem);
        }
      }
      i++;
    }
    return column.viewItems = viewItems.concat(draggingItems);
  }
  function createColumn(items = []) {
    const [track, notify] = voidSignal();
    const column = {
      id: nextColumnId,
      secondaryCol: void 0,
      isSecondary: false,
      items,
      viewItems: [],
      notify,
      getItems: () => track(getViewItems(column))
    };
    nextColumnId++;
    return column;
  }
  const columns = data.map((columnItems) => {
    const items = initColumnItems(columnItems);
    return createColumn(items);
  });
  function findColumnIndex(column) {
    const index = columns.findIndex((c) => c === column);
    if (index === -1) {
      throw new Error(`Column not found, id = '${column.id}'`);
    }
    return index;
  }
  function appendColumn() {
    columns.push(createColumn());
    notifyColumns();
    notifyColumnsData();
  }
  function removeColumn(column) {
    const index = findColumnIndex(column);
    columns.splice(index, 1);
    columnRemoved(column);
    notifyColumns();
    notifyColumnsData();
  }
  function insertColumnAfter(column, afterCol) {
    const index = findColumnIndex(afterCol);
    columns.splice(index + 1, 0, column);
    notifyColumns();
    notifyColumnsData();
  }
  function getProductionTypeId(column) {
    for (const item of column.items) {
      const unitData = getUnitData(item.typeId);
      if (unitData.category === Category.PRODUCTION) {
        return item.typeId;
      }
    }
    return void 0;
  }
  function appendItem(column, typeId, data2 = {}) {
    const {
      visible = true,
      time = getColumnEndTime(column),
      productionTypeId
    } = data2;
    const unitData = getUnitData(typeId);
    const item = {
      id: nextItemId,
      typeId,
      productionTypeId,
      visible,
      fixed: false,
      name: unitData.name,
      time,
      endTime: time + unitData.buildTime,
      dragging: false
    };
    nextItemId++;
    column.items.push(item);
    column.notify();
    notifyColumnsData();
    if (!column.isSecondary && unitData.category === Category.ADDON) {
      let insertCol = false;
      if (!column.secondaryCol) {
        insertCol = true;
        column.secondaryCol = createColumn();
        column.secondaryCol.isSecondary = true;
      }
      appendItem(column.secondaryCol, typeId, {
        time,
        visible: false,
        productionTypeId: getProductionTypeId(column)
      });
      if (insertCol) {
        insertColumnAfter(column.secondaryCol, column);
      }
    }
  }
  function deleteElement(items, fn) {
    const index = items.findIndex(fn);
    if (index !== -1) {
      const item = items[index];
      items.splice(index, 1);
      return item;
    }
  }
  function removeItem(column, viewItem) {
    const item = deleteElement(column.items, (i) => i.id === viewItem.id);
    if (item) {
      if (column.secondaryCol) {
        const unitData = getUnitData(item.typeId);
        if (unitData.category === Category.ADDON) {
          deleteElement(column.secondaryCol.items, (i) => i.time === item.time && !i.visible);
          column.secondaryCol.notify();
          if (column.secondaryCol.items.length === 0) {
            removeColumn(column.secondaryCol);
            column.secondaryCol = void 0;
          }
        }
      }
      column.notify();
      notifyColumnsData();
    }
  }
  function intersect(a, from, to) {
    return a > from && a <= to;
  }
  function intersect2(a, from, to) {
    return a >= from && a < to;
  }
  function getPrimaryColumn(column) {
    const columnIndex = columns.findIndex((c) => c === column);
    return columns[columnIndex - 1];
  }
  function setItemsDragging(column, fn = trueFn) {
    for (const item of column.items) {
      if (fn(item)) {
        item.dragging = true;
      }
    }
  }
  function clearItemsDragging(column) {
    for (const item of column.items) {
      item.dragging = false;
    }
  }
  let dragMode, dragMinTime;
  function dragStartItem(column, viewItem, event) {
    let dragItem = column.items.find((i) => i.id === viewItem.id);
    if (!dragItem) {
      throw new Error(`Item not found, id = '${viewItem.id}'`);
    }
    const unitData = getUnitData(viewItem.typeId);
    if (dragItem.fixed) {
      dragMode = DragMode.Column;
      dragMinTime = 0;
    } else if (unitData.category === Category.PRODUCTION || unitData.category === Category.RESOURCE_CENTER || unitData.category === Category.TECH_STRUCTURE) {
      dragMode = DragMode.Multiple;
      dragMinTime = 0;
      setItemsDragging(column, (item) => {
        dragMinTime = Math.max(dragMinTime, dragItem.time - item.time);
        return true;
      });
      if (column.secondaryCol) {
        dragMode = DragMode.MultipleWithSecondary;
        setItemsDragging(column.secondaryCol);
        column.secondaryCol.notify();
      }
      column.notify();
      notifyColumnsData();
    } else if (unitData.category === Category.ADDON && (column.isSecondary || !event.shiftKey)) {
      dragMode = DragMode.SingleWithSecondary;
      dragMinTime = 0;
      const primaryCol = column.isSecondary ? getPrimaryColumn(column) : column;
      validateRequirement(unitData.requirement, primaryCol.items, false, (reqItem) => {
        dragMinTime = Math.max(dragMinTime, reqItem.endTime);
      });
      dragItem = primaryCol.items.find((i) => i.time === dragItem.time);
      dragItem.dragging = true;
      setItemsDragging(primaryCol.secondaryCol);
      primaryCol.notify();
      primaryCol.secondaryCol.notify();
      notifyColumnsData();
    } else if (event.shiftKey) {
      dragMode = DragMode.Multiple;
      dragMinTime = 0;
      let heightOffset = 0;
      for (const item of column.items) {
        if (item.fixed) {
          continue;
        }
        const unitData2 = getUnitData(item.typeId);
        if (item.time >= dragItem.time) {
          if (!column.isSecondary && unitData2.category === Category.ADDON) {
            dragMode = DragMode.MultipleWithSecondary;
          }
          heightOffset = Math.max(heightOffset, dragItem.time - item.time);
          item.dragging = true;
        } else {
          dragMinTime = Math.max(dragMinTime, item.endTime);
        }
      }
      dragMinTime += heightOffset;
      if (dragMode === DragMode.MultipleWithSecondary) {
        setItemsDragging(column.secondaryCol);
        column.secondaryCol.notify();
      }
      column.notify();
      notifyColumnsData();
    } else {
      dragMode = DragMode.Single;
      dragMinTime = 0;
      validateRequirement(unitData.requirement, column.items, column.isSecondary, (reqItem) => {
        dragMinTime = Math.max(dragMinTime, reqItem.endTime);
      });
    }
    return [dragMode, dragItem];
  }
  function dragMoveItem(column, viewItem, x, y) {
    const index = column.items.findIndex((i) => i.id === viewItem.id);
    if (index === -1) {
      throw new Error(`Item not found, id = '${viewItem.id}'`);
    }
    const dragItem = column.items[index];
    const timeScale = getTimeScale();
    const newX = 0;
    let newY = divideInt(y, timeScale);
    newY = Math.max(newY, dragMinTime);
    const prevTime = dragItem.time;
    if (dragMode === DragMode.Multiple || dragMode === DragMode.MultipleWithSecondary) {
      let offset = newY - prevTime;
      for (const item of column.items) {
        if (item.dragging) {
          const itemHeight = item.endTime - item.time;
          item.time += offset;
          item.endTime = item.time + itemHeight;
        }
      }
      column.notify();
    } else if (dragMode === DragMode.Single || dragMode === DragMode.SingleWithSecondary) {
      const itemHeight = dragItem.endTime - dragItem.time;
      let maxY = newY, minY = newY;
      for (const item of column.items) {
        if (item === dragItem) {
          continue;
        }
        const from = item.time - itemHeight;
        const to = item.endTime;
        if (to >= newY && intersect(maxY, from, to)) {
          maxY = to;
        }
      }
      for (let i2 = column.items.length - 1; i2 >= 0; i2--) {
        const item = column.items[i2];
        if (item === dragItem) {
          continue;
        }
        const from = item.time - itemHeight;
        const to = item.endTime;
        if (from <= newY && intersect2(minY, from, to)) {
          minY = from;
        }
      }
      if (minY >= 0 && newY - minY <= maxY - newY) {
        newY = minY;
      } else {
        newY = maxY;
      }
      const time = newY;
      dragItem.time = time;
      dragItem.endTime = time + itemHeight;
      dragItem.dragging = true;
      let offset = time > prevTime ? 1 : -1;
      let i = index;
      let nextIndex = i + offset;
      let nextItem = column.items[nextIndex];
      while (nextItem && (time - nextItem.time) * offset > 0) {
        column.items[i] = nextItem;
        i += offset;
        nextIndex = i + offset;
        nextItem = column.items[nextIndex];
      }
      column.items[i] = dragItem;
      column.notify();
    }
    if (dragMode === DragMode.SingleWithSecondary || dragMode === DragMode.MultipleWithSecondary) {
      let offset = newY - prevTime;
      for (const item of column.secondaryCol.items) {
        if (item.dragging) {
          const itemHeight = item.endTime - item.time;
          item.time += offset;
          item.endTime = item.time + itemHeight;
        }
      }
      column.secondaryCol.notify();
    }
    notifyColumnsData();
    if (dragMode === DragMode.Single || dragMode === DragMode.SingleWithSecondary) {
      return [newX, newY * timeScale];
    }
  }
  function dragFinishItem(column, viewItem) {
    if (dragMode === DragMode.Multiple) {
      clearItemsDragging(column);
      column.notify();
    } else if (dragMode === DragMode.MultipleWithSecondary || dragMode === DragMode.SingleWithSecondary) {
      clearItemsDragging(column);
      column.notify();
      const column2 = column.isSecondary ? getPrimaryColumn(column) : column.secondaryCol;
      clearItemsDragging(column2);
      column2.notify();
    } else if (dragMode === DragMode.Single) {
      const item = column.items.find((i) => i.id === viewItem.id);
      if (!item) {
        throw new Error(`Item not found, id = '${viewItem.id}'`);
      }
      item.dragging = false;
      column.notify();
    }
    notifyColumnsData();
  }
  const columnsData = () => trackColumns(columns);
  return {
    columnsData,
    getEconomyItems,
    getPrimaryColumn,
    appendColumn,
    removeColumn,
    // moveColumn,
    appendItem,
    removeItem,
    dragStartItem,
    dragMoveItem,
    dragFinishItem
    // moveItem,
  };
}
function preloadImages() {
  for (const unitData of UnitsData.Terran) {
    const image = new Image();
    image.src = "/resources/" + unitData.icon;
  }
}
function App() {
  preloadImages();
  const [race, setRace] = signal("Terran");
  const [timeScale, setTimeScale] = signal(4);
  const unitsData = sMemo(() => UnitsData[race()]);
  function getUnitData(typeId) {
    return unitsData()[typeId];
  }
  function validateRequirement(requirement, items, isSecondary, foundReqFn = noopFn) {
    if (requirement === COL_PRIMARY) {
      return !isSecondary;
    }
    if (requirement === COL_SECONDARY) {
      return isSecondary;
    }
    if (requirement === EMPTY) {
      return items.length === 0;
    }
    if (Array.isArray(requirement)) {
      const operator = requirement[0];
      if (operator === NO) {
        return !validateRequirement(requirement[1], items, isSecondary);
      }
      if (operator === AND) {
        return requirement.slice(1).every((req) => validateRequirement(req, items, isSecondary, foundReqFn));
      }
      if (operator === OR) {
        const reqs = requirement.slice(1);
        const hasEmpty = reqs.some((req) => req === EMPTY);
        return reqs.some((req) => validateRequirement(req, items, isSecondary, hasEmpty ? noopFn : foundReqFn));
      }
      throw Error(`Wrong condition type: '${operator}'`);
    } else {
      return items.some((item) => {
        const unitData = getUnitData(item.typeId);
        const productionUnitData = item.productionTypeId ? getUnitData(item.productionTypeId) : void 0;
        if (unitData.category === requirement || unitData.name === requirement || productionUnitData && productionUnitData.name === requirement) {
          foundReqFn(item);
          return true;
        }
        return false;
      });
    }
  }
  const [isShowPalette, setIsShowPalette] = signal(false);
  const buttonCategoryMap = {};
  let i = 0;
  for (const buttonCategory of ButtonCategories) {
    for (const category of buttonCategory.categories) {
      buttonCategoryMap[category] = i;
    }
    i++;
  }
  const [buttonCategories, notifyButtons] = notifiableStore((track) => ButtonCategories.map((c, i2) => {
    const buttons = {
      title: c.title,
      buttons: [],
      getButtons: () => track(buttons.buttons),
      hasButtons: () => track(buttons.buttons.length > 0)
    };
    return buttons;
  }));
  let selectedColumn;
  let selectedColumnEl;
  function updateButtons() {
    let typeId = 0;
    buttonCategories.forEach((buttonCategory) => buttonCategory.buttons = []);
    for (const unitData of unitsData()) {
      const hasRequirements = validateRequirement(unitData.requirement, selectedColumn.items, selectedColumn.isSecondary);
      const isVisible = unitData.visible ? validateRequirement(unitData.visible, selectedColumn.items, selectedColumn.isSecondary) : false;
      if (hasRequirements || isVisible) {
        const isDisabled = !hasRequirements;
        const buttonCategory = buttonCategoryMap[unitData.category];
        buttonCategories[buttonCategory].buttons.push({
          key: typeId + ":" + isDisabled,
          typeId,
          name: unitData.name,
          icon: unitData.icon,
          isDisabled
        });
      }
      typeId++;
    }
    notifyButtons();
  }
  function setSelectedColumn(column, columnEl = void 0) {
    if (selectedColumn === column) {
      return;
    }
    if (selectedColumnEl) {
      selectedColumnEl.classList.remove("selected-column");
    }
    if (columnEl) {
      columnEl.classList.add("selected-column");
    }
    selectedColumn = column;
    selectedColumnEl = columnEl;
    if (!column) {
      setIsShowPalette(false);
      return;
    }
    updateButtons();
    setIsShowPalette(true);
  }
  function columnRemoved(column) {
    if (selectedColumn === column) {
      setSelectedColumn(void 0);
    }
  }
  const {
    columnsData,
    getEconomyItems,
    getPrimaryColumn,
    appendColumn,
    appendItem,
    removeItem,
    dragStartItem,
    dragMoveItem,
    dragFinishItem
  } = ProductionColumnsData(validateRequirement, columnRemoved, getUnitData, () => untrack(timeScale), [
    [{
      name: "Command center",
      typeId: 0,
      time: 0,
      fixed: true
    }, {
      name: "SCV",
      typeId: 1,
      time: 0
    }, {
      name: "SCV",
      typeId: 1,
      time: 12
    }, {
      name: "SCV",
      typeId: 1,
      time: 24
    }],
    [],
    [],
    [],
    [],
    [
      {
        name: "Barracks",
        typeId: 6,
        time: 40 + 8
      },
      {
        name: "Marine",
        typeId: 20,
        time: 40 + 8 + 46
      }
      /* {
      	name: 'Marine', typeId: 20,
      	time: 8 + 46 + 18,
      },
      {
      	name: 'Marine', typeId: 20,
      	time: 8 + 46 + 18 + 18,
      }, */
    ],
    /* [
    	{
    		name: 'Barracks', typeId: 6,
    		time: 0,
    	},
    	{
    		name: 'Marine', typeId: 20,
    		time: 46,
    	},
    	{
    		name: 'Marine', typeId: 20,
    		time: 46 + 18,
    	},
    	{
    		name: 'Marine', typeId: 20,
    		time: 46 + 18 + 18,
    	},
    ], */
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    []
  ]);
  function handleRemoveItem(column, item) {
    removeItem(column, item);
    if (selectedColumn && selectedColumn.id === column.id) {
      updateButtons();
    }
  }
  function handleAppendItem(typeId) {
    if (selectedColumn) {
      appendItem(selectedColumn, typeId);
      updateButtons();
    }
  }
  const panelProductionEl = document.getElementById("panel-production");
  delegateEvent(panelProductionEl, ".production-button-add-item", "click", (el) => el.clickAppendItem(el));
  delegateEvent(panelProductionEl, ".production-item", "contextmenu", (el, event) => el.clickRemoveItem(event));
  render(ProductionColumns, document.getElementById("production-columns"), {
    columns: columnsData,
    getPrimaryColumn,
    removeItem: handleRemoveItem,
    dragStartItem,
    dragMoveItem,
    dragFinishItem,
    setSelectedColumn
  });
  render(PanelIncome, document.getElementById("panel-income"), {
    getEconomyItems
  });
  render(PanelItemsPalette, document.getElementById("panel-items-palette"), {
    buttonCategories,
    isShow: isShowPalette,
    appendItem: handleAppendItem,
    onClose: () => setSelectedColumn(void 0)
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", App);
} else {
  App();
}
