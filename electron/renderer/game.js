import Phaser from "phaser";

const ASSET_URLS = {
  soldier: new URL("./assets/generated/soldier.png", import.meta.url).href,
  ranger: new URL("./assets/generated/ranger.png", import.meta.url).href,
  tank: new URL("./assets/generated/tank.png", import.meta.url).href,
  medic: new URL("./assets/generated/soldier.png", import.meta.url).href,
  artillery: new URL("./assets/generated/tank.png", import.meta.url).href,
};

const WORLD_WIDTH = 2800;
const WORLD_HEIGHT = 1600;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const EDGE_SCROLL_MARGIN = 120;
const CAMERA_SCROLL_MIN_SPEED = 220;
const CAMERA_SCROLL_MAX_SPEED = 1050;
const CAMERA_ACCELERATION = 10;
const BASE_Y = WORLD_HEIGHT / 2;
const HOST_BASE_X = 150;
const GUEST_BASE_X = WORLD_WIDTH - 150;
const STARTING_CREDITS = 300;
const MAX_CREDITS = 9999;
const INCOME_PER_SECOND = 14;
const MINE_INCOME_PER_SECOND = 6;
const MINE_MAX_HEALTH = 800;
const SNAPSHOT_INTERVAL = 125;
const AUTO_COMMAND_INTERVAL = 1600;
const MAX_UNITS_PER_TEAM = 20;
const MAX_COMBAT_EFFECTS = 56;
const TACTICAL_COOLDOWN = 14000;
const SURGE_DURATION = 5000;
const BRACE_DURATION = 5500;
const FOCUS_DURATION = 6000;
const MINE_DEFINITIONS = [
  { id: "top", x: WORLD_WIDTH / 2, y: 220, label: "NORTH MINE" },
  { id: "upper-left", x: WORLD_WIDTH / 2 - 460, y: 500, label: "NORTHWEST MINE" },
  { id: "upper-right", x: WORLD_WIDTH / 2 + 460, y: 500, label: "NORTHEAST MINE" },
  { id: "center", x: WORLD_WIDTH / 2, y: BASE_Y, label: "CENTER MINE" },
  { id: "lower-left", x: WORLD_WIDTH / 2 - 460, y: 1100, label: "SOUTHWEST MINE" },
  { id: "lower-right", x: WORLD_WIDTH / 2 + 460, y: 1100, label: "SOUTHEAST MINE" },
  { id: "bottom", x: WORLD_WIDTH / 2, y: WORLD_HEIGHT - 220, label: "SOUTH MINE" },
];

const UNIT_TYPES = {
  soldier: {
    label: "Soldier",
    cost: 100,
    strategicPower: 100,
    health: 145,
    damage: 14,
    range: 46,
    speed: 84,
    cooldown: 650,
    radius: 13,
    rangerPinDuration: 850,
    rangerDisruptDuration: 500,
  },
  ranger: {
    label: "Ranger",
    cost: 155,
    strategicPower: 155,
    health: 95,
    damage: 23,
    range: 210,
    preferredRange: 165,
    retreatRange: 105,
    speed: 50,
    cooldown: 950,
    radius: 11,
    armorPiercing: true,
  },
  tank: {
    label: "Tank",
    cost: 240,
    strategicPower: 240,
    health: 430,
    damage: 18,
    range: 54,
    speed: 58,
    cooldown: 1150,
    radius: 20,
    armor: 6,
    controlRadius: 86,
    soldierSpeedFactor: 0.62,
    soldierKnockback: 20,
  },
  medic: {
    label: "Medic",
    cost: 165,
    strategicPower: 165,
    health: 105,
    damage: 7,
    range: 125,
    speed: 62,
    cooldown: 1100,
    radius: 11,
    heal: 18,
    healRange: 140,
    supportSearchRange: 360,
    preferredRange: 120,
  },
  artillery: {
    label: "Artillery",
    cost: 270,
    strategicPower: 270,
    health: 120,
    damage: 34,
    range: 330,
    minimumRange: 135,
    preferredRange: 270,
    speed: 40,
    cooldown: 2100,
    radius: 17,
    splashRadius: 66,
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
    this.baseHealth = { host: 1600, guest: 1600 };
    this.baseMaxHealth = 1600;
    this.mines = new Map(
      MINE_DEFINITIONS.map((mine) => [
        mine.id,
        {
          ...mine,
          owner: null,
          health: MINE_MAX_HEALTH,
          maxHealth: MINE_MAX_HEALTH,
        },
      ])
    );
    this.nextUnitId = 1;
    this.lastSnapshotAt = 0;
    this.lastIncomeAt = 0;
    this.lastAiPurchaseAt = { host: 0, guest: 0 };
    this.lastAutoCommandAt = 0;
    this.automation = { host: true, guest: true };
    this.processedRemoteCommandIds = new Set();
    this.finished = false;
    this.lastCommandMarker = null;
    this.cameraVelocity = { x: 0, y: 0 };
    this.canvasPointer = { inside: false, x: 0, y: 0, width: 0, height: 0 };
    this.unitContext = null;
    this.lastSelectionDrawAt = 0;
    this.pendingLocalHolds = new Map();
    this.activeCombatEffects = 0;
    this.lastAppliedSnapshotAt = 0;
    this.statusMessage = "Commander ready";
    this.statusTone = "neutral";
    this.statusUntil = 0;
    this.lastHudSignature = "";
    this.keyboardMineIndex = -1;
    this.roundId = 1;
    this.resultObjects = [];
  }

  preload() {
    for (const [key, url] of Object.entries(ASSET_URLS)) {
      this.load.image(`unit-${key}`, url);
    }
  }

  create() {
    this.drawArena();
    this.createBases();
    this.createMines();
    this.createSelectionMarker();
    this.configureCamera();
    this.registerInput();
    this.registerGameEvents();
    this.registerNetworkEvents();
    this.updateHud();

    this.cameraHelp = this.add
      .text(16, 14, "Move pointer to an edge or use arrow keys to scroll", {
        color: "#dbeafe",
        fontFamily: "system-ui",
        fontSize: "14px",
        backgroundColor: "rgba(5, 9, 16, 0.72)",
        padding: { x: 10, y: 7 },
      })
      .setScrollFactor(0)
      .setDepth(30);
    this.tweens.add({
      targets: this.cameraHelp,
      alpha: 0,
      delay: 6500,
      duration: 900,
      ease: "Sine.Out",
    });

    if (this.isAuthority) {
      this.spawnUnit("host", "soldier");
      this.spawnUnit("guest", "soldier");
      this.broadcastSnapshot(true);
    } else {
      this.options.sendCommand?.({ action: "ready" });
    }
  }

  configureCamera() {
    const camera = this.cameras.main;
    const canvas = this.game.canvas;
    const cameraSurface = canvas.parentElement;
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    camera.roundPixels = true;
    this.centerCameraOnLocalBase();

    this.handleCanvasPointerMove = (event) => {
      const bounds = cameraSurface.getBoundingClientRect();
      this.canvasPointer = {
        inside:
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom,
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        width: bounds.width,
        height: bounds.height,
      };
    };
    this.handleCanvasPointerLeave = () => {
      this.canvasPointer.inside = false;
    };
    cameraSurface.addEventListener("pointermove", this.handleCanvasPointerMove, { passive: true });
    cameraSurface.addEventListener("pointerleave", this.handleCanvasPointerLeave, { passive: true });

    this.scale.on("resize", this.handleResize, this);
    this.events.once("shutdown", () => {
      this.scale.off("resize", this.handleResize, this);
      cameraSurface.removeEventListener("pointermove", this.handleCanvasPointerMove);
      cameraSurface.removeEventListener("pointerleave", this.handleCanvasPointerLeave);
    });
  }

  centerCameraOnLocalBase() {
    const camera = this.cameras.main;
    const direction = this.localTeam === "host" ? 1 : -1;
    const baseX = this.localTeam === "host" ? HOST_BASE_X : GUEST_BASE_X;
    const horizontalLead = Math.min(520, camera.width * 0.34);
    camera.centerOn(baseX + direction * horizontalLead, BASE_Y);
  }

  handleResize(gameSize) {
    const camera = this.cameras.main;
    if (gameSize?.width && gameSize?.height) {
      camera.setSize(gameSize.width, gameSize.height);
    }
    camera.setScroll(camera.clampX(camera.scrollX), camera.clampY(camera.scrollY));
  }

  drawArena() {
    const graphics = this.add.graphics();
    graphics.fillGradientStyle(0x0c1422, 0x0c1422, 0x151c2b, 0x151c2b, 1);
    graphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    graphics.lineStyle(1, 0x26364d, 0.34);

    for (let x = 0; x <= WORLD_WIDTH; x += 80) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }

    for (let y = 0; y <= WORLD_HEIGHT; y += 80) {
      graphics.lineBetween(0, y, WORLD_WIDTH, y);
    }

    graphics.fillStyle(0x58e6c2, 0.035);
    graphics.fillRect(0, 0, WORLD_WIDTH / 2, WORLD_HEIGHT);
    graphics.fillStyle(0xff647c, 0.035);
    graphics.fillRect(WORLD_WIDTH / 2, 0, WORLD_WIDTH / 2, WORLD_HEIGHT);

    graphics.lineStyle(2, 0x50617b, 0.45);
    graphics.lineBetween(WORLD_WIDTH / 2, 65, WORLD_WIDTH / 2, WORLD_HEIGHT);
    graphics.lineStyle(1, 0x50617b, 0.18);
    graphics.strokeRoundedRect(45, 70, WORLD_WIDTH - 90, WORLD_HEIGHT - 115, 28);

    for (const mine of MINE_DEFINITIONS) {
      graphics.lineStyle(1, 0xf6c453, 0.12);
      graphics.strokeCircle(mine.x, mine.y, 105);
      graphics.strokeCircle(mine.x, mine.y, 135);
    }
  }

  createBases() {
    this.baseViews = {};

    for (const team of ["host", "guest"]) {
      const x = team === "host" ? HOST_BASE_X : GUEST_BASE_X;
      const color = TEAM_COLORS[team];
      const platform = this.add.circle(x, BASE_Y, 82, 0x080d16, 0.88).setStrokeStyle(3, color, 0.38);
      const body = this.add.rectangle(x, BASE_Y, 105, 190, color, 0.18).setStrokeStyle(4, color);
      const inner = this.add.rectangle(x, BASE_Y, 72, 148, 0x111827, 0.95).setStrokeStyle(2, color, 0.55);
      const core = this.add.circle(x, BASE_Y, 29, color, 0.95).setStrokeStyle(7, 0xffffff, 0.11);
      const antenna = this.add.rectangle(x, BASE_Y - 70, 8, 52, color, 0.75);
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

      this.tweens.add({
        targets: core,
        scale: 1.16,
        alpha: 0.72,
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });

      this.baseViews[team] = { platform, body, inner, core, antenna, healthBack, healthFill, label };
    }
  }

  createMines() {
    this.mineViews = new Map();

    for (const mine of this.mines.values()) {
      const zone = this.add.circle(mine.x, mine.y, 58, 0xf6c453, 0.07).setStrokeStyle(2, 0xf6c453, 0.35);
      const orbit = this.add.circle(mine.x, mine.y, 42, 0xf6c453, 0).setStrokeStyle(2, 0xf6c453, 0.3);
      const body = this.add.polygon(
        mine.x,
        mine.y,
        [0, -28, 25, -13, 25, 15, 0, 31, -25, 15, -25, -13],
        0xf6c453,
        0.9
      );
      const core = this.add.circle(mine.x, mine.y, 10, 0xffec99, 1);
      const healthBack = this.add.rectangle(mine.x, mine.y - 48, 90, 8, 0x172033);
      const healthFill = this.add.rectangle(mine.x - 45, mine.y - 48, 90, 8, 0xf6c453).setOrigin(0, 0.5);
      const label = this.add
        .text(mine.x, mine.y + 48, mine.label, {
          color: "#f8df91",
          fontFamily: "system-ui",
          fontSize: "12px",
          fontStyle: "bold",
        })
        .setOrigin(0.5);

      this.tweens.add({
        targets: orbit,
        scale: 1.32,
        alpha: 0,
        duration: 1450,
        repeat: -1,
        ease: "Sine.Out",
      });

      this.mineViews.set(mine.id, { zone, orbit, body, core, healthBack, healthFill, label });
    }
  }

  createSelectionMarker() {
    this.selectionMarker = this.add.graphics().setDepth(12);
  }

  registerInput() {
    this.input.keyboard.disableGlobalCapture();
    this.input.on("pointerdown", (pointer) => {
      if (this.finished) return;

      if (pointer.rightButtonDown()) {
        this.issueMoveCommand(pointer.worldX, pointer.worldY);
        return;
      }

      const unit = this.findUnitAt(pointer.worldX, pointer.worldY, this.localTeam);

      if (unit) {
        const nextSelection = new Set(this.selectedIds);
        if (nextSelection.has(unit.id)) {
          nextSelection.delete(unit.id);
        } else {
          nextSelection.add(unit.id);
        }
        this.setLocalSelection(nextSelection);
      } else if (this.selectedIds.size > 0) {
        this.issueMoveCommand(pointer.worldX, pointer.worldY);
        return;
      } else {
        this.setLocalSelection(new Set());
      }

      this.redrawSelection(true);
      this.updateHud();
    });

    this.input.mouse?.disableContextMenu();
    this.input.keyboard.on("keydown-ESC", () => this.options.onExit?.());
    this.input.keyboard.on("keydown-ENTER", (event) => {
      if (this.finished && !event.repeat) this.requestRematch();
    });
    this.input.keyboard.on("keydown-A", () => this.selectAllLocalUnits());
    this.input.keyboard.on("keydown-TAB", (event) => {
      event.preventDefault();
      if (!event.repeat) this.cycleLocalUnit(event.shiftKey ? -1 : 1);
    });
    this.input.keyboard.on("keydown-F", (event) => {
      if (!event.repeat) this.selectLocalUnitTypes(["soldier", "tank"], "Frontline selected");
    });
    this.input.keyboard.on("keydown-R", (event) => {
      if (!event.repeat) {
        this.selectLocalUnitTypes(["ranger", "medic", "artillery"], "Support line selected");
      }
    });
    this.input.keyboard.on("keydown-Q", (event) => {
      if (!event.repeat) this.commandSelectionToMine(-1);
    });
    this.input.keyboard.on("keydown-E", (event) => {
      if (!event.repeat) this.commandSelectionToMine(1);
    });
    this.input.keyboard.on("keydown-B", (event) => {
      if (!event.repeat) this.commandSelectionToEnemyBase();
    });
    this.input.keyboard.on("keydown-H", (event) => {
      if (!event.repeat) this.guardSelectedUnits();
    });
    this.input.keyboard.on("keydown-G", (event) => {
      if (!event.repeat) this.deselectAllLocalUnits();
    });
    this.input.keyboard.on("keydown-C", (event) => {
      if (!event.repeat) this.focusSelectedUnits();
    });
    this.input.keyboard.on("keydown-Z", (event) => {
      if (!event.repeat) this.activateTacticalMode("surge");
    });
    this.input.keyboard.on("keydown-X", (event) => {
      if (!event.repeat) this.activateTacticalMode("brace");
    });
    this.input.keyboard.on("keydown-V", (event) => {
      if (!event.repeat) this.focusFireAtCamera();
    });
    this.input.keyboard.on("keydown-SPACE", (event) => {
      event.preventDefault();
      if (!event.repeat) this.commandSelectionToCameraCenter();
    });
    this.purchaseKeys = this.input.keyboard.addKeys(
      {
        soldier: Phaser.Input.Keyboard.KeyCodes.ONE,
        ranger: Phaser.Input.Keyboard.KeyCodes.TWO,
        tank: Phaser.Input.Keyboard.KeyCodes.THREE,
        medic: Phaser.Input.Keyboard.KeyCodes.FOUR,
        artillery: Phaser.Input.Keyboard.KeyCodes.FIVE,
      },
      false
    );
    this.cameraKeys = this.input.keyboard.addKeys(
      {
        up: Phaser.Input.Keyboard.KeyCodes.UP,
        down: Phaser.Input.Keyboard.KeyCodes.DOWN,
        left: Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      },
      false
    );
    this.events.once("shutdown", () => {
      this.input.keyboard.removeAllKeys(true, true);
      this.input.keyboard.removeAllListeners();
      this.input.keyboard.clearCaptures();
    });
  }

  registerGameEvents() {
    this.game.events.on("buy-unit", this.requestPurchase, this);
    this.game.events.on("select-all-units", this.selectAllLocalUnits, this);
    this.game.events.on("deselect-all-units", this.deselectAllLocalUnits, this);
    this.game.events.on("tactical-command", this.activateTacticalMode, this);
    this.game.events.on("focus-fire", this.focusFireAtCamera, this);
    this.events.once("shutdown", () => {
      this.game.events.off("buy-unit", this.requestPurchase, this);
      this.game.events.off("select-all-units", this.selectAllLocalUnits, this);
      this.game.events.off("deselect-all-units", this.deselectAllLocalUnits, this);
      this.game.events.off("tactical-command", this.activateTacticalMode, this);
      this.game.events.off("focus-fire", this.focusFireAtCamera, this);
    });
  }

  registerNetworkEvents() {
    this.options.onCommand?.((command) => {
      if (!this.isAuthority || this.options.mode !== "friend") return;

      const commandId = typeof command?.commandId === "string" ? command.commandId : null;
      if (commandId && this.processedRemoteCommandIds.has(commandId)) return;
      if (commandId) {
        this.processedRemoteCommandIds.add(commandId);
        if (this.processedRemoteCommandIds.size > 500) {
          this.processedRemoteCommandIds.delete(this.processedRemoteCommandIds.values().next().value);
        }
      }

      if (command?.action === "ready") {
        this.broadcastSnapshot(true);
        return;
      }
      if (command?.action === "rematch") {
        const requestedRound = Number(command.roundId) || this.roundId;
        if (this.finished && requestedRound === this.roundId) this.resetMatch();
        return;
      }

      this.applyCommand("guest", command);
    });

    this.options.onState?.((snapshot) => {
      if (this.isAuthority || !this.isValidSnapshot(snapshot)) return;
      this.applySnapshot(snapshot);
    });
  }

  requestPurchase(type) {
    if (!UNIT_TYPES[type] || this.finished) return;

    const definition = UNIT_TYPES[type];
    const teamCount = [...this.units.values()].filter(
      (unit) => unit.team === this.localTeam
    ).length;
    if (teamCount >= MAX_UNITS_PER_TEAM) {
      this.setStatus(`Army full: ${MAX_UNITS_PER_TEAM}/${MAX_UNITS_PER_TEAM} units`, "warning");
      return;
    }
    if (this.credits[this.localTeam] < definition.cost) {
      const shortfall = Math.ceil(definition.cost - this.credits[this.localTeam]);
      this.setStatus(`Need ${shortfall} more credits for ${definition.label}`, "warning");
      return;
    }

    if (this.isAuthority) {
      if (this.buyUnit(this.localTeam, type)) {
        this.setStatus(`${definition.label} deployed`, "success");
      }
    } else {
      this.options.sendCommand?.({ action: "buy", type });
      this.setStatus(`${definition.label} recruitment sent`, "success");
    }
  }

  issueMoveCommand(x, y) {
    const unitIds = [...this.selectedIds];
    if (unitIds.length === 0) return;

    const target = clampPoint(x, y);
    if (!target) return;
    const mine = this.findMineAt(target.x, target.y);
    this.showCommandMarker(target.x, target.y);
    this.setStatus(
      mine
        ? `${unitIds.length} unit${unitIds.length === 1 ? "" : "s"} ordered to ${mine.label}`
        : `${unitIds.length} unit${unitIds.length === 1 ? "" : "s"} moving`,
      "success",
      1800
    );
    const command = {
      action: "move",
      unitIds: unitIds.slice(0, MAX_UNITS_PER_TEAM),
      x: target.x,
      y: target.y,
      objectiveId: mine?.id || null,
      automatic: false,
      issuedAt: Date.now(),
    };
    for (const id of unitIds) this.pendingLocalHolds.delete(id);

    if (this.isAuthority) {
      this.applyCommand(this.localTeam, command);
    } else {
      this.options.sendCommand?.(command);
    }
  }

  findMineAt(x, y) {
    return [...this.mines.values()].find(
      (mine) => Phaser.Math.Distance.Between(x, y, mine.x, mine.y) <= 62
    );
  }

  showCommandMarker(x, y) {
    this.lastCommandMarker?.destroy();

    const marker = this.add.circle(x, y, 15, TEAM_COLORS[this.localTeam], 0.12)
      .setStrokeStyle(3, TEAM_COLORS[this.localTeam], 0.95)
      .setDepth(15);
    this.lastCommandMarker = marker;

    this.tweens.add({
      targets: marker,
      scale: 2.1,
      alpha: 0,
      duration: 520,
      ease: "Cubic.Out",
      onComplete: () => {
        if (this.lastCommandMarker === marker) this.lastCommandMarker = null;
        marker.destroy();
      },
    });
  }

  setStatus(message, tone = "neutral", duration = 2600) {
    this.statusMessage = message;
    this.statusTone = tone;
    this.statusUntil = duration > 0 ? Date.now() + duration : 0;
    this.updateHud(true);
  }

  applyCommand(team, command) {
    if (!command || typeof command.action !== "string" || this.finished) return;

    if (command.action === "buy" && UNIT_TYPES[command.type]) {
      this.buyUnit(team, command.type);
      return;
    }

    if (command.action === "tactical" && Array.isArray(command.unitIds)) {
      const mode = ["surge", "brace"].includes(command.mode) ? command.mode : null;
      if (!mode) return;
      const now = this.time.now;
      const duration = mode === "surge" ? SURGE_DURATION : BRACE_DURATION;
      for (const id of command.unitIds.slice(0, MAX_UNITS_PER_TEAM)) {
        const unit = this.units.get(String(id));
        if (unit?.team !== team || now < (unit.tacticalReadyAt || 0)) continue;
        unit.tacticalMode = mode;
        unit.tacticalUntil = now + duration;
        unit.tacticalReadyAt = now + TACTICAL_COOLDOWN;
      }
      return;
    }

    if (command.action === "focus-fire" && Array.isArray(command.unitIds)) {
      const targetPoint = clampPoint(command.x, command.y);
      if (!targetPoint) return;
      const enemyTeam = team === "host" ? "guest" : "host";
      const target = [...this.units.values()]
        .filter((unit) => unit.team === enemyTeam)
        .map((unit) => ({
          unit,
          distance: Phaser.Math.Distance.Between(unit.x, unit.y, targetPoint.x, targetPoint.y),
        }))
        .sort((left, right) => left.distance - right.distance)[0]?.unit;
      if (!target) return;
      const now = this.time.now;
      for (const id of command.unitIds.slice(0, MAX_UNITS_PER_TEAM)) {
        const unit = this.units.get(String(id));
        if (unit?.team !== team || now < (unit.tacticalReadyAt || 0)) continue;
        unit.forcedTargetId = target.id;
        unit.forcedTargetUntil = now + FOCUS_DURATION;
        unit.tacticalReadyAt = now + TACTICAL_COOLDOWN;
        unit.combatTargetId = target.id;
      }
    }

    if (command.action === "release-manual" && Array.isArray(command.unitIds)) {
      for (const id of command.unitIds.slice(0, MAX_UNITS_PER_TEAM)) {
        const unit = this.units.get(String(id));
        if (
          unit &&
          Number(command.issuedAt) &&
          Number(command.issuedAt) < (unit.manualCommandAt || 0)
        ) {
          continue;
        }
        if (unit?.team === team && unit.order && !unit.order.automatic) {
          unit.order = null;
          unit.combatTargetId = null;
          unit.manualCommandAt = Number(command.issuedAt) || this.time.now;
        }
      }
      return;
    }

    if (command.action === "hold-manual" && Array.isArray(command.unitIds)) {
      for (const id of command.unitIds.slice(0, MAX_UNITS_PER_TEAM)) {
        const unit = this.units.get(String(id));
        if (unit?.team !== team) continue;
        if (
          Number(command.issuedAt) &&
          Number(command.issuedAt) < (unit.manualCommandAt || 0)
        ) {
          continue;
        }
        unit.order = {
          x: unit.x,
          y: unit.y,
          objectiveId: null,
          automatic: false,
          strategy: "hold",
          assignedAt: this.time.now,
        };
        unit.combatTargetId = null;
        unit.manualCommandAt = Number(command.issuedAt) || this.time.now;
      }
      return;
    }

    if (command.action === "move" && Array.isArray(command.unitIds)) {
      const target = clampPoint(command.x, command.y);
      if (!target) return;
      const objective =
        typeof command.objectiveId === "string" ? this.mines.get(command.objectiveId) : null;
      const ownedUnits = command.unitIds
        .slice(0, MAX_UNITS_PER_TEAM)
        .map((id) => this.units.get(String(id)))
        .filter((unit, index, units) => unit?.team === team && units.indexOf(unit) === index);

      const roleCounts = { tank: 0, soldier: 0, ranger: 0, medic: 0, artillery: 0 };
      const roleDepth = { tank: 0, soldier: 38, ranger: 112, medic: 145, artillery: 180 };
      const roleColumns = { tank: 3, soldier: 4, ranger: 4, medic: 3, artillery: 3 };
      const destinationX = objective?.x ?? target.x;
      const destinationY = objective?.y ?? target.y;
      const center = ownedUnits.reduce(
        (total, unit) => ({ x: total.x + unit.x, y: total.y + unit.y }),
        { x: 0, y: 0 }
      );
      center.x /= Math.max(1, ownedUnits.length);
      center.y /= Math.max(1, ownedUnits.length);
      const travelDistance = Phaser.Math.Distance.Between(
        center.x,
        center.y,
        destinationX,
        destinationY
      );
      const forwardX =
        travelDistance > 1 ? (destinationX - center.x) / travelDistance : team === "host" ? 1 : -1;
      const forwardY = travelDistance > 1 ? (destinationY - center.y) / travelDistance : 0;
      const lateralX = -forwardY;
      const lateralY = forwardX;

      ownedUnits
        .sort((left, right) => {
          const priority = { tank: 0, soldier: 1, ranger: 2, medic: 3, artillery: 4 };
          return priority[left.type] - priority[right.type] || Number(left.id) - Number(right.id);
        })
        .forEach((unit) => {
          if (
            !command.automatic &&
            Number(command.issuedAt) &&
            Number(command.issuedAt) < (unit.manualCommandAt || 0)
          ) {
            return;
          }
          const roleIndex = roleCounts[unit.type]++;
          const columns = roleColumns[unit.type];
          const column = roleIndex % columns;
          const row = Math.floor(roleIndex / columns);
          const lateralOffset =
            (column - (columns - 1) / 2) * (unit.type === "tank" ? 34 : 27);
          const depth = roleDepth[unit.type] + row * 30;
          unit.order = {
            x: Phaser.Math.Clamp(
              destinationX - forwardX * depth + lateralX * lateralOffset,
              45,
              WORLD_WIDTH - 45
            ),
            y: Phaser.Math.Clamp(
              destinationY - forwardY * depth + lateralY * lateralOffset,
              75,
              WORLD_HEIGHT - 45
            ),
            objectiveId: objective?.id || null,
            automatic: Boolean(command.automatic),
            strategy: command.strategy || (command.automatic ? null : "move"),
            assignedAt: this.time.now,
          };
          unit.combatTargetId = null;
          if (!command.automatic) {
            unit.manualCommandAt = Number(command.issuedAt) || this.time.now;
          }
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
      rotation: team === "host" ? Math.PI / 2 : -Math.PI / 2,
      combatTargetId: null,
      pinnedUntil: 0,
      disruptedUntil: 0,
      manualCommandAt: 0,
      tacticalMode: null,
      tacticalUntil: 0,
      tacticalReadyAt: 0,
      forcedTargetId: null,
      forcedTargetUntil: 0,
    };

    this.units.set(id, unit);
    this.createUnitView(unit);
    return unit;
  }

  createUnitView(unit) {
    const definition = UNIT_TYPES[unit.type];
    const color = TEAM_COLORS[unit.team];
    const shadow = this.add
      .ellipse(
        unit.x,
        unit.y + definition.radius * 0.45,
        definition.radius * 2.5,
        definition.radius * 1.2,
        0x000000,
        0.34
      )
      .setDepth(3);
    const body = this.add.circle(unit.x, unit.y, definition.radius + 2, color, 0.2).setDepth(4);
    const source = this.textures.get(`unit-${unit.type}`).getSourceImage();
    const spriteHeight = unit.type === "tank" ? 58 : unit.type === "ranger" ? 49 : 45;
    const sprite = this.add
      .image(unit.x, unit.y, `unit-${unit.type}`)
      .setDisplaySize((source.width / source.height) * spriteHeight, spriteHeight)
      .setTint(color)
      .setRotation(unit.rotation || 0)
      .setDepth(6);
    const ring = this.add.circle(unit.x, unit.y, definition.radius + 4, color, 0).setStrokeStyle(2, color, 0.4).setDepth(4);
    const healthBack = this.add.rectangle(unit.x, unit.y - definition.radius - 9, definition.radius * 2.2, 4, 0x111827).setDepth(6);
    const healthFill = this.add
      .rectangle(unit.x - definition.radius * 1.1, unit.y - definition.radius - 9, definition.radius * 2.2, 4, color)
      .setOrigin(0, 0.5)
      .setDepth(7);

    this.unitViews.set(unit.id, { shadow, body, sprite, ring, healthBack, healthFill });
  }

  destroyUnitView(id) {
    const view = this.unitViews.get(id);
    if (!view) return;
    Object.values(view).forEach((displayObject) => displayObject.destroy());
    this.unitViews.delete(id);
    this.selectedIds.delete(id);
    this.pendingLocalHolds.delete(id);
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
    this.setLocalSelection(new Set(
      [...this.units.values()].filter((unit) => unit.team === this.localTeam).map((unit) => unit.id)
    ));
    this.redrawSelection(true);
    this.updateHud();
  }

  deselectAllLocalUnits() {
    this.setLocalSelection(new Set());
    this.redrawSelection(true);
    this.updateHud();
    this.setStatus("Squad returned to autonomous command", "success");
  }

  localUnits() {
    return [...this.units.values()]
      .filter((unit) => unit.team === this.localTeam)
      .sort((left, right) => Number(left.id) - Number(right.id));
  }

  ensureKeyboardSelection() {
    if (this.selectedIds.size === 0) this.selectAllLocalUnits();
    return this.selectedIds.size > 0;
  }

  selectLocalUnitTypes(types, message) {
    const selected = this.localUnits().filter((unit) => types.includes(unit.type));
    if (selected.length === 0) {
      this.setStatus("No matching units available", "warning");
      return;
    }
    this.setLocalSelection(new Set(selected.map((unit) => unit.id)));
    this.redrawSelection(true);
    this.updateHud();
    this.setStatus(`${message}: ${selected.length}`, "success");
  }

  cycleLocalUnit(direction) {
    const units = this.localUnits();
    if (units.length === 0) return;
    const currentId = this.selectedIds.size === 1 ? [...this.selectedIds][0] : null;
    const currentIndex = units.findIndex((unit) => unit.id === currentId);
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : units.length - 1
        : (currentIndex + direction + units.length) % units.length;
    const unit = units[nextIndex];
    this.setLocalSelection(new Set([unit.id]));
    this.focusSelectedUnits();
    this.setStatus(`${UNIT_TYPES[unit.type].label} selected`, "success");
  }

  commandSelectionToMine(direction) {
    if (!this.ensureKeyboardSelection()) return;
    const mines = [...this.mines.values()];
    if (this.keyboardMineIndex < 0) {
      this.keyboardMineIndex = direction > 0 ? 0 : mines.length - 1;
    } else {
      this.keyboardMineIndex =
        (this.keyboardMineIndex + direction + mines.length) % mines.length;
    }
    const mine = mines[this.keyboardMineIndex];
    this.issueMoveCommand(mine.x, mine.y);
    this.cameras.main.centerOn(mine.x, mine.y);
  }

  commandSelectionToEnemyBase() {
    if (!this.ensureKeyboardSelection()) return;
    const x = this.localTeam === "host" ? GUEST_BASE_X : HOST_BASE_X;
    this.issueMoveCommand(x, BASE_Y);
    this.cameras.main.centerOn(x, BASE_Y);
  }

  commandSelectionToCameraCenter() {
    if (!this.ensureKeyboardSelection()) return;
    const camera = this.cameras.main;
    this.issueMoveCommand(camera.worldView.centerX, camera.worldView.centerY);
  }

  guardSelectedUnits() {
    if (!this.ensureKeyboardSelection()) return;
    const unitIds = [...this.selectedIds];
    const issuedAt = Date.now();
    for (const id of unitIds) {
      const unit = this.units.get(id);
      if (!unit) continue;
      unit.order = {
        x: unit.x,
        y: unit.y,
        objectiveId: null,
        automatic: false,
        strategy: "hold",
        assignedAt: this.time.now,
      };
      unit.combatTargetId = null;
      this.pendingLocalHolds.set(id, { x: unit.x, y: unit.y, issuedAt });
    }
    const command = { action: "hold-manual", unitIds, issuedAt };
    if (this.isAuthority) this.applyCommand(this.localTeam, command);
    else this.options.sendCommand?.(command);
    this.setStatus(`${unitIds.length} unit${unitIds.length === 1 ? "" : "s"} guarding`, "success");
  }

  focusSelectedUnits() {
    const selected = [...this.selectedIds]
      .map((id) => this.units.get(id))
      .filter((unit) => unit?.team === this.localTeam);
    if (selected.length === 0) {
      this.centerCameraOnLocalBase();
      this.setStatus("Camera centered on base");
      return;
    }
    const center = selected.reduce(
      (total, unit) => ({ x: total.x + unit.x, y: total.y + unit.y }),
      { x: 0, y: 0 }
    );
    this.cameras.main.centerOn(center.x / selected.length, center.y / selected.length);
  }

  activateTacticalMode(mode) {
    if (!["surge", "brace"].includes(mode) || !this.ensureKeyboardSelection()) return;
    const unitIds = [...this.selectedIds];
    const now = this.time.now;
    const readyCount = unitIds.filter(
      (id) => now >= (this.units.get(id)?.tacticalReadyAt || 0)
    ).length;
    if (readyCount === 0) {
      this.setStatus("Selected squad tactics are cooling down", "warning");
      return;
    }
    const command = { action: "tactical", unitIds, mode };
    if (this.isAuthority) this.applyCommand(this.localTeam, command);
    else this.options.sendCommand?.(command);
    this.setStatus(
      mode === "surge"
        ? `Surge: ${readyCount} units gain tempo but take more damage`
        : `Brace: ${readyCount} units reduce damage but move slower`,
      "success"
    );
  }

  focusFireAtCamera() {
    if (!this.ensureKeyboardSelection()) return;
    const camera = this.cameras.main;
    const command = {
      action: "focus-fire",
      unitIds: [...this.selectedIds],
      x: camera.worldView.centerX,
      y: camera.worldView.centerY,
    };
    if (this.isAuthority) this.applyCommand(this.localTeam, command);
    else this.options.sendCommand?.(command);
    this.setStatus("Focus Fire: squad prioritizing the marked enemy", "success");
  }

  setLocalSelection(nextSelection) {
    const releasedIds = [...this.selectedIds].filter((id) => !nextSelection.has(id));
    const addedIds = [...nextSelection].filter((id) => !this.selectedIds.has(id));
    this.selectedIds = nextSelection;

    const sendSelectionCommand = (command) => {
      if (this.isAuthority) {
        this.applyCommand(this.localTeam, command);
      } else {
        this.options.sendCommand?.(command);
      }
    };
    if (releasedIds.length > 0) {
      const issuedAt = Date.now();
      for (const id of releasedIds) this.pendingLocalHolds.delete(id);
      sendSelectionCommand({ action: "release-manual", unitIds: releasedIds, issuedAt });
    }
    if (addedIds.length > 0) {
      const issuedAt = Date.now();
      for (const id of addedIds) {
        const unit = this.units.get(id);
        if (!unit) continue;
        unit.order = {
          x: unit.x,
          y: unit.y,
          objectiveId: null,
          automatic: false,
          strategy: "hold",
          assignedAt: this.time.now,
        };
        unit.combatTargetId = null;
        this.pendingLocalHolds.set(id, { x: unit.x, y: unit.y, issuedAt });
      }
      sendSelectionCommand({ action: "hold-manual", unitIds: addedIds, issuedAt });
    }
  }

  update(time, delta) {
    if (this.finished) return;

    this.updateCamera(delta);

    if (Phaser.Input.Keyboard.JustDown(this.purchaseKeys.soldier)) this.requestPurchase("soldier");
    if (Phaser.Input.Keyboard.JustDown(this.purchaseKeys.ranger)) this.requestPurchase("ranger");
    if (Phaser.Input.Keyboard.JustDown(this.purchaseKeys.tank)) this.requestPurchase("tank");
    if (Phaser.Input.Keyboard.JustDown(this.purchaseKeys.medic)) this.requestPurchase("medic");
    if (Phaser.Input.Keyboard.JustDown(this.purchaseKeys.artillery)) this.requestPurchase("artillery");

    if (this.isAuthority) {
      this.updateEconomy(time);
      this.updateUnits(time, delta);
      this.updateStrategicCommanders(time);
      this.updateAutonomousPurchasing(time);
      this.checkVictory();

      if (time - this.lastSnapshotAt >= SNAPSHOT_INTERVAL) {
        this.broadcastSnapshot();
        this.lastSnapshotAt = time;
      }
    }

    this.syncViews();
  }

  updateCamera(delta) {
    const camera = this.cameras.main;
    const deltaSeconds = Math.min(delta, 50) / 1000;
    let horizontal = 0;
    let vertical = 0;

    if (this.canvasPointer.inside) {
      const pointer = this.canvasPointer;
      const marginX = Math.min(EDGE_SCROLL_MARGIN, pointer.width * 0.22);
      const marginY = Math.min(EDGE_SCROLL_MARGIN, pointer.height * 0.22);
      if (pointer.x <= marginX) horizontal = -(1 - pointer.x / marginX);
      if (pointer.x >= pointer.width - marginX) {
        horizontal = 1 - (pointer.width - pointer.x) / marginX;
      }
      if (pointer.y <= marginY) vertical = -(1 - pointer.y / marginY);
      if (pointer.y >= pointer.height - marginY) {
        vertical = 1 - (pointer.height - pointer.y) / marginY;
      }
    }

    if (this.cameraKeys.left.isDown) horizontal = -1;
    if (this.cameraKeys.right.isDown) horizontal = 1;
    if (this.cameraKeys.up.isDown) vertical = -1;
    if (this.cameraKeys.down.isDown) vertical = 1;

    horizontal = Phaser.Math.Clamp(horizontal, -1, 1);
    vertical = Phaser.Math.Clamp(vertical, -1, 1);

    const horizontalSpeed = horizontal
      ? CAMERA_SCROLL_MIN_SPEED +
        (CAMERA_SCROLL_MAX_SPEED - CAMERA_SCROLL_MIN_SPEED) * Math.abs(horizontal) ** 1.45
      : 0;
    const verticalSpeed = vertical
      ? CAMERA_SCROLL_MIN_SPEED +
        (CAMERA_SCROLL_MAX_SPEED - CAMERA_SCROLL_MIN_SPEED) * Math.abs(vertical) ** 1.45
      : 0;
    const diagonalScale = horizontal && vertical ? Math.SQRT1_2 : 1;
    const targetX = Math.sign(horizontal) * horizontalSpeed * diagonalScale;
    const targetY = Math.sign(vertical) * verticalSpeed * diagonalScale;
    const blend = 1 - Math.exp(-CAMERA_ACCELERATION * deltaSeconds);
    this.cameraVelocity.x = Phaser.Math.Linear(this.cameraVelocity.x, targetX, blend);
    this.cameraVelocity.y = Phaser.Math.Linear(this.cameraVelocity.y, targetY, blend);

    if (Math.abs(this.cameraVelocity.x) < 0.5) this.cameraVelocity.x = 0;
    if (Math.abs(this.cameraVelocity.y) < 0.5) this.cameraVelocity.y = 0;
    if (!this.cameraVelocity.x && !this.cameraVelocity.y) return;

    const nextX = camera.clampX(camera.scrollX + this.cameraVelocity.x * deltaSeconds);
    const nextY = camera.clampY(camera.scrollY + this.cameraVelocity.y * deltaSeconds);
    if (nextX === camera.scrollX) this.cameraVelocity.x = 0;
    if (nextY === camera.scrollY) this.cameraVelocity.y = 0;
    camera.setScroll(nextX, nextY);
  }

  updateEconomy(time) {
    if (!this.lastIncomeAt) this.lastIncomeAt = time;
    const elapsed = time - this.lastIncomeAt;
    if (elapsed < 250) return;

    const elapsedSeconds = elapsed / 1000;
    const controlledMines = { host: 0, guest: 0 };
    for (const mine of this.mines.values()) {
      if (mine.owner) controlledMines[mine.owner] += 1;
    }

    this.credits.host = Math.min(
      MAX_CREDITS,
      this.credits.host +
        (INCOME_PER_SECOND + controlledMines.host * MINE_INCOME_PER_SECOND) * elapsedSeconds
    );
    this.credits.guest = Math.min(
      MAX_CREDITS,
      this.credits.guest +
        (INCOME_PER_SECOND + controlledMines.guest * MINE_INCOME_PER_SECOND) * elapsedSeconds
    );
    this.lastIncomeAt = time;
    this.updateHud();
  }

  updateUnits(time, delta) {
    const deltaSeconds = Math.min(delta, 100) / 1000;
    const attackIntents = [];
    this.refreshUnitContext();

    for (const unit of this.unitContext.all) {
      const definition = UNIT_TYPES[unit.type];
      if (unit.tacticalMode && time >= (unit.tacticalUntil || 0)) {
        unit.tacticalMode = null;
        unit.tacticalUntil = 0;
      }
      if (unit.forcedTargetId && time >= (unit.forcedTargetUntil || 0)) {
        unit.forcedTargetId = null;
        unit.forcedTargetUntil = 0;
      }
      const manualOrder = unit.order && !unit.order.automatic ? unit.order : null;
      if (manualOrder && manualOrder.strategy !== "hold") {
        const destinationDistance = Phaser.Math.Distance.Between(
          unit.x,
          unit.y,
          manualOrder.x,
          manualOrder.y
        );
        const arrivalRadius = Math.max(8, definition.radius * 0.65);
        if (destinationDistance > arrivalRadius) {
          unit.combatTargetId = null;
          this.moveUnitToward(
            unit,
            manualOrder.x,
            manualOrder.y,
            this.effectiveMovementSpeed(unit),
            deltaSeconds
          );
          continue;
        }

        manualOrder.strategy = "hold";
        manualOrder.x = unit.x;
        manualOrder.y = unit.y;
        unit.combatTargetId = null;
      }

      if (unit.type === "medic") {
        this.updateMedic(unit, time, deltaSeconds);
        continue;
      }

      const target = this.findCombatTarget(unit);
      const isRanged = ["ranger", "artillery"].includes(unit.type);
      const frontlineCoverage =
        isRanged && target?.kind === "unit" ? this.findFrontlineCoverage(unit, target) : null;
      const rangedCanCommit =
        !isRanged ||
        target?.kind !== "unit" ||
        Boolean(frontlineCoverage) ||
        target.distance <= Math.max(70, definition.minimumRange || 0);
      const inAttackRange =
        target &&
        target.distance <= definition.range &&
        rangedCanCommit &&
        (unit.type !== "artillery" ||
          target.kind !== "unit" ||
          target.distance >= definition.minimumRange) &&
        this.canAttackTarget(unit, target);
      const canAttack = time >= (unit.disruptedUntil || 0);
      const movementSpeed = this.effectiveMovementSpeed(unit);

      if (inAttackRange && canAttack) {
        const cooldownMultiplier =
          unit.tacticalMode === "surge" ? 0.78 : unit.tacticalMode === "brace" ? 1.18 : 1;
        if (time - unit.lastAttackAt >= definition.cooldown * cooldownMultiplier) {
          unit.lastAttackAt = time;
          attackIntents.push({
            unit,
            target,
            damage: this.attackDamage(unit, target),
            attackingTeam: unit.team,
          });
        }
      }

      if (unit.order?.strategy === "hold" && !unit.order.automatic) continue;

      if (unit.type === "tank" && unit.order?.automatic) {
        const screen = this.findTankScreeningPosition(unit);
        if (screen && (!target || target.kind !== "unit" || target.distance > definition.range)) {
          this.moveUnitToward(unit, screen.x, screen.y, movementSpeed, deltaSeconds);
          continue;
        }
      }

      if (isRanged && target?.kind === "unit" && !frontlineCoverage) {
        const fallback = this.findRangedFallbackPosition(unit, target);
        this.moveUnitToward(unit, fallback.x, fallback.y, movementSpeed, deltaSeconds);
      } else if (unit.type === "artillery" && target?.kind === "unit") {
        if (target.distance < definition.minimumRange) {
          this.moveUnitAwayFrom(unit, target.x, target.y, movementSpeed, deltaSeconds);
        } else if (!this.canAttackTarget(unit, target)) {
          const frontline = this.findNearestFrontline(unit, 420);
          const destination = frontline || unit.order || this.defaultDestination(unit);
          this.moveUnitToward(unit, destination.x, destination.y, movementSpeed, deltaSeconds);
        } else if (!inAttackRange) {
          const position = this.coordinatedBacklinePosition(unit, target, 145);
          this.moveUnitToward(unit, position.x, position.y, movementSpeed, deltaSeconds);
        }
      } else if (unit.type === "ranger" && target?.kind === "unit") {
        const shouldEngage =
          Boolean(unit.order?.objectiveId) || target.distance <= definition.range * 1.3;
        const isPinned = time < (unit.pinnedUntil || 0);
        if (!isPinned && target.distance < definition.retreatRange) {
          this.moveUnitAwayFrom(unit, target.x, target.y, movementSpeed, deltaSeconds);
        } else if (shouldEngage && (!inAttackRange || target.distance > definition.preferredRange)) {
          const position = this.coordinatedBacklinePosition(unit, target, 78);
          this.moveUnitToward(unit, position.x, position.y, movementSpeed, deltaSeconds);
        } else if (!inAttackRange) {
          const destination = unit.order || this.defaultDestination(unit);
          this.moveUnitToward(unit, destination.x, destination.y, movementSpeed, deltaSeconds);
        }
      } else if (!inAttackRange) {
        const destination =
          target?.kind === "base" || target?.kind === "mine"
            ? target
            : target?.kind === "unit" &&
                (unit.order?.objectiveId || ["soldier", "tank"].includes(unit.type))
            ? target
            : unit.order || this.defaultDestination(unit);
        this.moveUnitToward(unit, destination.x, destination.y, movementSpeed, deltaSeconds);
      }

    }

    this.resolveAttackIntents(attackIntents, time);
    this.refreshUnitContext();
  }

  refreshUnitContext() {
    const all = [...this.units.values()];
    const byTeam = { host: [], guest: [] };
    const focusCounts = new Map();
    const nearbySplashCounts = new Map();
    const threatensSupport = new Set();
    const supportedTanks = new Set();

    for (const unit of all) {
      byTeam[unit.team].push(unit);
      if (unit.combatTargetId) {
        focusCounts.set(unit.combatTargetId, (focusCounts.get(unit.combatTargetId) || 0) + 1);
      }
    }

    for (const unit of all) {
      const allies = byTeam[unit.team];
      if (unit.type === "tank") {
        const supported = allies.some(
          (ally) =>
            ally.id !== unit.id &&
            Phaser.Math.Distance.Between(ally.x, ally.y, unit.x, unit.y) <= 150
        );
        if (supported) supportedTanks.add(unit.id);
      }

      let clustered = 0;
      for (const ally of allies) {
        if (
          Phaser.Math.Distance.Between(ally.x, ally.y, unit.x, unit.y) <=
          UNIT_TYPES.artillery.splashRadius
        ) {
          clustered += 1;
        }
      }
      nearbySplashCounts.set(unit.id, clustered);

      const enemySupports = byTeam[unit.team === "host" ? "guest" : "host"];
      if (
        enemySupports.some(
          (enemy) =>
            ["medic", "artillery", "ranger"].includes(enemy.type) &&
            Phaser.Math.Distance.Between(enemy.x, enemy.y, unit.x, unit.y) <= 180
        )
      ) {
        threatensSupport.add(unit.id);
      }
    }

    this.unitContext = {
      all,
      byTeam,
      focusCounts,
      nearbySplashCounts,
      threatensSupport,
      supportedTanks,
    };
  }

  unitsForTeam(team) {
    return this.unitContext?.byTeam?.[team] || [...this.units.values()].filter((unit) => unit.team === team);
  }

  updateMedic(unit, time, deltaSeconds) {
    const definition = UNIT_TYPES.medic;
    const guarding = unit.order?.strategy === "hold" && !unit.order.automatic;
    let patient = null;
    if (!guarding) {
      const nearbyEnemy = this.findPriorityEnemy(
        unit,
        unit.team === "host" ? "guest" : "host",
        150
      );
      if (nearbyEnemy) {
        this.moveUnitAwayFrom(unit, nearbyEnemy.x, nearbyEnemy.y, definition.speed, deltaSeconds);
        return;
      }
    }

    for (const ally of this.unitsForTeam(unit.team)) {
      if (ally.team !== unit.team || ally.id === unit.id || ally.health >= ally.maxHealth) continue;
      const distance = Phaser.Math.Distance.Between(unit.x, unit.y, ally.x, ally.y);
      if (distance > definition.supportSearchRange) continue;
      const need = 1 - ally.health / ally.maxHealth;
      const score = distance - need * 180;
      if (!patient || score < patient.score) patient = { ally, distance, score };
    }

    if (patient && patient.distance <= definition.healRange) {
      if (time - unit.lastAttackAt >= definition.cooldown) {
        unit.lastAttackAt = time;
        patient.ally.health = Math.min(patient.ally.maxHealth, patient.ally.health + definition.heal);
        this.showHealPulse(unit, patient.ally);
      }
      return;
    }

    if (guarding) return;

    const manualOrder = unit.order && !unit.order.automatic ? unit.order : null;
    const frontline = this.findNearestFrontline(unit, 380);
    const destination = manualOrder || patient?.ally || frontline || unit.order || this.defaultDestination(unit);
    this.moveUnitToward(unit, destination.x, destination.y, definition.speed, deltaSeconds);
  }

  canAttackTarget(unit, target) {
    if (unit.type !== "artillery") return true;
    const spottingRange = target.kind === "unit" ? 240 : 280;

    return this.unitsForTeam(unit.team).some(
      (ally) =>
        ally.team === unit.team &&
        ally.id !== unit.id &&
        ally.type !== "artillery" &&
        Phaser.Math.Distance.Between(ally.x, ally.y, target.x, target.y) <= spottingRange
    );
  }

  findNearestFrontline(unit, maxDistance) {
    let closest = null;
    for (const ally of this.unitsForTeam(unit.team)) {
      if (
        ally.team !== unit.team ||
        ally.id === unit.id ||
        !["soldier", "tank"].includes(ally.type)
      ) {
        continue;
      }
      const distance = Phaser.Math.Distance.Between(unit.x, unit.y, ally.x, ally.y);
      if (distance <= maxDistance && (!closest || distance < closest.distance)) {
        closest = { x: ally.x, y: ally.y, distance };
      }
    }
    return closest;
  }

  findFrontlineCoverage(unit, target) {
    let best = null;
    for (const ally of this.unitsForTeam(unit.team)) {
      if (ally.id === unit.id || !["soldier", "tank"].includes(ally.type)) continue;
      const supportDistance = Phaser.Math.Distance.Between(unit.x, unit.y, ally.x, ally.y);
      const coverageRadius = ally.type === "tank" ? 245 : 175;
      if (supportDistance > coverageRadius) continue;

      const allyTargetDistance = Phaser.Math.Distance.Between(
        ally.x,
        ally.y,
        target.x,
        target.y
      );
      const unitTargetDistance = Phaser.Math.Distance.Between(
        unit.x,
        unit.y,
        target.x,
        target.y
      );
      if (allyTargetDistance > unitTargetDistance + 35) continue;

      const score = allyTargetDistance + supportDistance * 0.35 - (ally.type === "tank" ? 75 : 0);
      if (!best || score < best.score) {
        best = { ally, x: ally.x, y: ally.y, distance: supportDistance, score };
      }
    }
    return best;
  }

  findRangedFallbackPosition(unit, target) {
    const frontline = this.findNearestFrontline(unit, 520);
    if (frontline) {
      const distance = Math.max(
        1,
        Phaser.Math.Distance.Between(frontline.x, frontline.y, target.x, target.y)
      );
      const trailDistance = unit.type === "artillery" ? 155 : 95;
      return {
        x: Phaser.Math.Clamp(
          frontline.x + ((frontline.x - target.x) / distance) * trailDistance,
          45,
          WORLD_WIDTH - 45
        ),
        y: Phaser.Math.Clamp(
          frontline.y + ((frontline.y - target.y) / distance) * trailDistance,
          75,
          WORLD_HEIGHT - 45
        ),
      };
    }

    const ownBaseX = unit.team === "host" ? HOST_BASE_X : GUEST_BASE_X;
    const distance = Math.max(1, Phaser.Math.Distance.Between(unit.x, unit.y, target.x, target.y));
    return {
      x: Phaser.Math.Clamp(
        unit.x + ((unit.x - target.x) / distance) * 90 + (ownBaseX - unit.x) * 0.18,
        45,
        WORLD_WIDTH - 45
      ),
      y: Phaser.Math.Clamp(unit.y + ((unit.y - target.y) / distance) * 90, 75, WORLD_HEIGHT - 45),
    };
  }

  findTankScreeningPosition(tank) {
    let best = null;
    const enemyTeam = tank.team === "host" ? "guest" : "host";
    for (const support of this.unitsForTeam(tank.team)) {
      if (!["ranger", "medic", "artillery"].includes(support.type)) continue;
      const tankDistance = Phaser.Math.Distance.Between(tank.x, tank.y, support.x, support.y);
      if (tankDistance > 430) continue;

      for (const enemy of this.unitsForTeam(enemyTeam)) {
        const threatDistance = Phaser.Math.Distance.Between(
          enemy.x,
          enemy.y,
          support.x,
          support.y
        );
        if (threatDistance > 260) continue;

        const distance = Math.max(
          1,
          Phaser.Math.Distance.Between(support.x, support.y, enemy.x, enemy.y)
        );
        const screenDistance = 72;
        const score = threatDistance + tankDistance * 0.45;
        if (!best || score < best.score) {
          best = {
            x: Phaser.Math.Clamp(
              support.x + ((enemy.x - support.x) / distance) * screenDistance,
              45,
              WORLD_WIDTH - 45
            ),
            y: Phaser.Math.Clamp(
              support.y + ((enemy.y - support.y) / distance) * screenDistance,
              75,
              WORLD_HEIGHT - 45
            ),
            score,
          };
        }
      }
    }
    return best;
  }

  coordinatedBacklinePosition(unit, target, trailDistance) {
    const frontline = this.findNearestFrontline(unit, 360);
    if (!frontline) return target;

    const distance = Math.max(
      1,
      Phaser.Math.Distance.Between(frontline.x, frontline.y, target.x, target.y)
    );
    return {
      x: Phaser.Math.Clamp(
        frontline.x + ((frontline.x - target.x) / distance) * trailDistance,
        45,
        WORLD_WIDTH - 45
      ),
      y: Phaser.Math.Clamp(
        frontline.y + ((frontline.y - target.y) / distance) * trailDistance,
        75,
        WORLD_HEIGHT - 45
      ),
    };
  }

  effectiveMovementSpeed(unit) {
    const definition = UNIT_TYPES[unit.type];
    let speed = definition.speed;
    if (unit.tacticalMode === "surge") speed *= 1.35;
    if (unit.tacticalMode === "brace") speed *= 0.45;

    if (unit.type === "soldier") {
      for (const enemy of this.unitsForTeam(unit.team === "host" ? "guest" : "host")) {
        if (enemy.type !== "tank") continue;
        if (
          Phaser.Math.Distance.Between(unit.x, unit.y, enemy.x, enemy.y) <=
          UNIT_TYPES.tank.controlRadius
        ) {
          speed *= UNIT_TYPES.tank.soldierSpeedFactor;
          break;
        }
      }
    }

    if (unit.order?.automatic && ["ranger", "artillery"].includes(unit.type)) {
      const frontline = this.findNearestFrontline(unit, 620);
      if (!frontline) {
        speed *= 0.42;
      } else if (frontline.distance > 270) {
        speed *= 0.62;
      } else if (frontline.distance < 75) {
        speed *= 0.82;
      }
    }

    if (unit.order?.automatic && ["soldier", "tank"].includes(unit.type)) {
      let nearestSupportDistance = Infinity;
      for (const ally of this.unitsForTeam(unit.team)) {
        if (
          ally.team !== unit.team ||
          !["ranger", "medic", "artillery"].includes(ally.type) ||
          ally.order?.strategy !== unit.order.strategy
        ) {
          continue;
        }
        nearestSupportDistance = Math.min(
          nearestSupportDistance,
          Phaser.Math.Distance.Between(unit.x, unit.y, ally.x, ally.y)
        );
      }
      if (nearestSupportDistance > 190 && nearestSupportDistance < 520) speed *= 0.68;
    }

    return speed;
  }

  findCombatTarget(unit) {
    const enemyTeam = unit.team === "host" ? "guest" : "host";
    const forcedTarget = unit.forcedTargetId ? this.units.get(unit.forcedTargetId) : null;
    if (forcedTarget?.team === enemyTeam && this.time.now < (unit.forcedTargetUntil || 0)) {
      const distance = Phaser.Math.Distance.Between(
        unit.x,
        unit.y,
        forcedTarget.x,
        forcedTarget.y
      );
      if (distance <= 560) {
        return {
          kind: "unit",
          entity: forcedTarget,
          x: forcedTarget.x,
          y: forcedTarget.y,
          distance,
        };
      }
    }
    const orderedMine = unit.order?.objectiveId ? this.mines.get(unit.order.objectiveId) : null;
    const engagementRange =
      unit.type === "artillery"
        ? UNIT_TYPES.artillery.range + 35
        : unit.type === "ranger"
          ? 360
          : 320;
    const lockedTarget = unit.combatTargetId ? this.units.get(unit.combatTargetId) : null;
    if (lockedTarget?.team === enemyTeam) {
      const lockedDistance = Phaser.Math.Distance.Between(
        unit.x,
        unit.y,
        lockedTarget.x,
        lockedTarget.y
      );
      const lockLeash = engagementRange + (unit.type === "artillery" ? 80 : 45);
      if (lockedDistance <= lockLeash) {
        return {
          kind: "unit",
          entity: lockedTarget,
          x: lockedTarget.x,
          y: lockedTarget.y,
          distance: lockedDistance,
        };
      }
    }

    const immediateEnemy = this.findPriorityEnemy(unit, enemyTeam, engagementRange);
    if (immediateEnemy) {
      unit.combatTargetId = immediateEnemy.entity.id;
      return immediateEnemy;
    }

    if (orderedMine) {
      const lockedContestant = unit.combatTargetId
        ? this.units.get(unit.combatTargetId)
        : null;
      if (
        lockedContestant?.team === enemyTeam &&
        Phaser.Math.Distance.Between(
          lockedContestant.x,
          lockedContestant.y,
          orderedMine.x,
          orderedMine.y
        ) <= 300
      ) {
        return {
          kind: "unit",
          entity: lockedContestant,
          x: lockedContestant.x,
          y: lockedContestant.y,
          distance: Phaser.Math.Distance.Between(
            unit.x,
            unit.y,
            lockedContestant.x,
            lockedContestant.y
          ),
        };
      }

      unit.combatTargetId = null;
      let closestContestant = null;
      for (const enemy of this.unitsForTeam(enemyTeam)) {
        const enemyMineDistance = Phaser.Math.Distance.Between(
          enemy.x,
          enemy.y,
          orderedMine.x,
          orderedMine.y
        );
        if (enemyMineDistance > 275) continue;

        const unitDistance = Phaser.Math.Distance.Between(unit.x, unit.y, enemy.x, enemy.y);
        const priority = this.targetPriority(unit, enemy, unitDistance);
        if (!closestContestant || priority < closestContestant.priority) {
          closestContestant = {
            kind: "unit",
            entity: enemy,
            x: enemy.x,
            y: enemy.y,
            distance: unitDistance,
            priority,
          };
        }
      }

      if (closestContestant) {
        unit.combatTargetId = closestContestant.entity.id;
        delete closestContestant.priority;
        return closestContestant;
      }

      if (orderedMine.owner === unit.team) {
        if (unit.order?.automatic && unit.order.strategy?.startsWith("defend-mine:")) {
          return null;
        }
        if (unit.order?.automatic) {
          unit.order = null;
        } else {
          return null;
        }
      } else if (orderedMine.owner !== unit.team) {
        return {
          kind: "mine",
          entity: orderedMine,
          x: orderedMine.x,
          y: orderedMine.y,
          distance: Math.max(
            0,
            Phaser.Math.Distance.Between(unit.x, unit.y, orderedMine.x, orderedMine.y) - 30
          ),
        };
      }
    }

    unit.combatTargetId = null;
    let closest = null;

    for (const enemy of this.unitsForTeam(enemyTeam)) {
      const distance = Phaser.Math.Distance.Between(unit.x, unit.y, enemy.x, enemy.y);
      const priority = this.targetPriority(unit, enemy, distance);
      if (!closest || priority < closest.priority) {
        closest = { kind: "unit", entity: enemy, x: enemy.x, y: enemy.y, distance, priority };
      }
    }

    const baseX = enemyTeam === "host" ? HOST_BASE_X : GUEST_BASE_X;
    const baseDistance = Math.max(0, Phaser.Math.Distance.Between(unit.x, unit.y, baseX, BASE_Y) - 48);
    if (!closest || baseDistance < closest.priority) {
      closest = { kind: "base", team: enemyTeam, x: baseX, y: BASE_Y, distance: baseDistance };
    } else {
      delete closest.priority;
      unit.combatTargetId = closest.entity.id;
    }

    return closest;
  }

  findPriorityEnemy(unit, enemyTeam, maxDistance) {
    let closest = null;
    for (const enemy of this.unitsForTeam(enemyTeam)) {
      const distance = Phaser.Math.Distance.Between(unit.x, unit.y, enemy.x, enemy.y);
      if (distance > maxDistance) continue;
      const priority = this.targetPriority(unit, enemy, distance);
      if (!closest || priority < closest.priority) {
        closest = { kind: "unit", entity: enemy, x: enemy.x, y: enemy.y, distance, priority };
      }
    }
    if (closest) delete closest.priority;
    return closest;
  }

  targetPriority(unit, enemy, distance) {
    const preferredTargets = {
      soldier: ["ranger", "medic", "artillery"],
      ranger: ["tank", "artillery"],
      tank: ["soldier"],
      artillery: ["ranger", "medic"],
    }[unit.type] || [];
    const pursuitRange = unit.type === "ranger" ? 360 : 260;
    const preferred = preferredTargets.includes(enemy.type) && distance <= pursuitRange ? 120 : 0;
    const focusCount = this.unitContext?.focusCounts.get(enemy.id) || 0;
    const threatenedSupport = this.unitContext?.threatensSupport.has(enemy.id) || false;
    const protectionPriority =
      threatenedSupport && unit.type === "tank"
        ? 175
        : threatenedSupport && unit.type === "soldier"
          ? 125
          : threatenedSupport
            ? 75
            : 0;
    const nearbyEnemies =
      unit.type === "artillery"
        ? this.unitContext?.nearbySplashCounts.get(enemy.id) || 0
        : 0;

    return distance - preferred - Math.min(focusCount, 3) * 18 - protectionPriority -
      Math.max(0, nearbyEnemies - 1) * 16;
  }

  defaultDestination(unit) {
    return {
      x: unit.team === "host" ? GUEST_BASE_X : HOST_BASE_X,
      y: BASE_Y,
    };
  }

  moveUnitToward(unit, x, y, speed, deltaSeconds) {
    if (speed <= 0) return;
    const distance = Phaser.Math.Distance.Between(unit.x, unit.y, x, y);
    if (distance < 5) return;
    const step = Math.min(distance, speed * deltaSeconds);
    unit.rotation = Math.atan2(y - unit.y, x - unit.x) + Math.PI / 2;
    unit.x += ((x - unit.x) / distance) * step;
    unit.y += ((y - unit.y) / distance) * step;
  }

  moveUnitAwayFrom(unit, x, y, speed, deltaSeconds) {
    const distance = Phaser.Math.Distance.Between(unit.x, unit.y, x, y);
    if (distance < 0.1) return;
    const step = speed * deltaSeconds;
    const nextX = unit.x + ((unit.x - x) / distance) * step;
    const nextY = unit.y + ((unit.y - y) / distance) * step;
    unit.rotation = Math.atan2(y - unit.y, x - unit.x) + Math.PI / 2;
    unit.x = Phaser.Math.Clamp(nextX, 45, WORLD_WIDTH - 45);
    unit.y = Phaser.Math.Clamp(nextY, 75, WORLD_HEIGHT - 45);
  }

  attackDamage(attacker, target) {
    const baseDamage =
      UNIT_TYPES[attacker.type].damage * (attacker.tacticalMode === "surge" ? 1.08 : 1);
    if (target.kind !== "unit" || target.entity.type !== "tank") return baseDamage;

    const tankSupported =
      this.unitContext?.supportedTanks.has(target.entity.id) ||
      this.unitsForTeam(target.entity.team).some(
        (ally) =>
          ally.id !== target.entity.id &&
          Phaser.Math.Distance.Between(ally.x, ally.y, target.entity.x, target.entity.y) <= 150
      );
    const armor =
      UNIT_TYPES[attacker.type].armorPiercing || !tankSupported ? 0 : UNIT_TYPES.tank.armor;
    return Math.max(1, baseDamage - armor);
  }

  resolveAttackIntents(attackIntents, time) {
    const unitDamage = new Map();
    const baseDamage = { host: 0, guest: 0 };
    const mineDamage = new Map();

    for (const intent of attackIntents) {
      const { target, damage, attackingTeam } = intent;
      intent.unit.rotation =
        Math.atan2(target.y - intent.unit.y, target.x - intent.unit.x) + Math.PI / 2;
      this.showAttackPulse(intent.unit, target);

      if (target.kind === "unit") {
        if (intent.unit.type === "artillery") {
          for (const enemy of this.unitsForTeam(intent.unit.team === "host" ? "guest" : "host")) {
            const splashDistance = Phaser.Math.Distance.Between(
              enemy.x,
              enemy.y,
              target.entity.x,
              target.entity.y
            );
            if (splashDistance > UNIT_TYPES.artillery.splashRadius) continue;
            const splashScale = enemy.id === target.entity.id ? 1 : 0.55;
            const splashDamage = this.attackDamage(intent.unit, {
              kind: "unit",
              entity: enemy,
            });
            unitDamage.set(
              enemy.id,
              (unitDamage.get(enemy.id) || 0) + splashDamage * splashScale
            );
          }
        } else {
          unitDamage.set(target.entity.id, (unitDamage.get(target.entity.id) || 0) + damage);
        }
        this.applyHitMechanics(intent.unit, target.entity, time);
      } else if (target.kind === "base") {
        baseDamage[target.team] += damage;
      } else if (target.kind === "mine") {
        const damageByTeam = mineDamage.get(target.entity.id) || { host: 0, guest: 0 };
        damageByTeam[attackingTeam] += damage;
        mineDamage.set(target.entity.id, damageByTeam);
      }
    }

    for (const [id, damage] of unitDamage) {
      const unit = this.units.get(id);
      if (!unit) continue;
      const receivedMultiplier =
        unit.tacticalMode === "brace" ? 0.68 : unit.tacticalMode === "surge" ? 1.2 : 1;
      unit.health -= damage * receivedMultiplier;
    }

    for (const team of ["host", "guest"]) {
      this.baseHealth[team] = Math.max(0, this.baseHealth[team] - baseDamage[team]);
    }

    for (const [id, damageByTeam] of mineDamage) {
      const mine = this.mines.get(id);
      if (!mine) continue;

      mine.health -= damageByTeam.host + damageByTeam.guest;
      if (mine.health > 0) continue;

      if (damageByTeam.host === damageByTeam.guest) {
        mine.health = 1;
        continue;
      }

      const capturingTeam = damageByTeam.host > damageByTeam.guest ? "host" : "guest";
      mine.owner = capturingTeam;
      mine.health = mine.maxHealth;
      this.showWorldBurst(mine.x, mine.y, TEAM_COLORS[capturingTeam], 18, 115);
      for (const unit of this.units.values()) {
        if (
          unit.order?.objectiveId === mine.id &&
          unit.order.automatic &&
          unit.team === capturingTeam
        ) {
          unit.order = null;
        }
      }
      this.updateHud();
    }

    for (const [id] of unitDamage) {
      const unit = this.units.get(id);
      if (!unit || unit.health > 0) continue;

      // Unit kills never award credits; income only comes from time and controlled mines.
      this.showWorldBurst(unit.x, unit.y, TEAM_COLORS[unit.team], 8, 38);
      this.units.delete(id);
      this.destroyUnitView(id);
    }
  }

  applyHitMechanics(attacker, target, time) {
    if (attacker.type === "soldier" && target.type === "ranger") {
      target.pinnedUntil = Math.max(
        target.pinnedUntil || 0,
        time + UNIT_TYPES.soldier.rangerPinDuration
      );
      target.disruptedUntil = Math.max(
        target.disruptedUntil || 0,
        time + UNIT_TYPES.soldier.rangerDisruptDuration
      );
      return;
    }

    if (attacker.type !== "tank" || target.type !== "soldier") return;

    const distance = Phaser.Math.Distance.Between(attacker.x, attacker.y, target.x, target.y);
    if (distance < 0.1) return;
    const knockback = UNIT_TYPES.tank.soldierKnockback;
    target.x = Phaser.Math.Clamp(
      target.x + ((target.x - attacker.x) / distance) * knockback,
      45,
      WORLD_WIDTH - 45
    );
    target.y = Phaser.Math.Clamp(
      target.y + ((target.y - attacker.y) / distance) * knockback,
      75,
      WORLD_HEIGHT - 45
    );
  }

  showAttackPulse(unit, target) {
    if (this.activeCombatEffects >= MAX_COMBAT_EFFECTS) return;
    this.activeCombatEffects += 2;
    const line = this.add
      .line(0, 0, unit.x, unit.y, target.x, target.y, TEAM_COLORS[unit.team], 0.8)
      .setOrigin(0)
      .setDepth(3);
    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 110,
      onComplete: () => {
        line.destroy();
        this.activeCombatEffects = Math.max(0, this.activeCombatEffects - 1);
      },
    });

    const flash = this.add.circle(target.x, target.y, 4, TEAM_COLORS[unit.team], 0.9).setDepth(8);
    this.tweens.add({
      targets: flash,
      scale: 2.5,
      alpha: 0,
      duration: 140,
      onComplete: () => {
        flash.destroy();
        this.activeCombatEffects = Math.max(0, this.activeCombatEffects - 1);
      },
    });
  }

  showHealPulse(unit, target) {
    if (this.activeCombatEffects >= MAX_COMBAT_EFFECTS) return;
    this.activeCombatEffects += 1;
    const line = this.add
      .line(0, 0, unit.x, unit.y, target.x, target.y, 0x8cf4dc, 0.75)
      .setOrigin(0)
      .setDepth(8);
    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 220,
      onComplete: () => {
        line.destroy();
        this.activeCombatEffects = Math.max(0, this.activeCombatEffects - 1);
      },
    });
  }

  showWorldBurst(x, y, color, count, radius) {
    const availableEffects = Math.max(0, MAX_COMBAT_EFFECTS - this.activeCombatEffects);
    const particleCount = Math.min(count, availableEffects);
    this.activeCombatEffects += particleCount;
    for (let index = 0; index < particleCount; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Phaser.Math.FloatBetween(-0.15, 0.15);
      const distance = Phaser.Math.Between(Math.round(radius * 0.55), radius);
      const particle = this.add
        .circle(x, y, Phaser.Math.Between(2, 5), color, 0.85)
        .setDepth(10);
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.25,
        duration: Phaser.Math.Between(280, 520),
        ease: "Cubic.Out",
        onComplete: () => {
          particle.destroy();
          this.activeCombatEffects = Math.max(0, this.activeCombatEffects - 1);
        },
      });
    }
  }

  unitStrength(unit) {
    const definition = UNIT_TYPES[unit.type];
    const healthRatio = Phaser.Math.Clamp(unit.health / unit.maxHealth, 0, 1);
    const nearbyAllies = this.unitsForTeam(unit.team).filter(
      (ally) =>
        ally.team === unit.team &&
        ally.id !== unit.id &&
        Phaser.Math.Distance.Between(ally.x, ally.y, unit.x, unit.y) <= 220
    );
    let coordinationFactor = 1;
    if (unit.type === "tank" && nearbyAllies.length === 0) coordinationFactor = 0.82;
    if (
      unit.type === "artillery" &&
      !nearbyAllies.some((ally) => ["soldier", "tank"].includes(ally.type))
    ) {
      coordinationFactor = 0.68;
    }
    if (unit.type === "medic") {
      coordinationFactor = Math.min(1, 0.55 + nearbyAllies.length * 0.15);
    }

    return definition.strategicPower * (0.35 + healthRatio * 0.65) * coordinationFactor;
  }

  armyStrength(units) {
    return units.reduce((total, unit) => total + this.unitStrength(unit), 0);
  }

  chooseBotPurchase(botUnits, enemyUnits, credits) {
    const counts = { soldier: 0, ranger: 0, tank: 0, medic: 0, artillery: 0 };
    const enemyCounts = { soldier: 0, ranger: 0, tank: 0, medic: 0, artillery: 0 };
    botUnits.forEach((unit) => {
      counts[unit.type] += 1;
    });
    enemyUnits.forEach((unit) => {
      enemyCounts[unit.type] += 1;
    });

    const frontlineCount = counts.soldier + counts.tank;
    const supportCount = counts.ranger + counts.medic + counts.artillery;
    const desiredTanks = Math.max(1, Math.ceil(supportCount / 3));
    const woundedAllies = botUnits.filter((unit) => unit.health < unit.maxHealth * 0.72).length;
    const scores = {
      soldier:
        55 +
        enemyCounts.ranger * 22 +
        enemyCounts.medic * 18 +
        enemyCounts.artillery * 20 -
        counts.soldier * 7,
      ranger: 48 + enemyCounts.tank * 34 + enemyCounts.artillery * 12 - counts.ranger * 10,
      tank:
        42 +
        enemyCounts.soldier * 27 +
        (counts.ranger + counts.medic + counts.artillery) * 5 -
        counts.tank * 14 +
        Math.max(0, desiredTanks - counts.tank) * 46,
      medic:
        (botUnits.length >= 4 ? 48 : 5) +
        woundedAllies * 18 +
        frontlineCount * 5 -
        counts.medic * 48,
      artillery:
        (frontlineCount >= 3 ? 44 : 4) +
        enemyUnits.length * 4 +
        enemyCounts.tank * 10 -
        counts.artillery * 52,
    };

    const ranked = Object.keys(UNIT_TYPES).sort((left, right) => scores[right] - scores[left]);
    const desiredType = ranked[0];
    if (UNIT_TYPES[desiredType].cost <= credits) return desiredType;

    const affordable = ranked
      .filter((type) => UNIT_TYPES[type].cost <= credits)
      .sort(
        (left, right) =>
          scores[right] / UNIT_TYPES[right].cost - scores[left] / UNIT_TYPES[left].cost
      );
    if (botUnits.length < 4) return affordable[0] || null;
    if (!affordable[0] || scores[affordable[0]] < scores[desiredType] * 0.72) return null;
    return affordable[0];
  }

  commandTeamGroup(team, units, x, y, objectiveId = null, strategy = null) {
    if (units.length === 0) return;

    const formationPriority = { tank: 0, soldier: 1, ranger: 2, medic: 3, artillery: 4 };
    const unitIds = [...units]
      .sort(
        (left, right) =>
          formationPriority[left.type] - formationPriority[right.type] ||
          Number(left.id) - Number(right.id)
      )
      .map((unit) => unit.id);

    this.applyCommand(team, {
      action: "move",
      unitIds,
      x,
      y,
      objectiveId,
      automatic: true,
      strategy,
    });
  }

  takeBotUnitsByStrength(pool, requiredStrength, preference = () => 0) {
    const candidates = [...pool].sort(
      (left, right) =>
        preference(right) - preference(left) ||
        this.unitStrength(right) - this.unitStrength(left)
    );
    const selected = [];
    let selectedStrength = 0;

    for (const unit of candidates) {
      if (selectedStrength >= requiredStrength && selected.length > 0) break;
      selected.push(unit);
      selectedStrength += this.unitStrength(unit);
      pool.delete(unit);
    }

    return selected;
  }

  commandTeamArmy(team, teamUnits, enemyUnits, time) {
    const enemyTeam = team === "host" ? "guest" : "host";
    const ownBaseX = team === "host" ? HOST_BASE_X : GUEST_BASE_X;
    const enemyBaseX = team === "host" ? GUEST_BASE_X : HOST_BASE_X;
    const direction = team === "host" ? 1 : -1;
    const ownBaseThreats = enemyUnits.filter(
      (unit) => Phaser.Math.Distance.Between(unit.x, unit.y, ownBaseX, BASE_Y) <= 430
    );
    const baseThreatStrength = this.armyStrength(ownBaseThreats);
    const totalTeamStrength = this.armyStrength(teamUnits);
    const totalEnemyStrength = this.armyStrength(enemyUnits);
    const strategicAdvantage =
      teamUnits.length >= 5 &&
      baseThreatStrength === 0 &&
      (totalEnemyStrength === 0 || totalTeamStrength >= totalEnemyStrength * 1.3);
    const badlyOutmatched =
      totalEnemyStrength > 0 && totalTeamStrength < totalEnemyStrength * 0.68;
    const available = new Set(
      teamUnits.filter((unit) => {
        const order = unit.order;
        if (!order) return true;
        if (!order.automatic) return false;
        if (order.objectiveId) {
          if (strategicAdvantage && order.strategy?.startsWith("objective:")) return true;
          const mine = this.mines.get(order.objectiveId);
          if (!mine) return true;
          const nearbyAllies = teamUnits.filter(
            (ally) => Phaser.Math.Distance.Between(ally.x, ally.y, mine.x, mine.y) <= 300
          );
          const nearbyEnemies = enemyUnits.filter(
            (enemy) => Phaser.Math.Distance.Between(enemy.x, enemy.y, mine.x, mine.y) <= 330
          );
          const allyStrength = this.armyStrength(nearbyAllies);
          const enemyStrength = this.armyStrength(nearbyEnemies);
          if (order.strategy?.startsWith("defend-mine:") && nearbyEnemies.length > 0) {
            return enemyStrength > allyStrength * 1.7;
          }
          if (mine.owner !== team) {
            return enemyStrength > allyStrength * 1.7;
          }
          return true;
        }
        return time - (order.assignedAt || 0) >= 3000;
      })
    );
    if (available.size === 0) return;

    if (baseThreatStrength > 0) {
      const defenders = this.takeBotUnitsByStrength(
        available,
        baseThreatStrength * 1.35,
        (unit) => (unit.type === "tank" ? 3 : unit.type === "ranger" ? 2 : 1)
      );
      const threatY =
        ownBaseThreats.reduce((total, unit) => total + unit.y, 0) / ownBaseThreats.length;
      this.commandTeamGroup(
        team,
        defenders,
        ownBaseX + direction * 150,
        threatY,
        null,
        "defend"
      );
      this.applyCommand(team, {
        action: "tactical",
        unitIds: defenders.map((unit) => unit.id),
        mode: "brace",
      });
    }
    if (available.size === 0) return;

    const availableArmyStrength = this.armyStrength([...available]);
    const hasDecisiveAdvantage =
      strategicAdvantage ||
      (available.size >= 5 &&
        baseThreatStrength === 0 &&
        (totalEnemyStrength === 0 || availableArmyStrength >= totalEnemyStrength * 1.3));

    const minePlans = [...this.mines.values()]
      .map((mine) => {
        const nearbyEnemies = enemyUnits.filter(
          (unit) => Phaser.Math.Distance.Between(unit.x, unit.y, mine.x, mine.y) < 320
        );
        const nearbyAllies = teamUnits.filter(
          (unit) => Phaser.Math.Distance.Between(unit.x, unit.y, mine.x, mine.y) < 260
        );
        const enemyStrength = this.armyStrength(nearbyEnemies);
        const allyStrength = this.armyStrength(nearbyAllies);
        const distance = Math.abs(mine.x - ownBaseX) + Math.abs(mine.y - BASE_Y) * 0.55;
        const threatened = mine.owner === team && enemyStrength > allyStrength * 0.8;
        const capturable = mine.owner !== team;
        const ownershipValue = mine.owner === enemyTeam ? 220 : mine.owner === null ? 150 : 0;
        const urgency = threatened ? 420 : 0;

        return {
          mine,
          enemyStrength,
          allyStrength,
          threatened,
          capturable,
          score:
            enemyStrength * 3.2 +
            distance * 0.12 -
            allyStrength * 0.5 -
            ownershipValue -
            urgency,
        };
      })
      .sort((left, right) => left.score - right.score);

    let assignedObjectives = 0;
    for (const plan of minePlans) {
      const objectiveLimit = hasDecisiveAdvantage || badlyOutmatched ? 1 : 2;
      if (available.size < 2 || assignedObjectives >= objectiveLimit) break;
      if (!plan.threatened && !plan.capturable) continue;
      if (hasDecisiveAdvantage && !plan.threatened) continue;
      const availableStrength = this.armyStrength([...available]);
      if (
        badlyOutmatched &&
        plan.enemyStrength > Math.max(UNIT_TYPES.soldier.strategicPower, availableStrength * 0.4)
      ) {
        continue;
      }
      const requiredRatio = plan.threatened ? 1.18 : 1.4;
      if (plan.enemyStrength > 0 && availableStrength < plan.enemyStrength * requiredRatio) {
        continue;
      }

      const requiredStrength = Math.max(
        UNIT_TYPES.soldier.cost * 2,
        plan.enemyStrength * (plan.threatened ? 1.3 : 1.5)
      );
      const squad = this.takeBotUnitsByStrength(
        available,
        requiredStrength,
        (unit) =>
          unit.type === "tank"
            ? 3
            : unit.type === "medic"
              ? 2
              : unit.type === "ranger"
                ? 1
                : 0
      );
      this.commandTeamGroup(
        team,
        squad,
        plan.mine.x,
        plan.mine.y,
        plan.mine.id,
        plan.threatened ? `defend-mine:${plan.mine.id}` : `objective:${plan.mine.id}`
      );
      assignedObjectives += 1;
    }

    const remaining = [...available];
    if (remaining.length === 0) return;

    const remainingStrength = this.armyStrength(remaining);
    const enemyStrength = this.armyStrength(enemyUnits);
    const ownedMines = [...this.mines.values()].filter((mine) => mine.owner === team).length;
    const enemyMines = [...this.mines.values()].filter((mine) => mine.owner === enemyTeam).length;
    const shouldAttack =
      remaining.length >= 5 &&
      baseThreatStrength === 0 &&
      (hasDecisiveAdvantage ||
        remainingStrength >= enemyStrength * 1.18 ||
        (ownedMines > enemyMines && remainingStrength >= enemyStrength * 0.95) ||
        this.baseHealth[enemyTeam] < this.baseMaxHealth * 0.35);

    if (shouldAttack) {
      this.commandTeamGroup(
        team,
        remaining,
        enemyBaseX,
        BASE_Y,
        null,
        "attack"
      );
      this.applyCommand(team, {
        action: "tactical",
        unitIds: remaining.map((unit) => unit.id),
        mode: "surge",
      });
    } else {
      const defensivePosture =
        badlyOutmatched || this.baseHealth[team] < this.baseMaxHealth * 0.55;
      this.commandTeamGroup(
        team,
        remaining,
        defensivePosture ? ownBaseX + direction * 250 : WORLD_WIDTH / 2 - direction * 180,
        BASE_Y,
        null,
        defensivePosture ? "regroup" : "stage"
      );
    }
  }

  updateAutonomousPurchasing(time) {
    for (const team of ["host", "guest"]) {
      if (time - this.lastAiPurchaseAt[team] < 1750) continue;
      const teamUnits = [...this.units.values()].filter((unit) => unit.team === team);
      const enemyUnits = [...this.units.values()].filter((unit) => unit.team !== team);
      if (teamUnits.length >= MAX_UNITS_PER_TEAM) {
        this.lastAiPurchaseAt[team] = time;
        continue;
      }

      const preferredType = this.chooseBotPurchase(teamUnits, enemyUnits, this.credits[team]);
      if (preferredType) this.buyUnit(team, preferredType);
      this.lastAiPurchaseAt[team] = time;
    }
  }

  updateStrategicCommanders(time) {
    if (time - this.lastAutoCommandAt < AUTO_COMMAND_INTERVAL) return;

    for (const team of ["host", "guest"]) {
      const teamUnits = [...this.units.values()].filter((unit) => unit.team === team);
      const enemyUnits = [...this.units.values()].filter((unit) => unit.team !== team);
      this.commandTeamArmy(team, teamUnits, enemyUnits, time);
    }

    this.lastAutoCommandAt = time;
  }

  checkVictory() {
    const defeatedTeam = this.baseHealth.host <= 0 ? "host" : this.baseHealth.guest <= 0 ? "guest" : null;
    if (!defeatedTeam) return;

    this.finished = true;
    const winner = defeatedTeam === "host" ? "guest" : "host";
    this.broadcastSnapshot(true, winner);
    this.showResult(winner);
  }

  requestRematch() {
    if (!this.finished) return;
    if (this.isAuthority) {
      this.resetMatch();
    } else {
      this.options.sendCommand?.({ action: "rematch", roundId: this.roundId });
      this.setStatus("Rematch requested", "success", 0);
    }
  }

  resetMatch() {
    for (const object of this.resultObjects) object.destroy();
    this.resultObjects = [];
    for (const id of [...this.unitViews.keys()]) this.destroyUnitView(id);
    this.units.clear();
    this.selectedIds.clear();
    this.pendingLocalHolds.clear();
    this.processedRemoteCommandIds.clear();
    this.credits = { host: STARTING_CREDITS, guest: STARTING_CREDITS };
    this.baseHealth = { host: this.baseMaxHealth, guest: this.baseMaxHealth };
    for (const mine of this.mines.values()) {
      mine.owner = null;
      mine.health = mine.maxHealth;
    }
    this.nextUnitId = 1;
    this.lastIncomeAt = 0;
    this.lastAiPurchaseAt = { host: 0, guest: 0 };
    this.lastAutoCommandAt = 0;
    this.lastSnapshotAt = 0;
    this.lastHudSignature = "";
    this.keyboardMineIndex = -1;
    this.finished = false;
    this.roundId += 1;
    this.statusMessage = "New round started";
    this.statusTone = "success";
    this.statusUntil = Date.now() + 2400;
    this.centerCameraOnLocalBase();

    if (this.isAuthority) {
      this.spawnUnit("host", "soldier");
      this.spawnUnit("guest", "soldier");
      this.broadcastSnapshot(true);
    }
    this.updateHud(true);
  }

  showResult(winner) {
    const won = winner === this.localTeam;
    const camera = this.cameras.main;
    const centerX = camera.width / 2;
    const centerY = camera.height / 2;
    const titleOffset = Math.min(64, camera.height * 0.2);
    const playOffset = Math.min(76, camera.height * 0.22);
    const leaveOffset = Math.min(132, camera.height * 0.38);
    const compactOverlay = camera.height < 400;
    const overlay = this.add
      .rectangle(centerX, centerY, camera.width, camera.height, 0x05080e, 0.82)
      .setScrollFactor(0)
      .setDepth(40);
    const title = this.add
      .text(centerX, centerY - titleOffset, won ? "VICTORY" : "DEFEAT", {
        color: won ? "#58e6c2" : "#ff647c",
        fontFamily: "system-ui",
        fontSize: `${Phaser.Math.Clamp(
          Math.min(camera.width * 0.06, camera.height * 0.16),
          30,
          68
        )}px`,
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(41);
    const subtitle = this.add
      .text(centerX, centerY, "Press Enter or choose Play again", {
        color: "#dbeafe",
        fontFamily: "system-ui",
        fontSize: compactOverlay ? "14px" : "19px",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(41);
    const playAgain = this.add
      .text(centerX, centerY + playOffset, "PLAY AGAIN", {
        color: "#07110f",
        backgroundColor: "#58e6c2",
        fontFamily: "system-ui",
        fontSize: compactOverlay ? "15px" : "18px",
        fontStyle: "bold",
        padding: compactOverlay ? { x: 16, y: 8 } : { x: 22, y: 12 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(42)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.requestRematch());
    const leave = this.add
      .text(centerX, centerY + leaveOffset, "LEAVE ROOM", {
        color: "#dbeafe",
        backgroundColor: "#172337",
        fontFamily: "system-ui",
        fontSize: compactOverlay ? "13px" : "16px",
        fontStyle: "bold",
        padding: compactOverlay ? { x: 14, y: 7 } : { x: 20, y: 10 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(42)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.options.onExit?.());
    overlay.setInteractive();
    this.resultObjects = [overlay, title, subtitle, playAgain, leave];
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
      view.sprite.setPosition(viewX, viewY).setRotation(unit.rotation || 0);
      view.shadow.setPosition(viewX, viewY + definition.radius * 0.45);
      view.ring.setPosition(viewX, viewY);
      view.healthBack.setPosition(viewX, viewY - definition.radius - 9);
      view.healthFill.setPosition(viewX - definition.radius * 1.1, viewY - definition.radius - 9);
      view.healthFill.width = definition.radius * 2.2 * healthRatio;
      const showHealth = healthRatio < 0.995 || this.selectedIds.has(unit.id);
      view.healthBack.setAlpha(showHealth ? 0.9 : 0.22);
      view.healthFill.setAlpha(showHealth ? 1 : 0.3);
      const tacticalColor =
        unit.tacticalMode === "surge"
          ? 0xf6c453
          : unit.tacticalMode === "brace"
            ? 0x8bb8ff
            : TEAM_COLORS[unit.team];
      view.ring
        .setStrokeStyle(unit.tacticalMode ? 3 : 2, tacticalColor, unit.tacticalMode ? 0.9 : 0.4)
        .setScale(unit.tacticalMode ? 1.12 : 1);
    }

    for (const id of [...this.unitViews.keys()]) {
      if (!this.units.has(id)) this.destroyUnitView(id);
    }

    for (const team of ["host", "guest"]) {
      const ratio = Phaser.Math.Clamp(this.baseHealth[team] / this.baseMaxHealth, 0, 1);
      this.baseViews[team].healthFill.width = 130 * ratio;
    }

    for (const mine of this.mines.values()) {
      const view = this.mineViews.get(mine.id);
      const color = mine.owner ? TEAM_COLORS[mine.owner] : 0xf6c453;
      const ratio = Phaser.Math.Clamp(mine.health / mine.maxHealth, 0, 1);
      if (view.renderedOwner !== mine.owner) {
        view.renderedOwner = mine.owner;
        view.zone.setFillStyle(color, 0.08).setStrokeStyle(2, color, 0.4);
        view.body.setFillStyle(color, 0.9);
        view.core.setFillStyle(mine.owner ? 0xffffff : 0xffec99, 1);
        view.healthFill.setFillStyle(color, 1);
        view.label.setText(
          `${mine.label} - ${mine.owner ? mine.owner.toUpperCase() : "NEUTRAL"}`
        );
        view.label.setColor(
          mine.owner ? (mine.owner === "host" ? "#8ef4dc" : "#ff9dad") : "#f8df91"
        );
      }
      view.healthFill.width = 90 * ratio;
    }

    this.redrawSelection();
  }

  redrawSelection(force = false) {
    const now = this.time?.now || 0;
    if (!force && now - this.lastSelectionDrawAt < 50) return;
    this.lastSelectionDrawAt = now;
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

  updateHud(force = false) {
    if (this.statusUntil && Date.now() >= this.statusUntil) {
      this.statusMessage = "Commander active";
      this.statusTone = "neutral";
      this.statusUntil = 0;
    }
    const selected = [...this.selectedIds].filter((id) => this.units.get(id)?.team === this.localTeam).length;
    const mineCounts = { host: 0, guest: 0 };
    let localUnitCount = 0;
    const strategyCounts = new Map();
    for (const unit of this.units.values()) {
      if (unit.team !== this.localTeam) continue;
      localUnitCount += 1;
      const strategy = unit.order?.automatic ? unit.order.strategy : null;
      if (strategy) strategyCounts.set(strategy, (strategyCounts.get(strategy) || 0) + 1);
    }
    for (const mine of this.mines.values()) {
      if (mine.owner) mineCounts[mine.owner] += 1;
    }

    const dominantStrategy = [...strategyCounts.entries()].sort(
      (left, right) => right[1] - left[1]
    )[0]?.[0];
    const commanderState = dominantStrategy?.startsWith("objective:")
      ? "CONTESTING"
      : dominantStrategy?.startsWith("defend")
        ? "DEFENDING"
        : dominantStrategy === "regroup"
          ? "RECOVERING"
        : dominantStrategy === "attack"
          ? "ATTACKING"
          : "STAGING";
    const selectedTacticalCooldowns = [...this.selectedIds]
      .map((id) => this.units.get(id))
      .filter(Boolean)
      .map((unit) => Math.max(0, (unit.tacticalReadyAt || 0) - this.time.now));
    const hud = {
      credits: Math.floor(this.credits[this.localTeam]),
      income:
        INCOME_PER_SECOND + mineCounts[this.localTeam] * MINE_INCOME_PER_SECOND,
      baseHealth: Math.ceil(this.baseHealth[this.localTeam]),
      enemyBaseHealth: Math.ceil(this.baseHealth[this.remoteTeam]),
      ownedMines: mineCounts[this.localTeam],
      enemyMines: mineCounts[this.remoteTeam],
      selected,
      unitCount: localUnitCount,
      unitCap: MAX_UNITS_PER_TEAM,
      commanderState,
      statusMessage: this.statusMessage,
      statusTone: this.statusTone,
      tacticalCooldown:
        selectedTacticalCooldowns.length > 0
          ? Math.ceil(Math.min(...selectedTacticalCooldowns) / 1000)
          : 0,
      costs: Object.fromEntries(Object.entries(UNIT_TYPES).map(([key, value]) => [key, value.cost])),
    };
    const signature = JSON.stringify(hud);
    if (!force && signature === this.lastHudSignature) return;
    this.lastHudSignature = signature;
    this.options.onHud?.(hud);
  }

  createSnapshot(winner = null) {
    return {
      version: 2,
      roundId: this.roundId,
      sentAt: Date.now(),
      credits: {
        host: Math.floor(this.credits.host),
        guest: Math.floor(this.credits.guest),
      },
      baseHealth: { ...this.baseHealth },
      automation: { ...this.automation },
      mines: [...this.mines.values()].map((mine) => ({
        id: mine.id,
        owner: mine.owner,
        health: Math.max(0, Math.round(mine.health)),
      })),
      units: [...this.units.values()].map((unit) => ({
        id: unit.id,
        team: unit.team,
        type: unit.type,
        x: Math.round(unit.x * 10) / 10,
        y: Math.round(unit.y * 10) / 10,
        health: Math.max(0, Math.round(unit.health)),
        maxHealth: unit.maxHealth,
        rotation: unit.rotation || 0,
        manualState:
          unit.order && !unit.order.automatic ? unit.order.strategy || "move" : null,
        manualCommandAt: unit.manualCommandAt || 0,
        tacticalMode: unit.tacticalMode || null,
        tacticalUntil: Math.max(0, (unit.tacticalUntil || 0) - this.time.now),
        tacticalReadyIn: Math.max(0, (unit.tacticalReadyAt || 0) - this.time.now),
        forcedTargetId: unit.forcedTargetId || null,
        forcedTargetUntil: Math.max(0, (unit.forcedTargetUntil || 0) - this.time.now),
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
      snapshot?.version === 2 &&
      snapshot.credits &&
      snapshot.baseHealth &&
      snapshot.automation &&
      Array.isArray(snapshot.mines) &&
      snapshot.mines.length === MINE_DEFINITIONS.length &&
      Array.isArray(snapshot.units) &&
      snapshot.units.length <= MAX_UNITS_PER_TEAM * 2
    );
  }

  applySnapshot(snapshot) {
    const sentAt = Number(snapshot.sentAt) || 0;
    if (sentAt && sentAt <= this.lastAppliedSnapshotAt) return;
    if (sentAt) this.lastAppliedSnapshotAt = sentAt;
    const incomingRoundId = Math.max(1, Number(snapshot.roundId) || 1);
    if (incomingRoundId > this.roundId) {
      for (const object of this.resultObjects) object.destroy();
      this.resultObjects = [];
      this.finished = false;
      this.roundId = incomingRoundId;
      this.selectedIds.clear();
      this.pendingLocalHolds.clear();
      this.lastHudSignature = "";
      this.centerCameraOnLocalBase();
    }

    this.credits = {
      host: Number(snapshot.credits.host) || 0,
      guest: Number(snapshot.credits.guest) || 0,
    };
    this.baseHealth = {
      host: Phaser.Math.Clamp(Number(snapshot.baseHealth.host) || 0, 0, this.baseMaxHealth),
      guest: Phaser.Math.Clamp(Number(snapshot.baseHealth.guest) || 0, 0, this.baseMaxHealth),
    };
    this.automation = {
      host: snapshot.automation.host !== false,
      guest: snapshot.automation.guest !== false,
    };

    for (const incoming of snapshot.mines) {
      const mine = this.mines.get(incoming.id);
      if (!mine) continue;
      mine.owner = ["host", "guest"].includes(incoming.owner) ? incoming.owner : null;
      mine.health = Phaser.Math.Clamp(Number(incoming.health) || 0, 0, mine.maxHealth);
    }

    const nextIds = new Set();
    for (const incoming of snapshot.units) {
      if (!UNIT_TYPES[incoming.type] || !["host", "guest"].includes(incoming.team)) continue;
      const id = String(incoming.id);
      nextIds.add(id);
      const existing = this.units.get(id);
      const incomingManualState =
        typeof incoming.manualState === "string" ? incoming.manualState : null;
      const incomingManualCommandAt = Number(incoming.manualCommandAt) || 0;
      const pendingHold = this.pendingLocalHolds.get(id);
      if (pendingHold && Date.now() - pendingHold.issuedAt > 4000) {
        this.pendingLocalHolds.delete(id);
      }
      const activePendingHold = this.pendingLocalHolds.get(id);
      const holdAcknowledged =
        activePendingHold &&
        incomingManualState === "hold" &&
        incomingManualCommandAt >= activePendingHold.issuedAt;
      if (holdAcknowledged) this.pendingLocalHolds.delete(id);
      const preservePendingPosition = activePendingHold && !holdAcknowledged;
      const sanitized = {
        id,
        team: incoming.team,
        type: incoming.type,
        x: preservePendingPosition
          ? activePendingHold.x
          : Phaser.Math.Clamp(Number(incoming.x), 0, WORLD_WIDTH),
        y: preservePendingPosition
          ? activePendingHold.y
          : Phaser.Math.Clamp(Number(incoming.y), 60, WORLD_HEIGHT),
        health: Math.max(0, Number(incoming.health)),
        maxHealth: UNIT_TYPES[incoming.type].health,
        order:
          incomingManualState === "hold"
            ? {
                x: preservePendingPosition ? activePendingHold.x : Number(incoming.x),
                y: preservePendingPosition ? activePendingHold.y : Number(incoming.y),
                objectiveId: null,
                automatic: false,
                strategy: "hold",
                assignedAt: this.time.now,
              }
            : null,
        lastAttackAt: 0,
        rotation: Number(incoming.rotation) || 0,
        combatTargetId: null,
        pinnedUntil: 0,
        disruptedUntil: 0,
        manualCommandAt: incomingManualCommandAt,
        tacticalMode: ["surge", "brace"].includes(incoming.tacticalMode)
          ? incoming.tacticalMode
          : null,
        tacticalUntil: this.time.now + Math.max(0, Number(incoming.tacticalUntil) || 0),
        tacticalReadyAt: this.time.now + Math.max(0, Number(incoming.tacticalReadyIn) || 0),
        forcedTargetId:
          incoming.forcedTargetId === null || incoming.forcedTargetId === undefined
            ? null
            : String(incoming.forcedTargetId),
        forcedTargetUntil:
          this.time.now + Math.max(0, Number(incoming.forcedTargetUntil) || 0),
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
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    backgroundColor: "#101827",
    scale: {
      autoCenter: Phaser.Scale.CENTER_BOTH,
      mode: Phaser.Scale.RESIZE,
    },
    scene: new BattleScene(options),
  });
}
