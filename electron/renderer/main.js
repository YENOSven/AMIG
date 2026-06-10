import "./styles.css";
import { createGame } from "./game.js";
import {
  getKeepSignedIn,
  isSupabaseConfigured,
  setKeepSignedIn,
  supabase,
} from "./supabase.js";

const app = document.querySelector("#app");
const emailConfirmationUrl = "amig://auth/confirmed";
let currentUser = null;
let game = null;
let roomChannel = null;
let roomSubscription = null;
let activeRoom = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayName(user) {
  return user?.user_metadata?.display_name || user?.email?.split("@")[0] || "Player";
}

function playerError(error, fallback = "Something went wrong. Please try again.") {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();

  if (message.includes("invalid login credentials")) return "Incorrect email or password.";
  if (message.includes("email not confirmed")) return "Confirm your email before signing in.";
  if (message.includes("code verifier")) return "This verification link must be opened on the device where you signed up.";
  if (message.includes("otp_expired")) return "This verification link has expired. Create a new account or request another email.";
  if (message.includes("user already registered")) return "An account already exists for this email.";
  if (message.includes("password should be")) return "Your password does not meet the security requirements.";
  if (message.includes("rate limit")) return "Too many emails were requested. Wait a minute and try again.";
  if (message.includes("room not found or expired")) return "That room does not exist or has expired.";
  if (message.includes("room is already full")) return "That room already has two players.";
  if (message.includes("cannot join your own room")) return "Use a different account to join your room.";
  if (message.includes("timed out")) return "The connection timed out. Please try again.";
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "Cannot reach the game service. Check your internet connection.";
  }
  if (code === "pgrst202" || code === "pgrst205" || message.includes("schema cache")) {
    return "Online rooms are not configured yet. Run the latest Supabase setup scripts.";
  }
  if (code === "42501" || message.includes("row-level security") || message.includes("permission denied")) {
    return "The game service rejected this request. Check the Supabase security setup.";
  }

  return fallback;
}

function noticeText(notice) {
  return typeof notice === "string" ? notice : notice?.text || "";
}

function isEmailNotConfirmed(error) {
  return String(error?.message || "").toLowerCase().includes("email not confirmed");
}

function noticeType(notice) {
  return typeof notice === "object" && notice?.type === "success" ? "success" : "error";
}

function showNotice(element, notice) {
  const text = noticeText(notice);
  element.textContent = text;
  element.hidden = !text;
  element.classList.toggle("message--success", noticeType(notice) === "success");
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.label;
}

async function clearRoomConnections() {
  if (roomSubscription) {
    await supabase.removeChannel(roomSubscription);
    roomSubscription = null;
  }

  if (roomChannel) {
    await supabase.removeChannel(roomChannel);
    roomChannel = null;
  }
}

function stopGame() {
  if (game) {
    game.destroy(true);
    game = null;
  }
  clearRoomConnections().catch(() => {});
}

function renderConfigurationError() {
  stopGame();
  app.innerHTML = `
    <main class="center-shell">
      <section class="panel">
        <p class="eyebrow">Setup required</p>
        <h1>Connect Supabase</h1>
        <p class="muted">Add your project URL and publishable key to <code>.env</code>.</p>
      </section>
    </main>
  `;
}

function renderAuth(mode = "login", notice = "") {
  stopGame();
  const isSignup = mode === "signup";

  app.innerHTML = `
    <main class="auth-layout">
      <section class="game-intro">
        <p class="eyebrow">Online top-down PvP</p>
        <h1>Enter the arena.</h1>
        <p>Fight a bot or invite a friend with a private room code.</p>
        <div class="arena-preview" aria-hidden="true">
          <span class="preview-player player-one"></span>
          <span class="preview-player player-two"></span>
          <span class="preview-shot"></span>
        </div>
      </section>

      <section class="panel auth-card">
        <p class="eyebrow">${isSignup ? "New fighter" : "Welcome back"}</p>
        <h2>${isSignup ? "Create account" : "Sign in"}</h2>
        <p class="muted">${isSignup ? "Create your player identity." : "Choose whether this device remembers you."}</p>
        <p id="auth-message" class="message" hidden></p>
        <form id="auth-form">
          ${
            isSignup
              ? `<label>Display name<input name="displayName" type="text" minlength="2" maxlength="24" autocomplete="nickname" required /></label>`
              : ""
          }
          <label>Email<input name="email" type="email" autocomplete="email" required /></label>
          <label>
            Password
            <input name="password" type="password" minlength="8" autocomplete="${isSignup ? "new-password" : "current-password"}" required />
          </label>
          ${
            isSignup
              ? ""
              : `
                <label class="checkbox-row">
                  <input name="keepSignedIn" type="checkbox" ${getKeepSignedIn() ? "checked" : ""} />
                  <span>
                    <strong>Keep me signed in</strong>
                    <small>Restore my account after the game exits.</small>
                  </span>
                </label>
              `
          }
          <button type="submit">${isSignup ? "Create account" : "Sign in"}</button>
        </form>
        ${
          isSignup
            ? ""
            : `<button id="resend-verification" class="text-button" type="button" hidden>Resend verification email</button>`
        }
        <button id="switch-mode" class="text-button" type="button">
          ${isSignup ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
      </section>
    </main>
  `;

  const form = document.querySelector("#auth-form");
  const message = document.querySelector("#auth-message");
  const submitButton = form.querySelector('button[type="submit"]');
  const resendButton = document.querySelector("#resend-verification");
  showNotice(message, notice);

  document.querySelector("#switch-mode").addEventListener("click", () => {
    renderAuth(isSignup ? "login" : "signup");
  });

  resendButton?.addEventListener("click", async () => {
    const email = String(form.elements.email.value).trim().toLowerCase();

    if (!form.elements.email.reportValidity()) return;

    setButtonBusy(resendButton, true, "Sending...");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: emailConfirmationUrl },
    });

    if (error) {
      showNotice(message, playerError(error, "Could not resend the verification email."));
      setButtonBusy(resendButton, false);
      return;
    }

    showNotice(message, {
      type: "success",
      text: "A new verification email was sent. Use the newest link.",
    });
    setButtonBusy(resendButton, false);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const email = String(formData.get("email")).trim().toLowerCase();
    const password = String(formData.get("password"));
    setButtonBusy(submitButton, true, isSignup ? "Creating account..." : "Signing in...");
    showNotice(message, "");

    try {
      if (isSignup) {
        const displayNameValue = String(formData.get("displayName")).trim();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayNameValue },
            emailRedirectTo: emailConfirmationUrl,
          },
        });
        if (error) throw error;
        if (!data.session) {
          renderAuth("login", {
            type: "success",
            text: "Account created. Confirm your email, then sign in.",
          });
        }
      } else {
        setKeepSignedIn(formData.get("keepSignedIn") === "on");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      showNotice(message, playerError(error, "Could not complete authentication. Please try again."));
      if (resendButton) resendButton.hidden = !isEmailNotConfirmed(error);
    } finally {
      setButtonBusy(submitButton, false);
    }
  });
}

async function handleEmailConfirmation(rawUrl) {
  try {
    const callbackUrl = new URL(rawUrl);
    if (!["amig:", "icrackedsahil:"].includes(callbackUrl.protocol) || callbackUrl.hostname !== "auth") return;

    const hashParams = new URLSearchParams(callbackUrl.hash.slice(1));
    const callbackError =
      callbackUrl.searchParams.get("error_description") ||
      callbackUrl.searchParams.get("error") ||
      hashParams.get("error_description") ||
      hashParams.get("error");

    if (callbackError) throw new Error(callbackError);

    const code = callbackUrl.searchParams.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else {
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) throw error;
      }
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;

    if (user) {
      currentUser = user;
      renderMenu({
        type: "success",
        text: "Email verified. Your account is ready.",
      });
    } else {
      renderAuth("login", {
        type: "success",
        text: "Email verified. You can sign in now.",
      });
    }
  } catch (error) {
    renderAuth("login", playerError(error, "Could not verify this email link. It may have expired."));
  }
}

function renderMenu(notice = "") {
  stopGame();
  const name = escapeHtml(displayName(currentUser));

  app.innerHTML = `
    <main class="menu-shell">
      <header class="menu-header">
        <div>
          <p class="eyebrow">Signed in as</p>
          <strong>${name}</strong>
        </div>
        <button id="sign-out" class="secondary-button" type="button">Log out</button>
      </header>

      <section class="menu-content">
        <div class="menu-title">
          <p class="eyebrow">Main menu</p>
          <h1>Choose your fight.</h1>
          <p id="menu-message" class="message" hidden></p>
        </div>

        <div class="mode-grid">
          <button id="play-bot" class="mode-card" type="button">
            <span class="mode-number">01</span>
            <strong>Play against bots</strong>
            <small>Start an instant solo match.</small>
          </button>
          <button id="create-room" class="mode-card" type="button">
            <span class="mode-number">02</span>
            <strong>Create a room</strong>
            <small>Generate a code for your friend.</small>
          </button>
          <button id="show-join" class="mode-card" type="button">
            <span class="mode-number">03</span>
            <strong>Join a friend</strong>
            <small>Enter their room code.</small>
          </button>
        </div>

        <form id="join-form" class="join-form" hidden>
          <label>
            Room code
            <input name="roomCode" type="text" minlength="8" maxlength="8" autocomplete="off" spellcheck="false" required />
          </label>
          <button type="submit">Join room</button>
        </form>
      </section>
    </main>
  `;

  showNotice(document.querySelector("#menu-message"), notice);

  document.querySelector("#sign-out").addEventListener("click", async () => {
    const button = document.querySelector("#sign-out");
    setButtonBusy(button, true, "Logging out...");
    const { error } = await supabase.auth.signOut();
    if (error) {
      setButtonBusy(button, false);
      renderMenu(playerError(error, "Could not log out. Please try again."));
    }
  });
  document.querySelector("#play-bot").addEventListener("click", () => launchGame({ mode: "bot" }));
  document.querySelector("#create-room").addEventListener("click", createRoom);

  const joinForm = document.querySelector("#join-form");
  document.querySelector("#show-join").addEventListener("click", () => {
    joinForm.hidden = false;
    joinForm.roomCode.focus();
  });
  joinForm.addEventListener("submit", joinRoom);
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function createRoom() {
  const button = document.querySelector("#create-room");
  setButtonBusy(button, true, "Creating room...");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = createRoomCode();
    const { data, error } = await supabase
      .from("game_rooms")
      .insert({ code, host_id: currentUser.id })
      .select()
      .single();

    if (!error) {
      renderRoomLobby(data, "host");
      return;
    }

    if (error.code !== "23505") {
      renderMenu(playerError(error, "Could not create a room. Please try again."));
      return;
    }
  }

  renderMenu("Could not generate a unique room code. Please try again.");
}

async function joinRoom(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const code = String(new FormData(form).get("roomCode")).trim().toUpperCase();
  setButtonBusy(button, true, "Joining...");

  const { data, error } = await supabase.rpc("join_game_room", { room_code: code });

  if (error) {
    renderMenu(playerError(error, "Could not join that room. Please try again."));
    return;
  }

  renderRoomLobby(data, "guest");
}

function renderRoomLobby(room, role) {
  stopGame();
  activeRoom = room;
  const isHost = role === "host";
  const opponentPresent = isHost ? Boolean(room.guest_id) : true;

  app.innerHTML = `
    <main class="center-shell">
      <section class="panel room-panel">
        <p class="eyebrow">${isHost ? "Room created" : "Room joined"}</p>
        <h1>${escapeHtml(room.code)}</h1>
        <p id="room-status" class="muted">
          ${opponentPresent ? "Opponent connected. Starting match..." : "Waiting for your friend to join..."}
        </p>
        <button id="copy-code" class="primary-button" type="button">Copy room code</button>
        <button id="leave-room" class="text-button" type="button">Back to menu</button>
      </section>
    </main>
  `;

  document.querySelector("#copy-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      document.querySelector("#copy-code").textContent = "Copied";
    } catch {
      document.querySelector("#copy-code").textContent = room.code;
    }
  });
  document.querySelector("#leave-room").addEventListener("click", leaveRoomAndReturn);

  if (opponentPresent) {
    setTimeout(() => launchFriendGame(room, role), 700);
    return;
  }

  roomSubscription = supabase
    .channel(`room-watch-${room.id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "game_rooms",
        filter: `id=eq.${room.id}`,
      },
      ({ new: updatedRoom }) => {
        if (updatedRoom.guest_id) {
          launchFriendGame(updatedRoom, role);
        }
      }
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        leaveRoomAndReturn("The room connection failed. Please try again.");
      }
    });
}

async function launchFriendGame(room, role) {
  if (roomSubscription) {
    await supabase.removeChannel(roomSubscription);
    roomSubscription = null;
  }

  roomChannel = supabase.channel(`match-${room.id}`, {
    config: {
      broadcast: { self: false },
      private: true,
    },
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Room connection timed out.")), 10000);

      roomChannel.subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(error || new Error("Could not connect to the room."));
        }
      });
    });
  } catch (error) {
    await leaveRoomAndReturn(playerError(error, "Could not connect to the room. Please try again."));
    return;
  }

  launchGame({
    mode: "friend",
    role,
    roomCode: room.code,
    channel: roomChannel,
  });
}

function launchGame({ mode, role = "host", roomCode = "", channel = null }) {
  if (game) game.destroy(true);

  app.innerHTML = `
    <main class="game-shell">
      <header class="game-header">
        <div>
          <p class="eyebrow">${mode === "bot" ? "Bot match" : `Room ${escapeHtml(roomCode)}`}</p>
          <strong>${escapeHtml(displayName(currentUser))}</strong>
        </div>
        <button id="leave-match" class="secondary-button" type="button">Return to menu</button>
      </header>
      <section id="game-canvas" class="game-canvas"></section>
    </main>
  `;

  const returnToMenu = () => {
    if (mode === "friend") {
      leaveRoomAndReturn();
    } else {
      renderMenu();
    }
  };
  document.querySelector("#leave-match").addEventListener("click", returnToMenu);

  let remoteHandler = null;
  if (channel) {
    channel.on("broadcast", { event: "player-state" }, ({ payload }) => {
      remoteHandler?.(payload);
    });
  }

  game = createGame("game-canvas", {
    mode,
    role,
    roomCode,
    onExit: returnToMenu,
    onRemoteState: (handler) => {
      remoteHandler = handler;
    },
    sendState: (state) => {
      channel?.send({
        type: "broadcast",
        event: "player-state",
        payload: state,
      });
    },
  });
}

async function leaveRoomAndReturn(notice = "") {
  const room = activeRoom;
  activeRoom = null;
  stopGame();

  if (room?.id) {
    const { error } = await supabase.rpc("leave_game_room", { room_id: room.id });
    if (error && !notice) {
      notice = playerError(error, "You left the room, but cleanup may take a moment.");
    }
  }

  renderMenu(notice);
}

async function start() {
  if (!isSupabaseConfigured) {
    renderConfigurationError();
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  currentUser = session?.user || null;
  currentUser ? renderMenu() : renderAuth();

  supabase.auth.onAuthStateChange((event, nextSession) => {
    queueMicrotask(() => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        renderAuth();
      } else if (event === "SIGNED_IN" && currentUser?.id !== nextSession?.user?.id) {
        currentUser = nextSession?.user || null;
        renderMenu();
      }
    });
  });

  window.desktopAuth?.onCallback(handleEmailConfirmation);
}

start().catch((error) => {
  app.innerHTML = `
    <main class="center-shell">
      <section class="panel">
        <p class="eyebrow">Connection error</p>
        <h1>Could not start the game</h1>
        <p class="message">${escapeHtml(playerError(error, "Restart the game and try again."))}</p>
      </section>
    </main>
  `;
});
