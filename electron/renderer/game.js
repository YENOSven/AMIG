import Phaser from "phaser";

const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 720;
const BASE_Y = WORLD_HEIGHT / 2;
const HOST_BASE_X = 105;
const GUEST_BASE_X = WORLD_WIDTH - 105;
const STARTING_CREDITS = 350;
const MAX_CREDITS = 9999;
const INCOME_PER_SECOND = 22;
const SNAPSHOT_INTERVAL = 100;
const MAX_UNITS_PER_TEAM = 30;

const UNIT_TYPES = {
  soldier: {
    label: "Soldier",
    cost: 100,
    health: 120,
    damage: 16,
    range: 55,
    speed: 82,
    cooldown: 650,
    radius: 13,
  },
  ranger: {
    label: "Ranger",
    cost: 160,
    health: 80,
    damage: 24,
    range: 175,
    speed: 72,
    cooldown: 900,
    radius: 11,
  },
  tank: {
    label: "Tank",
    cost: 280,
    health: 360,
    damage: 42,
    range: 75,
    speed: 45,
    cooldown: 1250,
    radius: 18,
  },
};

const TEAM_COLORS = {
  host: 0x58e6c2,
  guest: 0xff647c,
};

function clampPoint(x, y) {
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;

  return {
    x: Phaser.Math.Clamp(Number(x), 45, WORLD_WIDTH - 45),
    y: Phaser.Math.Clamp(Number(y), 75, WORLD_HEIGHT - 45),
  };
}

class BattleScene extends Phaser.Scene {
  constructor(options) {
    super("battle");
    this.options = options;
    this.isAuthority = options.mode === "bot" || options.role === "host";
    this.localTeam = options.mode === "bot" ? "host" : options.role;
    this.remoteTeam = this.localTeam === "host" ? "guest" : "host";
    this.units = new Map();
    this.unitViews = new Map();
    this.selectedIds = new Set();
    this.credits = { host: STARTING_CREDITS, guest: STARTING_CREDITS };
    this.baseHealth = { host: 1200, guest: 1200 };
    this.baseMaxHealth = 1200;
    this.nextUnitId = 1;
    this.lastSnapshotAt = 0;
    this.lastIncomeAt = 0;
    this.lastAiPurchaseAt = 0;
    this.lastAiCommandAt = 0;
    this.finished = false;
  }

  create() {
    this.drawArena();
    this.createBases();
    this.createSelectionMarker();
    this.registerInput();
    this.registerGameEvents();
    this.registerNetworkEvents();
    this.updateHud();

    this.add
      .text(22, 18, "Left click units to select | Right click to move/attack | Esc returns to menu", {
        color: "#dbeafe",
        fontFamily: "system-ui",
        fontSize: "15px",
      })
      .setDepth(20);

    if (this.isAuthority) {
      this.spawnUnit("host", "soldier");
      this.spawnUnit("guest", "soldier");
      this.broadcastSnapshot(true);
    } else {
      this.options.sendCommand?.({ action: "ready" });
    }
  }

  drawArena() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x101827, 1);
    graphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    graphics.lineStyle(1, 0x26364d, 0.62);

    for (let x = 0; x <= WORLD_WIDTH; x += 64) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }

    for (let y = 0; y <= WORLD_HEIGHT; y += 64) {
      graphics.lineBetween(0, y, WORLD_WIDTH, y);
    }

    graphics.lineStyle(2, 0x33445f, 0.7);
    graphics.lineBetween(WORLD_WIDTH / 2, 65, WORLD_WIDTH / 2, WORLD_HEIGHT);
  }

  createBases() {
    this.baseViews = {};

    for (const team of ["host", "guest"]) {
      const x = team === "host" ? HOST_BASE_X : GUEST_BASE_X;
      const color = TEAM_COLORS[team];
      const body = this.add.rectangle(x, BASE_Y, 95, 180, color, 0.24).setStrokeStyle(4, color);
      const core = this.add.circle(x, BASE_Y, 27, color, 0.9);
      const healthBack = this.add.rectangle(x, BASE_Y - 118, 130, 12, 0x172033);
      const healthFill = this.add.rectangle(x - 65, BASE_Y - 118, 130, 12, color).setOrigin(0, 0.5);
      const label = this.add
        .text(x, BASE_Y + 112, team === "host" ? "HOST BASE" : "GUEST BASE", {
          color: "#dbeafe",
          fontFamily: "system-ui",
          fontSize: "14px",
          fontStyle: "bold",
        })
        .setOrigin(0.5);

      this.baseViews[team] = { body, core, healthBack, healthFill, label };
    }
  }

  createSelectionMarker() {
    this.selectionMarker = this.add.graphics().setDepth(12);
  }

  registerInput() {
    this.input.on("pointerdown", (pointer) => {
      if (this.finished) return;

      if (pointer.rightButtonDown()) {
        this.issueMoveCommand(pointer.worldX, pointer.worldY);
        return;
      }

      const unit = this.findUnitAt(pointer.worldX, pointer.worldY, this.localTeam);
      const additive = Boolean(pointer.event?.shiftKey);

      if (!additive) this.selectedIds.clear();
      if (unit) {
        if (additive && this.selectedIds.has(unit.id)) {
          this.selectedIds.delete(unit.id);
        } else {
          this.selectedIds.add(unit.id);
        }
      }

      this.redrawSelection();
      this.updateHud();
    });

    this.input.mouse?.disableContextMenu();
    this.input.keyboard.on("keydown-ESC", () => this.options.onExit?.());
    this.input.keyboard.on("keydown-A", () => this.selectAllLocalUnits());
    this.purchaseKeys = this.input.keyboard.addKeys({
      soldier: Phaser.Input.Keyboard.KeyCodes.ONE,
      ranger: Phaser.Input.Keyboard.KeyCodes.TWO,
      tank: Phaser.Input.Keyboard.KeyCodes.THREE,
    });
  }

  registerGameEvents() {
    this.game.events.on("buy-unit", this.requestPurchase, this);
    this.game.events.on("select-all-units", this.selectAllLocalUnits, this);
    this.events.once("shutdown", () => {
      this.game.events.off("buy-unit", this.requestPurchase, this);
      this.game.events.off("select-all-units", this.selectAllLocalUnits, this);
    });
  }

  registerNetworkEvents() {
    this.options.onCommand?.((command) => {
      if (!this.isAuthority || this.options.mode !== "friend") return;
      this.applyCommand("guest", command);
    });

    this.options.onState?.((snapshot) => {
      if (this.isAuthority || !this.isValidSnapshot(snapshot)) return;
      this.applySnapshot(snapshot);
    });
  }

  requestPurchase(type) {
    if (!UNIT_TYPES[type] || this.finished) return;

    if (this.isAuthority) {
      this.applyCommand(this.localTeam, { action: "buy", type });
    } else {
      this.options.sendCommand?.({ action: "buy", type });
    }
  }

  issueMoveCommand(x, y) {
    const unitIds = [...this.selectedIds];
    if (unitIds.length === 0) return;

    const target = clampPoint(x, y);
    if (!target) return;
    const command = {
      action: "move",
      unitIds: unitIds.slice(0, MAX_UNITS_PER_TEAM),
      x: target.x,
      y: target.y,
    };

    if (this.isAuthority) {
      this.applyCommand(this.localTeam, command);
    } else {
      this.options.sendCommand?.(command);
    }
  }

  applyCommand(team, command) {
    if (!command || typeof command.action !== "string" || this.finished) return;

    if (command.action === "buy" && UNIT_TYPES[command.type]) {
      this.buyUnit(team, command.type);
      return;
    }

    if (command.action === "move" && Array.isArray(command.unitIds)) {
      const target = clampPoint(command.x, command.y);
      if (!target) return;
      const ownedUnits = command.unitIds
        .slice(0, MAX_UNITS_PER_TEAM)
        .map((id) => this.units.get(String(id)))
        .filter((unit) => unit?.team === team);

      ownedUnits.forEach((unit, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const direction = team === "host" ? -1 : 1;
        unit.order = {
          x: Phaser.Math.Clamp(target.x + direction * row * 24, 45, WORLD_WIDTH - 45),
          y: Phaser.Math.Clamp(target.y + (column - 1.5) * 26, 75, WORLD_HEIGHT - 45),
        };
      });
    }
  }

  buyUnit(team, type) {
    const definition = UNIT_TYPES[type];
    const teamCount = [...this.units.values()].filter((unit) => unit.team === team).length;

    if (!definition || this.credits[team] < definition.cost || teamCount >= MAX_UNITS_PER_TEAM) {
      return false;
    }

    this.credits[team] -= definition.cost;
    this.spawnUnit(team, type);
    this.updateHud();
    return true;
  }

  spawnUnit(team, type) {
    const definition = UNIT_TYPES[type];
    const id = String(this.nextUnitId++);
    const teamCount = [...this.units.values()].filter((unit) => unit.team === team).length;
    const laneOffset = ((teamCount % 7) - 3) * 27;
    const x = team === "host" ? HOST_BASE_X + 82 : GUEST_BASE_X - 82;

    const unit = {
      id,
      team,
      type,
      x,
      y: BASE_Y + laneOffset,
      health: definition.health,
      maxHealth: definition.health,
      order: null,
      lastAttackAt: 0,
    };

    this.units.set(id, unit);
    this.createUnitView(unit);
    return unit;
  }

  createUnitView(unit) {
    const definition = UNIT_TYPES[unit.type];
    const color = TEAM_COLORS[unit.team];
    const body = this.add.circle(unit.x, unit.y, definition.radius, color, 0.95).setDepth(5);
    const ring = this.add.circle(unit.x, unit.y, definition.radius + 4, color, 0).setStrokeStyle(2, color, 0.4).setDepth(4);
    const healthBack = this.add.rectangle(unit.x, unit.y - definition.radius - 9, definition.radius * 2.2, 4, 0x111827).setDepth(6);
    const healthFill = this.add
      .rectangle(unit.x - definition.radius * 1.1, unit.y - definition.radius - 9, definition.radius * 2.2, 4, color)
      .setOrigin(0, 0.5)
      .setDepth(7);

    this.unitViews.set(unit.id, { body, ring, healthBack, healthFill });
  }

  destroyUnitView(id) {
    const view = this.unitViews.get(id);
    if (!view) return;
    Object.values(view).forEach((displayObject) => displayObject.destroy());
    this.unitViews.delete(id);
    this.selectedIds.delete(id);
  }

  findUnitAt(x, y, team) {
    let nearest = null;
    let nearestDistance = 30;

    for (const unit of this.units.values()) {
      if (unit.team !== team) continue;
      const distance = Phaser.Math.Distance.Between(x, y, unit.x, unit.y);
      if (distance < nearestDistance) {
        nearest = unit;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  selectAllLocalUnits() {
    this.selectedIds = new Set(
      [...this.units.values()].filter((unit) => unit.team === this.localTeam).map((unit) => unit.id)
    );
    this.redrawSelection();
    this.updateHud();
  }

  update(time, delta) {
    if (this.finished) return;

    if (Phaser.Input.Keyboard.JustDown(this.purchaseKeys.soldier)) this.requestPurchase("soldier");
    if (Phaser.Input.Keyboard.JustDown(this.purchaseKeys.ranger)) this.requestPurchase("ranger");
    if (Phaser.Input.Keyboard.JustDown(this.purchaseKeys.tank)) this.requestPurchase("tank");

    if (this.isAuthority) {
      this.updateEconomy(time);
      this.updateUnits(time, delta);
      if (this.options.mode === "bot") this.updateBotCommander(time);
      this.checkVictory();

      if (time - this.lastSnapshotAt >= SNAPSHOT_INTERVAL) {
        this.broadcastSnapshot();
        this.lastSnapshotAt = time;
      }
    }

    this.syncViews();
  }

  updateEconomy(time) {
    if (!this.lastIncomeAt) this.lastIncomeAt = time;
    const elapsed = time - this.lastIncomeAt;
    if (elapsed < 250) return;

    const income = INCOME_PER_SECOND * (elapsed / 1000);
    this.credits.host = Math.min(MAX_CREDITS, this.credits.host + income);
    this.credits.guest = Math.min(MAX_CREDITS, this.credits.guest + income);
    this.lastIncomeAt = time;
    this.updateHud();
  }

  updateUnits(time, delta) {
    const deltaSeconds = Math.min(delta, 50) / 1000;

    for (const unit of [...this.units.values()]) {
      const definition = UNIT_TYPES[unit.type];
      const target = this.findCombatTarget(unit);

      if (target && target.distance <= definition.range) {
        if (time - unit.lastAttackAt >= definition.cooldown) {
          unit.lastAttackAt = time;
          this.damageTarget(target, definition.damage);
          this.showAttackPulse(unit, target);
        }
        continue;
      }

      const destination = unit.order || this.defaultDestination(unit);
      this.moveUnitToward(unit, destination.x, destination.y, definition.speed, deltaSeconds);
    }
  }

  findCombatTarget(unit) {
    const enemyTeam = unit.team === "host" ? "guest" : "host";
    let closest = null;

    for (const enemy of this.units.values()) {
      if (enemy.team !== enemyTeam) continue;
      const distance = Phaser.Math.Distance.Between(unit.x, unit.y, enemy.x, enemy.y);
      if (!closest || distance < closest.distance) {
        closest = { kind: "unit", entity: enemy, x: enemy.x, y: enemy.y, distance };
      }
    }

    const baseX = enemyTeam === "host" ? HOST_BASE_X : GUEST_BASE_X;
    const baseDistance = Math.max(0, Phaser.Math.Distance.Between(unit.x, unit.y, baseX, BASE_Y) - 48);
    if (!closest || baseDistance < closest.distance) {
      closest = { kind: "base", team: enemyTeam, x: baseX, y: BASE_Y, distance: baseDistance };
    }

    return closest;
  }

  defaultDestination(unit) {
    return {
      x: unit.team === "host" ? GUEST_BASE_X : HOST_BASE_X,
      y: BASE_Y,
    };
  }

  moveUnitToward(unit, x, y, speed, deltaSeconds) {
    const distance = Phaser.Math.Distance.Between(unit.x, unit.y, x, y);
    if (distance < 5) return;
    const step = Math.min(distance, speed * deltaSeconds);
    unit.x += ((x - unit.x) / distance) * step;
    unit.y += ((y - unit.y) / distance) * step;
  }

  damageTarget(target, damage) {
    if (target.kind === "unit") {
      target.entity.health -= damage;
      if (target.entity.health <= 0) {
        this.units.delete(target.entity.id);
        this.destroyUnitView(target.entity.id);
      }
    } else {
      this.baseHealth[target.team] = Math.max(0, this.baseHealth[target.team] - damage);
    }
  }

  showAttackPulse(unit, target) {
    const line = this.add
      .line(0, 0, unit.x, unit.y, target.x, target.y, TEAM_COLORS[unit.team], 0.8)
      .setOrigin(0)
      .setDepth(3);
    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 110,
      onComplete: () => line.destroy(),
    });
  }

  updateBotCommander(time) {
    if (time - this.lastAiPurchaseAt > 1300) {
      const affordable = ["tank", "ranger", "soldier"].find(
        (type) => this.credits.guest >= UNIT_TYPES[type].cost
      );
      if (affordable) this.buyUnit("guest", affordable);
      this.lastAiPurchaseAt = time;
    }

    if (time - this.lastAiCommandAt > 2200) {
      const unitIds = [...this.units.values()]
        .filter((unit) => unit.team === "guest")
        .map((unit) => unit.id);
      this.applyCommand("guest", {
        action: "move",
        unitIds,
        x: HOST_BASE_X + 80,
        y: Phaser.Math.Between(220, 500),
      });
      this.lastAiCommandAt = time;
    }
  }

  checkVictory() {
    const defeatedTeam = this.baseHealth.host <= 0 ? "host" : this.baseHealth.guest <= 0 ? "guest" : null;
    if (!defeatedTeam) return;

    this.finished = true;
    const winner = defeatedTeam === "host" ? "guest" : "host";
    this.broadcastSnapshot(true, winner);
    this.showResult(winner);
  }

  showResult(winner) {
    const won = winner === this.localTeam;
    const overlay = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0x05080e, 0.82).setDepth(40);
    const title = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 25, won ? "VICTORY" : "DEFEAT", {
        color: won ? "#58e6c2" : "#ff647c",
        fontFamily: "system-ui",
        fontSize: "64px",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(41);
    const subtitle = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 45, "Press Esc to return to the menu", {
        color: "#dbeafe",
        fontFamily: "system-ui",
        fontSize: "19px",
      })
      .setOrigin(0.5)
      .setDepth(41);
    overlay.setInteractive();
    void title;
    void subtitle;
  }

  syncViews() {
    for (const unit of this.units.values()) {
      if (!this.unitViews.has(unit.id)) this.createUnitView(unit);
      const view = this.unitViews.get(unit.id);
      const definition = UNIT_TYPES[unit.type];
      const healthRatio = Phaser.Math.Clamp(unit.health / unit.maxHealth, 0, 1);
      const smoothing = this.isAuthority ? 1 : 1 - Math.exp(-18 * (this.game.loop.delta / 1000));
      const viewX = Phaser.Math.Linear(view.body.x, unit.x, smoothing);
      const viewY = Phaser.Math.Linear(view.body.y, unit.y, smoothing);

      view.body.setPosition(viewX, viewY);
      view.ring.setPosition(viewX, viewY);
      view.healthBack.setPosition(viewX, viewY - definition.radius - 9);
      view.healthFill.setPosition(viewX - definition.radius * 1.1, viewY - definition.radius - 9);
      view.healthFill.width = definition.radius * 2.2 * healthRatio;
    }

    for (const id of [...this.unitViews.keys()]) {
      if (!this.units.has(id)) this.destroyUnitView(id);
    }

    for (const team of ["host", "guest"]) {
      const ratio = Phaser.Math.Clamp(this.baseHealth[team] / this.baseMaxHealth, 0, 1);
      this.baseViews[team].healthFill.width = 130 * ratio;
    }

    this.redrawSelection();
  }

  redrawSelection() {
    this.selectionMarker.clear();
    this.selectionMarker.lineStyle(2, 0xffffff, 0.9);

    for (const id of this.selectedIds) {
      const unit = this.units.get(id);
      if (!unit || unit.team !== this.localTeam) continue;
      const view = this.unitViews.get(id);
      this.selectionMarker.strokeCircle(
        view?.body.x ?? unit.x,
        view?.body.y ?? unit.y,
        UNIT_TYPES[unit.type].radius + 7
      );
    }
  }

  updateHud() {
    const selected = [...this.selectedIds].filter((id) => this.units.get(id)?.team === this.localTeam).length;
    this.options.onHud?.({
      credits: Math.floor(this.credits[this.localTeam]),
      baseHealth: Math.ceil(this.baseHealth[this.localTeam]),
      enemyBaseHealth: Math.ceil(this.baseHealth[this.remoteTeam]),
      selected,
      costs: Object.fromEntries(Object.entries(UNIT_TYPES).map(([key, value]) => [key, value.cost])),
    });
  }

  createSnapshot(winner = null) {
    return {
      version: 1,
      sentAt: Date.now(),
      credits: {
        host: Math.floor(this.credits.host),
        guest: Math.floor(this.credits.guest),
      },
      baseHealth: { ...this.baseHealth },
      units: [...this.units.values()].map((unit) => ({
        id: unit.id,
        team: unit.team,
        type: unit.type,
        x: Math.round(unit.x * 10) / 10,
        y: Math.round(unit.y * 10) / 10,
        health: Math.max(0, Math.round(unit.health)),
        maxHealth: unit.maxHealth,
      })),
      winner,
    };
  }

  broadcastSnapshot(force = false, winner = null) {
    if (this.options.mode !== "friend" || !this.options.sendState) return;
    this.options.sendState?.(this.createSnapshot(winner));
  }

  isValidSnapshot(snapshot) {
    return (
      snapshot?.version === 1 &&
      snapshot.credits &&
      snapshot.baseHealth &&
      Array.isArray(snapshot.units) &&
      snapshot.units.length <= MAX_UNITS_PER_TEAM * 2
    );
  }

  applySnapshot(snapshot) {
    this.credits = {
      host: Number(snapshot.credits.host) || 0,
      guest: Number(snapshot.credits.guest) || 0,
    };
    this.baseHealth = {
      host: Phaser.Math.Clamp(Number(snapshot.baseHealth.host) || 0, 0, this.baseMaxHealth),
      guest: Phaser.Math.Clamp(Number(snapshot.baseHealth.guest) || 0, 0, this.baseMaxHealth),
    };

    const nextIds = new Set();
    for (const incoming of snapshot.units) {
      if (!UNIT_TYPES[incoming.type] || !["host", "guest"].includes(incoming.team)) continue;
      const id = String(incoming.id);
      nextIds.add(id);
      const existing = this.units.get(id);
      const sanitized = {
        id,
        team: incoming.team,
        type: incoming.type,
        x: Phaser.Math.Clamp(Number(incoming.x), 0, WORLD_WIDTH),
        y: Phaser.Math.Clamp(Number(incoming.y), 60, WORLD_HEIGHT),
        health: Math.max(0, Number(incoming.health)),
        maxHealth: UNIT_TYPES[incoming.type].health,
        order: null,
        lastAttackAt: 0,
      };

      if (existing) {
        Object.assign(existing, sanitized);
      } else {
        this.units.set(id, sanitized);
      }
    }

    for (const id of [...this.units.keys()]) {
      if (!nextIds.has(id)) {
        this.units.delete(id);
        this.destroyUnitView(id);
      }
    }

    this.updateHud();
    if (snapshot.winner && !this.finished) {
      this.finished = true;
      this.showResult(snapshot.winner);
    }
  }
}

export function createGame(parent, options) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#101827",
    scale: {
      autoCenter: Phaser.Scale.CENTER_BOTH,
      mode: Phaser.Scale.FIT,
    },
    scene: new BattleScene(options),
  });
}
