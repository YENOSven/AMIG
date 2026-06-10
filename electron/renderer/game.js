import Phaser from "phaser";

const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 720;

class ArenaScene extends Phaser.Scene {
  constructor(options) {
    super("arena");
    this.options = options;
  }

  create() {
    this.cameras.main.setBackgroundColor("#101827");
    this.drawArena();

    const startsAsGuest = this.options.role === "guest";
    const playerX = startsAsGuest ? 1040 : 240;
    const opponentX = startsAsGuest ? 240 : 1040;

    this.player = this.createFighter(playerX, 360, 0x58e6c2);
    this.opponent = this.createFighter(opponentX, 360, 0xff647c);
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys("W,A,S,D");
    this.lastNetworkSend = 0;

    this.add
      .text(24, 24, this.options.mode === "bot" ? "BOT MATCH" : `ROOM ${this.options.roomCode}`, {
        color: "#58e6c2",
        fontFamily: "system-ui",
        fontSize: "17px",
        fontStyle: "bold",
      })
      .setDepth(1);

    this.add
      .text(24, 50, "Move with WASD or arrow keys | Esc returns to menu", {
        color: "#dbeafe",
        fontFamily: "system-ui",
        fontSize: "16px",
      })
      .setDepth(1);

    this.input.keyboard.on("keydown-ESC", () => this.options.onExit?.());

    if (this.options.mode === "friend") {
      this.options.onRemoteState?.((state) => {
        if (!state || typeof state.x !== "number" || typeof state.y !== "number") return;
        this.opponent.setPosition(state.x, state.y);
      });
    }
  }

  createFighter(x, y, color) {
    const fighter = this.add.circle(x, y, 22, color);
    this.physics.add.existing(fighter);
    fighter.body.setCollideWorldBounds(true);
    return fighter;
  }

  drawArena() {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x26364d, 0.7);

    for (let x = 0; x <= WORLD_WIDTH; x += 64) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }

    for (let y = 0; y <= WORLD_HEIGHT; y += 64) {
      graphics.lineBetween(0, y, WORLD_WIDTH, y);
    }
  }

  update(time) {
    const speed = 260;
    let x = 0;
    let y = 0;

    if (this.cursors.left.isDown || this.keys.A.isDown) x -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) x += 1;
    if (this.cursors.up.isDown || this.keys.W.isDown) y -= 1;
    if (this.cursors.down.isDown || this.keys.S.isDown) y += 1;

    const direction = new Phaser.Math.Vector2(x, y).normalize().scale(speed);
    this.player.body.setVelocity(direction.x, direction.y);

    if (this.options.mode === "bot") {
      this.updateBot(speed * 0.72);
    } else if (time - this.lastNetworkSend >= 50) {
      this.lastNetworkSend = time;
      this.options.sendState?.({
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
      });
    }
  }

  updateBot(speed) {
    const distance = Phaser.Math.Distance.Between(
      this.opponent.x,
      this.opponent.y,
      this.player.x,
      this.player.y
    );

    if (distance > 115) {
      const direction = new Phaser.Math.Vector2(
        this.player.x - this.opponent.x,
        this.player.y - this.opponent.y
      )
        .normalize()
        .scale(speed);
      this.opponent.body.setVelocity(direction.x, direction.y);
    } else {
      this.opponent.body.setVelocity(0, 0);
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
    physics: {
      default: "arcade",
      arcade: { debug: false },
    },
    scale: {
      autoCenter: Phaser.Scale.CENTER_BOTH,
      mode: Phaser.Scale.FIT,
    },
    scene: new ArenaScene(options),
  });
}
